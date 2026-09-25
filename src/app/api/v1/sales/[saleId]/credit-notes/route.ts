import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { createCreditNoteSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import {
  amountIn,
  presentCreditNote,
  presentCreditNoteResult,
  quantityFor,
} from '@/server/http/stock';
import type { CreditLineInput } from '@/server/services/credit-notes';

type Params = { saleId: string };

/** The credit notes issued against one invoice, in the order they were issued. */
export const GET = defineRoute<Params>(
  { name: 'sales.creditNotes.list' },
  async ({ params, requestId, services }) => {
    const sale = await services.sales.get(params.saleId);
    if (!sale) {
      return problemResponse(
        problemFor({ code: 'sale_not_found', saleId: params.saleId }, requestId),
      );
    }
    const notes = await services.creditNotes.forSale(sale.id);
    return json({ data: notes.map(presentCreditNote) });
  },
);

/**
 * Takes back part of a sale: goods returned, a price allowance, or both.
 *
 * Each line names an invoice line by its `movementId`. Returned goods go back
 * into the lots they left from at the cost they left at; the revenue, output
 * tax and receivable are credited at the invoice's own rate. Returning more
 * than a line shipped, or crediting more than it charged, is a 409
 * `credit_exceeds_sale` with what is left, and nothing is written.
 */
export const POST = defineRoute<Params>(
  { name: 'sales.creditNotes.create', auth: true },
  async (context) => {
    const { params, request, requestId, services } = context;
    const body = await readJson(request, createCreditNoteSchema, requestId);
    if (!body.ok) return body.response;

    // Quantities mean something only at each line's own precision, and
    // amounts only in the invoice's currency — both of which the sale knows.
    const sale = await services.sales.get(params.saleId);
    if (!sale) {
      return problemResponse(
        problemFor({ code: 'sale_not_found', saleId: params.saleId }, requestId),
      );
    }

    const lines: CreditLineInput[] = [];
    for (const [index, line] of body.data.lines.entries()) {
      const source = sale.lines.find((candidate) => candidate.movementId === line.saleMovementId);
      if (!source) {
        return problemResponse(
          problemFor(
            { code: 'credit_line_not_on_sale', saleId: sale.id, movementId: line.saleMovementId },
            requestId,
          ),
        );
      }
      const quantity = quantityFor(
        { id: source.itemId, quantityPrecision: source.quantityPrecision, unit: source.unit },
        line.quantity,
        `lines.${index}.quantity`,
        requestId,
        { allowZero: true },
      );
      if (!quantity.ok) return quantity.response;
      const amount = amountIn(line.amount, sale.currency, `lines.${index}.amount`, requestId);
      if (!amount.ok) return amount.response;
      lines.push({
        saleMovementId: source.movementId,
        quantity: quantity.value,
        amount: amount.value,
      });
    }

    return createIdempotently(
      context,
      { route: 'sales.creditNotes.create', params: { saleId: sale.id }, body: body.raw },
      (scoped) =>
        scoped.creditNotes.issue({
          saleId: sale.id,
          reference: body.data.reference,
          revenueAccountId: body.data.revenueAccountId,
          reason: body.data.reason,
          ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
          metadata: body.data.metadata,
          lines,
          actor: { via: 'api' },
        }),
      (result) => ({
        body: presentCreditNoteResult(result),
        location: `/api/v1/credit-notes/${result.creditNote.id}`,
        transactionId: result.entry.id,
      }),
    );
  },
);

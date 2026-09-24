import { defineRoute, json, parseQuery, readJson } from '@/server/http/route';
import { createSaleSchema, salesQuerySchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import {
  amountIn,
  itemOr404,
  presentSale,
  presentSaleResult,
  quantityFor,
} from '@/server/http/stock';
import type { ItemSummary } from '@/server/services/inventory';
import type { SaleLineInput } from '@/server/services/sales';

/** Most recent first. */
export const GET = defineRoute({ name: 'sales.list' }, async ({ request, requestId, services }) => {
  const query = parseQuery(request, salesQuerySchema, requestId);
  if (!query.ok) return query.response;

  const sales = await services.sales.list(query.data.limit);
  return json({ data: sales.map(presentSale) });
});

/**
 * Invoices a customer and ships the goods, as one entry.
 *
 * The receivable, the revenue, any output tax and the cost of goods sold drawn
 * from the lots are posted together, so the margin on the invoice exists the
 * moment it does. Selling more than is on hand is a 409 `insufficient_stock`
 * with the real figure, and nothing is written.
 *
 * An idempotent retry is doubly safe here — the invoice reference is unique,
 * so a blind retry would be refused rather than sell twice — but the key is
 * what lets that retry succeed with the original answer instead of an error.
 */
export const POST = defineRoute({ name: 'sales.create', auth: true }, async (context) => {
  const { request, requestId, services } = context;
  const body = await readJson(request, createSaleSchema, requestId);
  if (!body.ok) return body.response;

  // Each line's quantity means something only against its own item's
  // precision, so the items are read before anything is scaled. Once each:
  // an invoice with the same product on three lines is ordinary.
  const items = new Map<string, ItemSummary>();
  const lines: SaleLineInput[] = [];
  for (const [index, line] of body.data.lines.entries()) {
    let item = items.get(line.itemId);
    if (!item) {
      const found = await itemOr404(services, line.itemId, requestId);
      if (!found.ok) return found.response;
      item = found.value;
      items.set(item.id, item);
    }

    const quantity = quantityFor(item, line.quantity, `lines.${index}.quantity`, requestId);
    if (!quantity.ok) return quantity.response;
    const amount = amountIn(line.amount, body.data.currency, `lines.${index}.amount`, requestId);
    if (!amount.ok) return amount.response;

    lines.push({
      itemId: item.id,
      quantity: quantity.value,
      amount: amount.value,
      layerId: line.layerId,
    });
  }

  return createIdempotently(
    context,
    { route: 'sales.create', body: body.raw },
    (scoped) =>
      scoped.sales.sell({
        reference: body.data.reference,
        customerAccountId: body.data.customerAccountId,
        revenueAccountId: body.data.revenueAccountId,
        currency: body.data.currency,
        taxCodeId: body.data.taxCodeId,
        ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
        dueOn: body.data.dueOn,
        description: body.data.description,
        metadata: body.data.metadata,
        lines,
        actor: { via: 'api' },
      }),
    (result) => ({
      body: presentSaleResult(result),
      location: `/api/v1/sales/${result.sale.id}`,
      transactionId: result.entry.id,
    }),
  );
});

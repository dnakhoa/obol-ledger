import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { createSupplierReturnSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import {
  amountIn,
  itemOr404,
  presentSupplierReturn,
  presentSupplierReturnResult,
  quantityFor,
} from '@/server/http/stock';

type Params = { itemId: string };

/** What went back to suppliers from this product, most recent first. */
export const GET = defineRoute<Params>(
  { name: 'items.supplierReturns.list' },
  async ({ params, requestId, services }) => {
    const item = await itemOr404(services, params.itemId, requestId);
    if (!item.ok) return item.response;
    const returns = await services.supplierReturns.list({ itemId: item.value.id });
    return json({ data: returns.map(presentSupplierReturn) });
  },
);

/**
 * Sends part of a delivery back to the supplier.
 *
 * The goods leave the named lot at what it carries them at; the supplier's
 * account comes down by the refund, at the rate the delivery was bought at.
 * Landed cost the refund does not cover goes to an expense. More than the lot
 * holds is a 409 `supplier_return_exceeds_lot`; a refund above what was paid for the
 * delivery is a 409 `supplier_refund_exceeds_lot`. Nothing is written either way.
 */
export const POST = defineRoute<Params>(
  { name: 'items.supplierReturns.create', auth: true },
  async (context) => {
    const { params, request, requestId, services } = context;
    const body = await readJson(request, createSupplierReturnSchema, requestId);
    if (!body.ok) return body.response;

    const item = await itemOr404(services, params.itemId, requestId);
    if (!item.ok) return item.response;

    // A refund means something only in the lot's own currency, which the lot
    // knows and the schema cannot.
    const lot = (await services.supplierReturns.returnable(item.value.id)).find(
      (candidate) => candidate.layerId === body.data.layerId,
    );
    if (!lot) {
      return problemResponse(
        problemFor({ code: 'cost_layer_not_found', layerId: body.data.layerId }, requestId),
      );
    }

    const quantity = quantityFor(item.value, body.data.quantity, 'quantity', requestId);
    if (!quantity.ok) return quantity.response;
    let refund: bigint | undefined;
    if (body.data.refund !== undefined) {
      const parsed = amountIn(body.data.refund, lot.currency, 'refund', requestId);
      if (!parsed.ok) return parsed.response;
      refund = parsed.value;
    }

    return createIdempotently(
      context,
      { route: 'items.supplierReturns.create', params, body: body.raw },
      (scoped) =>
        scoped.supplierReturns.returnToSupplier({
          layerId: lot.layerId,
          quantity: quantity.value,
          reference: body.data.reference,
          refund,
          counterpartyAccountId: body.data.counterpartyAccountId,
          expenseAccountId: body.data.expenseAccountId,
          taxCodeId: body.data.taxCodeId,
          reason: body.data.reason,
          ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
          metadata: body.data.metadata,
          actor: { via: 'api' },
        }),
      (result) => ({
        body: presentSupplierReturnResult(result),
        location: `/api/v1/supplier-returns/${result.supplierReturn.id}`,
        transactionId: result.entry.id,
      }),
    );
  },
);

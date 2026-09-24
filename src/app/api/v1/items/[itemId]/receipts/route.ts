import { defineRoute, readJson } from '@/server/http/route';
import { receiveStockSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import { problemFor, problemResponse } from '@/server/http/problem';
import { amountIn, itemOr404, presentMovementResult, quantityFor } from '@/server/http/stock';

type Params = { itemId: string };

/**
 * Books a delivery: one entry and one new lot, or neither.
 *
 * Answers with the movement and the entry it posted. `Location` names the
 * entry, because a movement has no address of its own and the entry is the
 * resource an accountant will go and look at.
 */
export const POST = defineRoute<Params>({ name: 'items.receive', auth: true }, async (context) => {
  const { request, params, requestId, services } = context;
  const body = await readJson(request, receiveStockSchema, requestId);
  if (!body.ok) return body.response;

  const item = await itemOr404(services, params.itemId, requestId);
  if (!item.ok) return item.response;
  const precision = item.value.quantityPrecision;

  const quantity = quantityFor(item.value, body.data.quantity, 'quantity', requestId);
  if (!quantity.ok) return quantity.response;
  const cost = amountIn(body.data.cost, body.data.currency, 'cost', requestId);
  if (!cost.ok) return cost.response;

  // Checked here because the service leaves it to a foreign key, and a
  // mistyped shipment id deserves a 404 rather than a constraint name in a 500.
  const shipmentId = body.data.shipmentId;
  if (shipmentId && !(await services.landedCost.shipment(shipmentId))) {
    return problemResponse(problemFor({ code: 'shipment_not_found', shipmentId }, requestId));
  }

  return createIdempotently(
    context,
    { route: 'items.receive', params, body: body.raw },
    (scoped) =>
      scoped.inventory.receive({
        itemId: item.value.id,
        quantity: quantity.value,
        cost: cost.value,
        currency: body.data.currency,
        creditAccountId: body.data.creditAccountId,
        ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
        reference: body.data.reference,
        description: body.data.description,
        metadata: body.data.metadata,
        shipmentId,
        ...(body.data.weightGrams ? { weightGrams: BigInt(body.data.weightGrams) } : {}),
      }),
    (result) => ({
      body: presentMovementResult(result, precision),
      location: `/api/v1/entries/${result.entry.id}`,
      transactionId: result.entry.id,
    }),
  );
});

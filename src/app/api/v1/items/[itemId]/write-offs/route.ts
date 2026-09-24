import { defineRoute, readJson } from '@/server/http/route';
import { writeOffStockSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import { itemOr404, presentMovementResult, quantityFor } from '@/server/http/stock';

type Params = { itemId: string };

/**
 * Removes stock that was not sold — broken, expired, lost, or missing at a
 * count — into an expense the caller names rather than cost of sales, so that
 * shrinkage stays visible as its own line.
 */
export const POST = defineRoute<Params>({ name: 'items.writeOff', auth: true }, async (context) => {
  const { request, params, requestId, services } = context;
  const body = await readJson(request, writeOffStockSchema, requestId);
  if (!body.ok) return body.response;

  const item = await itemOr404(services, params.itemId, requestId);
  if (!item.ok) return item.response;
  const precision = item.value.quantityPrecision;

  const quantity = quantityFor(item.value, body.data.quantity, 'quantity', requestId);
  if (!quantity.ok) return quantity.response;

  return createIdempotently(
    context,
    { route: 'items.writeOff', params, body: body.raw },
    (scoped) =>
      scoped.inventory.writeOff({
        itemId: item.value.id,
        quantity: quantity.value,
        reason: body.data.reason,
        expenseAccountId: body.data.expenseAccountId,
        layerId: body.data.layerId,
        ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
        reference: body.data.reference,
        description: body.data.description,
        metadata: body.data.metadata,
      }),
    (result) => ({
      body: presentMovementResult(result, precision),
      location: `/api/v1/entries/${result.entry.id}`,
      transactionId: result.entry.id,
    }),
  );
});

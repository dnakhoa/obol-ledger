import { defineRoute, readJson } from '@/server/http/route';
import { issueStockSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import { itemOr404, presentMovementResult, quantityFor } from '@/server/http/stock';

type Params = { itemId: string };

/**
 * Ships stock without an invoice: samples, transfers out, a consignment.
 *
 * Costed from the lots by the item's method and posted to its cost of goods
 * sold. A sale belongs on `POST /sales` instead, which posts the same cost
 * beside the revenue so the margin exists; issuing and then invoicing by hand
 * is the two-unrelated-facts arrangement that endpoint was built to end.
 */
export const POST = defineRoute<Params>({ name: 'items.issue', auth: true }, async (context) => {
  const { request, params, requestId, services } = context;
  const body = await readJson(request, issueStockSchema, requestId);
  if (!body.ok) return body.response;

  const item = await itemOr404(services, params.itemId, requestId);
  if (!item.ok) return item.response;
  const precision = item.value.quantityPrecision;

  const quantity = quantityFor(item.value, body.data.quantity, 'quantity', requestId);
  if (!quantity.ok) return quantity.response;

  return createIdempotently(
    context,
    { route: 'items.issue', params, body: body.raw },
    (scoped) =>
      scoped.inventory.issue({
        itemId: item.value.id,
        quantity: quantity.value,
        ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
        layerId: body.data.layerId,
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

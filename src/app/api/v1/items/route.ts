import { defineRoute, json, readJson } from '@/server/http/route';
import { createItemSchema } from '@/server/http/schemas';
import { createIdempotently } from '@/server/http/idempotency';
import { presentItem } from '@/server/http/stock';

/** Every product, with what is on hand and what it is carried at. */
export const GET = defineRoute({ name: 'items.list' }, async ({ services }) => {
  const items = await services.inventory.list();
  return json({ data: items.map(presentItem) });
});

/**
 * Adds a product. No stock and no entry: those arrive with the first receipt.
 *
 * Idempotent like every other creating write, although a duplicate SKU would
 * be refused anyway — because the refusal would tell a client whose first
 * attempt succeeded that it had failed.
 */
export const POST = defineRoute({ name: 'items.create', auth: true }, async (context) => {
  const body = await readJson(context.request, createItemSchema, context.requestId);
  if (!body.ok) return body.response;

  return createIdempotently(
    context,
    { route: 'items.create', body: body.raw },
    (services) =>
      services.inventory.createItem({
        sku: body.data.sku,
        name: body.data.name,
        unit: body.data.unit,
        quantityPrecision: body.data.quantityPrecision,
        inventoryAccountId: body.data.inventoryAccountId,
        cogsAccountId: body.data.cogsAccountId,
        costingMethod: body.data.costingMethod,
        metadata: body.data.metadata,
      }),
    (item) => ({ body: presentItem(item), location: `/api/v1/items/${item.id}` }),
  );
});

import { defineRoute, json } from '@/server/http/route';
import { itemOr404, presentItem, presentLayer, presentMovement } from '@/server/http/stock';

type Params = { itemId: string };

/** How many movements come with the item; older ones are history, not status. */
const RECENT_MOVEMENTS = 50;

/**
 * One product, with the lots behind its value and what last moved it.
 *
 * The lots are included because they are the answer to the question a
 * summary raises: *why* is it carried at that figure, and which container
 * will the next shipment be costed from.
 */
export const GET = defineRoute<Params>(
  { name: 'items.get' },
  async ({ params, requestId, services }) => {
    const found = await itemOr404(services, params.itemId, requestId);
    if (!found.ok) return found.response;
    const item = found.value;

    const layers = await services.inventory.layers(item.id);
    const movements = await services.inventory.movements(item.id, RECENT_MOVEMENTS);

    return json({
      data: {
        ...presentItem(item),
        layers: layers.map((layer) => presentLayer(layer, item.quantityPrecision)),
        movements: movements.map((movement) => presentMovement(movement, item.quantityPrecision)),
      },
    });
  },
);

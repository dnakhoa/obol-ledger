import { defineRoute, json, parseQuery } from '@/server/http/route';
import { deliveryQuerySchema } from '@/server/http/schemas';

/**
 * The delivery log.
 *
 * Readable without a key, like the rest of the demo's read surface, because
 * the first thing an integrator does is ask "did you actually send it?" and
 * the answer should not require a support ticket. Each row carries the attempt
 * count, the last status code and the response excerpt, which is usually
 * enough for the subscriber to find the bug on their own side.
 */
export const GET = defineRoute(
  { name: 'webhooks.deliveries.list' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, deliveryQuerySchema, requestId);
    if (!query.ok) return query.response;

    return json({ data: await services.webhooks.deliveries(query.data) });
  },
);

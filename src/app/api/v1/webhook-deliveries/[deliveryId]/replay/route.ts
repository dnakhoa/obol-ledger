import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { deliveryId: string };

/**
 * Queues the same event again.
 *
 * A new delivery row rather than a reset of the old one, so the record of the
 * original failure survives the retry. The payload keeps its `replayOf` link
 * back to the first event id, which is how a subscriber that already processed
 * it recognises the duplicate.
 */
export const POST = defineRoute<Params>(
  { name: 'webhooks.deliveries.replay', auth: true },
  async ({ params, requestId, services }) => {
    const result = await services.webhooks.replay(params.deliveryId);
    return result.ok
      ? json({ data: result.value }, { status: 202 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

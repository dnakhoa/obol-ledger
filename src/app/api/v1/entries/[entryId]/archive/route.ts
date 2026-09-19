import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { entryId: string };

/**
 * Cancels a pending entry before it settles.
 *
 * The reservation is released and nothing moves — which is why this is
 * distinct from a reversal. A reversal cancels money that *did* move by
 * posting an opposite entry; archiving cancels money that never moved, so
 * there is nothing to mirror and the entry simply never reaches the balance.
 */
export const POST = defineRoute<Params>(
  { name: 'entries.archive', auth: true },
  async ({ params, requestId, services }) => {
    const result = await services.journal.archivePending(params.entryId);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

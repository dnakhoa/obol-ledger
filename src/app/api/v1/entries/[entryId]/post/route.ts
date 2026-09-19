import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { entryId: string };

/**
 * Settles a pending entry: its amounts move from reserved to posted.
 *
 * The overdraft rule is re-checked here rather than trusted from the
 * authorisation. Funds reserved when they were available can still be gone by
 * settlement time if something else drained the account, and discovering that
 * by silently overdrawing would be the worst possible moment.
 */
export const POST = defineRoute<Params>(
  { name: 'entries.post', auth: true },
  async ({ params, requestId, services }) => {
    const result = await services.journal.postPending(params.entryId);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

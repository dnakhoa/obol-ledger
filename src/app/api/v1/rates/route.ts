import { defineRoute, json, readJson } from '@/server/http/route';
import { recordRateSchema } from '@/server/http/schemas';
import { problemFor, problemResponse } from '@/server/http/problem';

export const GET = defineRoute({ name: 'rates.list' }, async ({ services }) => {
  return json({ data: await services.rates.list() });
});

/**
 * Records a rate as a point-in-time fact.
 *
 * Re-recording the same pair, day and source is a *correction*, not a second
 * opinion — two rows claiming different rates for the same day would make
 * every lookup arbitrary. A rate for a different day is a new fact and leaves
 * the old one alone, which is what lets last quarter's reports keep using
 * last quarter's rates.
 */
export const POST = defineRoute(
  { name: 'rates.record', auth: true },
  async ({ request, requestId, services }) => {
    const body = await readJson(request, recordRateSchema, requestId);
    if (!body.ok) return body.response;

    const result = await services.rates.record(body.data);
    return result.ok
      ? json({ data: result.value }, { status: 201 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

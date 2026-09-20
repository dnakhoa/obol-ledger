import { defineRoute, json } from '@/server/http/route';
import { problem, problemFor, problemResponse } from '@/server/http/problem';
import { monthSchema } from '@/server/http/schemas';

type Params = { periodMonth: string };

/**
 * Reopens a month by reversing its closing entry.
 *
 * The original close stays on the record — deleting it would leave no evidence
 * the month was ever closed, which is the fact a reopening most needs to
 * record. The reversal is dated inside the month rather than today, because
 * undoing a close is not a new economic event in a later month.
 */
export const POST = defineRoute<Params>(
  { name: 'periods.reopen', auth: true },
  async ({ params, requestId, services }) => {
    const month = monthSchema.safeParse(params.periodMonth);
    if (!month.success) {
      return problemResponse({
        ...problem(
          400,
          'invalid-period',
          'Invalid period',
          'A period is a month, named as YYYY-MM.',
        ),
        requestId,
      });
    }

    const result = await services.periods.reopen(`${month.data}-01`);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

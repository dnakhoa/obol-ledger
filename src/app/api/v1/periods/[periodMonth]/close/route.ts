import { defineRoute, json } from '@/server/http/route';
import { problem, problemFor, problemResponse } from '@/server/http/problem';
import { monthSchema } from '@/server/http/schemas';

type Params = { periodMonth: string };

/**
 * Closes a month: posts the closing entry, then locks the month.
 *
 * The order is the opposite of what reads naturally. The closing entry is
 * itself dated inside the period, so locking first would make the lock reject
 * the entry that performs the close. Both happen in one transaction.
 */
export const POST = defineRoute<Params>(
  { name: 'periods.close', auth: true },
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

    const result = await services.periods.close(`${month.data}-01`);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

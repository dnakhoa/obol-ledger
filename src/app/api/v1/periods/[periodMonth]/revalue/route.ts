import { defineRoute, json, parseQuery } from '@/server/http/route';
import { monthSchema, revaluationQuerySchema } from '@/server/http/schemas';
import { problem, problemFor, problemResponse } from '@/server/http/problem';

type Params = { periodMonth: string };

/**
 * Retranslates a month's foreign monetary balances at the closing rate.
 *
 * `?preview=true` computes the adjustment without posting it, because an
 * accountant reviews it before sealing a month — and a preview that runs
 * different code from the real thing is not a preview.
 *
 * A separate step rather than part of the close. Folding it in would hide a
 * policy decision — which rate, which accounts — inside an operation nobody
 * reviews. The close refuses without it instead.
 */
export const POST = defineRoute<Params>(
  { name: 'periods.revalue', auth: true },
  async ({ request, params, requestId, services }) => {
    const month = monthSchema.safeParse(params.periodMonth);
    if (!month.success) {
      return problemResponse({
        ...problem(400, 'invalid-period', 'Invalid period', 'A period is a month, as YYYY-MM.'),
        requestId,
      });
    }

    const query = parseQuery(request, revaluationQuerySchema, requestId);
    if (!query.ok) return query.response;

    const periodMonth = `${month.data}-01`;
    const result = query.data.preview
      ? await services.revaluation.preview(periodMonth)
      : await services.revaluation.revalue(periodMonth);

    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

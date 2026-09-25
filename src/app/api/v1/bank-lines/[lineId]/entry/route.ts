import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { bankRecordSchema } from '@/server/http/schemas';

type Params = { lineId: string };

/**
 * Writes the entry a statement line needs, and matches it, in one step.
 *
 * For money the bank moved that the books never heard of — a fee, interest,
 * a transfer nobody booked. The entry is dated the day the bank moved the
 * money and posts the line's own amount against `counterAccountId`.
 */
export const POST = defineRoute<Params>(
  { name: 'bankLines.entry', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readJson(request, bankRecordSchema, requestId);
    if (!body.ok) return body.response;
    const result = await services.bank.record({
      lineId: params.lineId,
      counterAccountId: body.data.counterAccountId,
      description: body.data.description,
      via: 'api',
    });
    return result.ok
      ? json(
          { data: result.value },
          { status: 201, headers: { location: `/api/v1/entries/${result.value.entry.id}` } },
        )
      : problemResponse(problemFor(result.error, requestId));
  },
);

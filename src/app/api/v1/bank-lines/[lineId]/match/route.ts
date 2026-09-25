import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { bankMatchSchema } from '@/server/http/schemas';

type Params = { lineId: string };

/**
 * Says a statement line and a posting are the same movement of money.
 *
 * The posting must be on the statement's account and for the same amount to
 * the unit; anything else is refused, by this route and by the database.
 */
export const POST = defineRoute<Params>(
  { name: 'bankLines.match', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readJson(request, bankMatchSchema, requestId);
    if (!body.ok) return body.response;
    const result = await services.bank.match({
      lineId: params.lineId,
      postingId: body.data.postingId,
    });
    return result.ok
      ? json({ data: result.value }, { status: 201 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

/** Undoes a match. The record that it was made stays. */
export const DELETE = defineRoute<Params>(
  { name: 'bankLines.unmatch', auth: true },
  async ({ params, requestId, services }) => {
    const result = await services.bank.unmatch({ lineId: params.lineId });
    return result.ok
      ? new Response(null, { status: 204 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

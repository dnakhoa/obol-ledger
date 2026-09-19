import { defineRoute, json, parseQuery, readJson, unprocessable } from '@/server/http/route';
import { createEntrySchema, journalQuerySchema } from '@/server/http/schemas';
import { toDraftPostings } from '@/server/http/entries';
import { fingerprintOf } from '@/server/services/idempotency';
import { problemFor, problemResponse } from '@/server/http/problem';

export const GET = defineRoute(
  { name: 'entries.list' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, journalQuerySchema, requestId);
    if (!query.ok) return query.response;

    const page = await services.journal.list(query.data);
    return json({
      data: page.items,
      meta: { nextCursor: page.nextCursor, previousCursor: page.previousCursor },
    });
  },
);

/**
 * Records a journal entry of arbitrary shape.
 *
 * `Idempotency-Key` is optional but strongly advised: a client that times out
 * mid-request has no way to know whether the entry was written, and retrying
 * without a key risks posting it twice. The fingerprint is taken over the raw
 * body so that a retry of the *same* request replays, while the same key on a
 * different body is reported as the client bug it is.
 */
export const POST = defineRoute(
  { name: 'entries.create', auth: true },
  async ({ request, requestId, services }) => {
    const body = await readJson(request, createEntrySchema, requestId);
    if (!body.ok) return body.response;

    const converted = toDraftPostings(body.data, body.data.currency);
    if (!converted.ok) {
      return unprocessable(
        requestId,
        `Posting ${converted.index} has an amount of "${converted.amount}", which is not representable in ${body.data.currency}.`,
        { index: converted.index, currency: body.data.currency },
      );
    }

    const key = request.headers.get('idempotency-key');
    const result = await services.journal.postEntry({
      description: body.data.description,
      currency: body.data.currency,
      ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
      postings: converted.postings,
      status: body.data.status,
      ...(body.data.expectedVersions ? { expectedVersions: body.data.expectedVersions } : {}),
      ...(key ? { idempotency: { key, fingerprint: fingerprintOf(body.raw) } } : {}),
    });

    if (!result.ok) return problemResponse(problemFor(result.error, requestId));

    return json(
      { data: result.value.transaction },
      {
        // A replay is not a creation, so it answers 200 rather than 201.
        status: result.value.replayed ? 200 : 201,
        headers: {
          location: `/api/v1/entries/${result.value.transaction.id}`,
          ...(result.value.replayed ? { 'idempotent-replay': 'true' } : {}),
        },
      },
    );
  },
);

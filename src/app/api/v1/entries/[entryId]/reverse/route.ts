import { z } from 'zod';
import { defineRoute, json, readJson } from '@/server/http/route';
import { fingerprintOf } from '@/server/services/idempotency';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { entryId: string };

const reverseSchema = z.object({
  /** Defaults to "Reversal of <original>", which is usually what you want. */
  description: z.string().trim().min(1).max(280).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

/**
 * Undoes an entry by posting its mirror image.
 *
 * A POST that *creates* a new entry rather than a DELETE that removes one,
 * because that is what actually happens: the original stays on the record and
 * a second entry cancels it. Modelling it as a deletion would misrepresent the
 * ledger and invite a client to expect the original to disappear.
 *
 * Returns 201 with the *reversal*; the `reversesTransactionId` field links it
 * back. Reversing an already-reversed entry is a 409, not a second reversal.
 */
export const POST = defineRoute<Params>(
  { name: 'entries.reverse', auth: true },
  async ({ request, params, requestId, services }) => {
    const body = await readJson(request, reverseSchema, requestId);
    if (!body.ok) return body.response;

    const key = request.headers.get('idempotency-key');
    const result = await services.journal.reverseEntry({
      transactionId: params.entryId,
      description: body.data.description,
      ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
      ...(key
        ? {
            idempotency: {
              key,
              fingerprint: fingerprintOf({ reverse: params.entryId, ...(body.raw as object) }),
            },
          }
        : {}),
    });

    if (!result.ok) return problemResponse(problemFor(result.error, requestId));

    return json(
      { data: result.value.transaction },
      {
        status: result.value.replayed ? 200 : 201,
        headers: {
          location: `/api/v1/entries/${result.value.transaction.id}`,
          ...(result.value.replayed ? { 'idempotent-replay': 'true' } : {}),
        },
      },
    );
  },
);

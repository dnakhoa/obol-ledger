import { services } from '@/server/container';
import { defineRoute, json, readJson, unprocessable } from '@/server/http/route';
import { createTransferSchema } from '@/server/http/schemas';
import { signedAmount } from '@/server/http/entries';
import { fingerprintOf } from '@/server/services/idempotency';
import { problemFor, problemResponse } from '@/server/http/problem';
import type { MinorUnits } from '@/lib/money';

/**
 * The common case, expressed directly.
 *
 * A transfer is just a two-legged journal entry, and it is built as one rather
 * than through a parallel code path — so the balance rule, the overdraft check
 * and idempotency are literally the same code, not the same intention
 * implemented twice.
 */
export const POST = defineRoute(
  { name: 'transfers.create', auth: true },
  async ({ request, requestId }) => {
    const body = await readJson(request, createTransferSchema, requestId);
    if (!body.ok) return body.response;

    const amount = signedAmount(body.data.amount, 'debit', body.data.currency);
    if (amount === undefined) {
      return unprocessable(
        requestId,
        `"${body.data.amount}" is not representable in ${body.data.currency}.`,
        { currency: body.data.currency },
      );
    }

    const key = request.headers.get('idempotency-key');
    const result = await services().journal.postEntry({
      description: body.data.description,
      currency: body.data.currency,
      ...(body.data.occurredAt ? { occurredAt: new Date(body.data.occurredAt) } : {}),
      postings: [
        { accountId: body.data.toAccountId, amount },
        { accountId: body.data.fromAccountId, amount: -amount as MinorUnits },
      ],
      ...(key ? { idempotency: { key, fingerprint: fingerprintOf(body.raw) } } : {}),
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

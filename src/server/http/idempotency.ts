import { eq } from 'drizzle-orm';
import type { Result } from '@/lib/result';
import { servicesFor, type Services } from '@/server/container';
import { db } from '@/server/db/client';
import { idempotencyKeys } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Transactional } from '@/server/db/types';
import type { LedgerError } from '@/server/domain/errors';
import { fingerprintOf, IDEMPOTENCY_RETENTION_MS } from '@/server/services/idempotency';
import { problemFor, problemResponse } from './problem';
import { json } from './route';

/**
 * `Idempotency-Key` for writes that are not a bare journal entry.
 *
 * The journal's own mechanism lives inside `postEntry` and caches the entry it
 * wrote. That is the right answer for `/entries`, and the wrong one for a sale:
 * the entry is one of several rows the sale writes, so replaying the entry
 * alone would either repeat the rest or answer with the wrong resource. So the
 * key is claimed *around* the service call instead, in one transaction with
 * it — the service's own transaction becomes a savepoint inside this one.
 *
 * The contract a client sees is the journal's, unchanged: the same table, the
 * same 24-hour retention, 200 and `Idempotent-Replay: true` for a replay, 409
 * `idempotency_key_reused` for the same key on a different request, and a
 * refusal that is *not* remembered — a sale refused for want of stock can be
 * retried with the same key once the delivery is booked.
 */

export type Created = {
  /** What goes in `data`. Stored for a replay, so already what the client sees. */
  readonly body: unknown;
  readonly location: string;
  /** The ledger entry the write produced, when it produced one. */
  readonly transactionId?: string | null;
};

type Context = {
  readonly request: Request;
  readonly requestId: string;
  readonly orgId: string;
  readonly services: Services;
};

/**
 * Runs a creating write at most once per key, and answers 201 or a replay.
 *
 * `identity` is what makes two requests "the same": the route and its path
 * parameters as well as the raw body. Without the route, one key sent first to
 * `/items/A/issues` and then to `/items/B/issues` with an identical body
 * would replay A's shipment as B's.
 */
export async function createIdempotently<T>(
  context: Context,
  identity: { readonly route: string; readonly params?: object; readonly body: unknown },
  work: (services: Services) => Promise<Result<T, LedgerError>>,
  present: (value: T) => Created,
): Promise<Response> {
  const key = context.request.headers.get('idempotency-key');

  if (!key) {
    const result = await work(context.services);
    return result.ok
      ? respond(present(result.value), false)
      : problemResponse(problemFor(result.error, context.requestId));
  }

  const fingerprint = fingerprintOf(identity);
  try {
    const outcome = await withTenant(db(), context.orgId, async (tx) => {
      const replay = await claim(tx, context.orgId, key, fingerprint);
      if (replay) return { created: replay, replayed: true };

      const result = await work(servicesFor(context.orgId, tx));
      // Thrown rather than returned so the claim rolls back with the work:
      // a remembered refusal would make a corrected retry impossible.
      if (!result.ok) throw new Refused(result.error);

      const created = present(result.value);
      await tx
        .update(idempotencyKeys)
        .set({
          transactionId: created.transactionId ?? null,
          responseStatus: 201,
          responseBody: { data: created.body, location: created.location },
        })
        .where(eq(idempotencyKeys.key, key));
      return { created, replayed: false };
    });
    return respond(outcome.created, outcome.replayed);
  } catch (error) {
    if (error instanceof Refused) {
      return problemResponse(problemFor(error.ledgerError, context.requestId));
    }
    throw error;
  }
}

function respond(created: Created, replayed: boolean): Response {
  return json(
    { data: created.body },
    {
      // A replay is not a creation, so it answers 200 rather than 201.
      status: replayed ? 200 : 201,
      headers: {
        location: created.location,
        ...(replayed ? { 'idempotent-replay': 'true' } : {}),
      },
    },
  );
}

/**
 * Inserts the key before any work, so a concurrent duplicate blocks on the
 * primary key until this transaction settles and then replays, rather than
 * racing it to sell the same stock twice.
 */
async function claim(
  tx: Transactional,
  orgId: string,
  key: string,
  fingerprint: string,
): Promise<Created | undefined> {
  const claimed = await tx
    .insert(idempotencyKeys)
    .values({
      orgId,
      key,
      fingerprint,
      responseStatus: 0,
      responseBody: {},
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (claimed.length > 0) return undefined;

  const [existing] = await tx
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);
  if (!existing) throw new Error(`idempotency key ${key} vanished mid-transaction`);
  if (existing.fingerprint !== fingerprint) {
    throw new Refused({ code: 'idempotency_key_reused', key });
  }

  const stored = existing.responseBody as { data: unknown; location: string };
  return { body: stored.data, location: stored.location };
}

/** Carries a refusal out of the transaction so that it rolls back. */
class Refused extends Error {
  constructor(readonly ledgerError: LedgerError) {
    super(ledgerError.code);
    this.name = 'Refused';
  }
}

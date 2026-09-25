import { eq, sql } from 'drizzle-orm';
import {
  backoffMs,
  CLAIM_LEASE_MS,
  FAILURE_THRESHOLD,
  isRetryable,
  MAX_ATTEMPTS,
} from '@/server/domain/webhook';
import { webhookDeliveries, webhookEndpoints } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { signedHeaders } from './webhook-signature';
import { checkTarget } from './webhook-target';

/**
 * Drains the outbox.
 *
 * Three things make this different from a loop that selects rows and POSTs
 * them, and each one is a bug that only appears under load:
 *
 *  1. **Claiming, not reading.** Rows are taken with `FOR UPDATE SKIP LOCKED`
 *     inside a transaction that marks them `delivering`. Two workers — or the
 *     same cron firing twice because the last run was slow — take disjoint
 *     sets rather than both sending the same delivery. `SKIP LOCKED` is what
 *     makes them step around each other instead of queueing behind the same
 *     row.
 *  2. **A lease, not a flag.** A worker killed mid-flight leaves rows stuck in
 *     `delivering` forever if the flag is permanent. The claim also reclaims
 *     rows whose `next_attempt_at` lease has expired, so a crash costs one
 *     duplicate delivery rather than a permanently stalled queue.
 *  3. **The HTTP call is outside the claim transaction.** Holding a database
 *     transaction open across a network request to a stranger's server means a
 *     subscriber who accepts connections and never responds can pin a
 *     connection — and a row lock — for as long as it likes.
 */

/** How long a single subscriber has to respond before it is a failure. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Response text retained for the log, so a subscriber can debug its own 500. */
const ERROR_EXCERPT_CHARS = 500;

export type DispatchResult = {
  readonly claimed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly retrying: number;
};

type ClaimedDelivery = {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
};

export type DispatchDeps = {
  /** Injected so tests can assert on behaviour without opening sockets. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * DNS resolution for the SSRF check, injectable for the same reason.
   * Without this the test suite's behaviour would depend on whether
   * `hooks.example.com` happens to resolve from the machine running it.
   */
  readonly resolve?: (hostname: string) => Promise<string[]>;
  readonly now?: () => Date;
  readonly random?: () => number;
};

export function createDispatcher(database: Database, orgId: string, deps: DispatchDeps = {}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  return {
    async dispatch(batchSize = 20): Promise<DispatchResult> {
      const claimed = await claim(batchSize);
      let succeeded = 0;
      let failed = 0;
      let retrying = 0;

      // Sequential on purpose. Concurrency here is a knob that mostly buys the
      // ability to hammer one recovering subscriber with its entire backlog at
      // once; the cron interval already bounds throughput, and Fluid Compute
      // reuses the instance so there is no cold start to amortise.
      for (const delivery of claimed) {
        const outcome = await attempt(delivery);
        if (outcome === 'succeeded') succeeded += 1;
        else if (outcome === 'failed') failed += 1;
        else retrying += 1;
      }

      return { claimed: claimed.length, succeeded, failed, retrying };
    },
  };

  /**
   * Take up to `batchSize` due deliveries, atomically.
   *
   * The inner SELECT picks the rows and locks them; the outer UPDATE flips
   * them to `delivering` and pushes the lease out. Both happen in one
   * statement, so there is no window in which a row is selected by one worker
   * and then selected again by another before the update lands.
   */
  async function claim(batchSize: number): Promise<ClaimedDelivery[]> {
    const lease = new Date(now().getTime() + CLAIM_LEASE_MS);

    return withTenant(database, orgId, async (tx: Transactional) => {
      // `PgQueryResultHKT` is generic over the driver, so `execute` is typed
      // as `unknown` for a database that could be either. The shape is the
      // same on both, and the mapping below is the one place it is asserted.
      const claimedRows = (await tx.execute(sql`
        UPDATE webhook_deliveries AS d
        SET status = 'delivering',
            attempts = d.attempts + 1,
            next_attempt_at = ${lease}
        FROM (
          SELECT due.id, e.url, e.secret
          FROM webhook_deliveries AS due
          JOIN webhook_endpoints AS e ON e.id = due.endpoint_id
          WHERE (
                  -- Due for a first or a retried attempt.
                  due.status = 'pending'
                  -- Or claimed by a worker that never came back: the lease has
                  -- expired, so the row is fair game again.
                  OR due.status = 'delivering'
                )
            AND due.next_attempt_at <= ${now()}
            AND e.enabled
          ORDER BY due.next_attempt_at
          LIMIT ${batchSize}
          -- Only the delivery rows are locked. Locking the endpoint too would
          -- serialise every delivery to the same subscriber behind one row.
          FOR UPDATE OF due SKIP LOCKED
        ) AS claimed
        WHERE d.id = claimed.id
        RETURNING d.id, d.endpoint_id, d.event_id, d.event_type, d.payload,
                  d.attempts, claimed.url, claimed.secret
      `)) as { rows: Record<string, unknown>[] };

      return claimedRows.rows.map((row) => ({
        id: row['id'] as string,
        endpointId: row['endpoint_id'] as string,
        eventId: row['event_id'] as string,
        eventType: row['event_type'] as string,
        payload: row['payload'],
        attempts: row['attempts'] as number,
        url: row['url'] as string,
        secret: row['secret'] as string,
      }));
    });
  }

  async function attempt(delivery: ClaimedDelivery): Promise<'succeeded' | 'failed' | 'retrying'> {
    const target = deps.resolve
      ? await checkTarget(delivery.url, deps.resolve)
      : await checkTarget(delivery.url);
    if (!target.allowed) {
      // Not retryable: a URL that resolves somewhere it must not will still
      // resolve there in six hours, and retrying it is the attack.
      return finish(delivery, { ok: false, retryable: false, error: `blocked: ${target.reason}` });
    }

    const body = JSON.stringify(delivery.payload);
    const startedAt = Date.now();

    try {
      const response = await doFetch(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'obol-ledger-webhooks/1.0',
          ...signedHeaders({
            secret: delivery.secret,
            id: delivery.eventId,
            payload: body,
            timestamp: Math.floor(now().getTime() / 1000),
          }),
        },
        body,
        // Without this a subscriber that accepts the connection and then goes
        // quiet holds the worker until the platform kills the whole function,
        // taking every other delivery in the batch with it.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Not followed. `checkTarget` vetted the registered URL, not wherever
        // it redirects: a public host answering `302` to a private address
        // would otherwise reach it from inside, and the body would land in a
        // log the subscriber can read.
        redirect: 'manual',
      });

      const durationMs = Date.now() - startedAt;
      if (response.ok) {
        return finish(delivery, { ok: true, status: response.status, durationMs });
      }

      if (response.status >= 300 && response.status < 400) {
        // A moved endpoint is the subscriber's to update, and retrying will
        // meet the same redirect.
        return finish(delivery, {
          ok: false,
          status: response.status,
          retryable: false,
          error: `HTTP ${response.status}: redirect not followed — register the final URL`,
          durationMs,
        });
      }

      const excerpt = await readExcerpt(response);
      return finish(delivery, {
        ok: false,
        status: response.status,
        retryable: isRetryable(response.status),
        error: excerpt || `HTTP ${response.status}`,
        durationMs,
      });
    } catch (error) {
      // A transport failure — DNS, TLS, connection refused, timeout — is the
      // case retries exist for, so it is always retryable.
      return finish(delivery, {
        ok: false,
        retryable: true,
        error: error instanceof Error ? error.message : 'request failed',
        durationMs: Date.now() - startedAt,
      });
    }
  }

  async function finish(
    delivery: ClaimedDelivery,
    outcome:
      | { ok: true; status: number; durationMs: number }
      | {
          ok: false;
          status?: number;
          retryable: boolean;
          error: string;
          durationMs?: number;
        },
  ): Promise<'succeeded' | 'failed' | 'retrying'> {
    const exhausted = !outcome.ok && (!outcome.retryable || delivery.attempts >= MAX_ATTEMPTS);
    const status = outcome.ok ? 'succeeded' : exhausted ? 'failed' : 'pending';

    await withTenant(database, orgId, async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set({
          status,
          lastStatusCode: outcome.status ?? null,
          lastError: outcome.ok ? null : outcome.error,
          durationMs: outcome.durationMs ?? null,
          nextAttemptAt:
            status === 'pending'
              ? new Date(now().getTime() + backoffMs(delivery.attempts, random))
              : now(),
          completedAt: status === 'pending' ? null : now(),
        })
        .where(eq(webhookDeliveries.id, delivery.id));

      // The circuit breaker. A success resets the count, so an endpoint is
      // only disabled by a sustained run of failures — not by twenty failures
      // spread across a month of otherwise healthy delivery.
      if (outcome.ok) {
        await tx
          .update(webhookEndpoints)
          .set({ consecutiveFailures: 0 })
          .where(eq(webhookEndpoints.id, delivery.endpointId));
      } else {
        const [row] = await tx
          .update(webhookEndpoints)
          .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1` })
          .where(eq(webhookEndpoints.id, delivery.endpointId))
          .returning({ failures: webhookEndpoints.consecutiveFailures });

        if ((row?.failures ?? 0) >= FAILURE_THRESHOLD) {
          await tx
            .update(webhookEndpoints)
            .set({ enabled: false, disabledAt: now() })
            .where(eq(webhookEndpoints.id, delivery.endpointId));
        }
      }
    });

    return outcome.ok ? 'succeeded' : exhausted ? 'failed' : 'retrying';
  }
}

/**
 * The start of an error body, without reading the rest.
 *
 * `response.text()` buffers the whole body before anything can be cut from
 * it, so a subscriber answering 500 with a gigabyte would cost this worker a
 * gigabyte. Reading stops a little past what the log keeps.
 */
async function readExcerpt(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < ERROR_EXCERPT_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A body that fails halfway still has a start worth logging.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, ERROR_EXCERPT_CHARS);
}

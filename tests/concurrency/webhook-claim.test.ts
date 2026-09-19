import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createLivePostgres, LIVE_DATABASE_URL, type LivePostgres } from '../helpers/live-postgres';
import { createDispatcher } from '@/server/services/webhook-dispatcher';
import { createWebhookService } from '@/server/services/webhooks';
import { webhookDeliveries, webhookEndpoints } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { newId } from '@/lib/id';

/**
 * `FOR UPDATE SKIP LOCKED`, checked against actual concurrency.
 *
 * The dispatcher claims deliveries rather than reading them, so two workers —
 * or one cron firing again because the previous run was slow — take disjoint
 * sets instead of both sending the same webhook. PGlite is a single connection
 * and physically cannot express that race, which makes the main suite's
 * coverage of this claim worth exactly nothing.
 *
 * Mutation testing pinned down which half of the clause does what, and it is
 * not the obvious split. Deleting the whole `FOR UPDATE ... SKIP LOCKED` still
 * produces no duplicates: under READ COMMITTED the second worker's UPDATE
 * blocks on the row lock, then re-evaluates its predicate against the new row
 * version, finds `status = 'delivering'` and a lease in the future, and skips
 * the row. Correctness survives.
 *
 * What does not survive is throughput. Without `SKIP LOCKED` the workers queue
 * behind the same rows and one of them takes the entire batch while the others
 * wait and come back empty — which is why the second test here, not the first,
 * is the one that fails when the clause is removed.
 */
const suite = LIVE_DATABASE_URL ? describe : describe.skip;

suite('concurrent delivery claims', () => {
  let live: LivePostgres;
  let endpointId: string;

  const DELIVERIES = 40;
  const WORKERS = 4;

  beforeAll(async () => {
    live = await createLivePostgres();
    const webhooks = createWebhookService(live.database, live.orgId);
    const registered = await webhooks.register({ url: 'https://hooks.example.com/concurrent' });
    if (!registered.ok) throw new Error('could not register the endpoint');
    endpointId = registered.value.id;
  });

  afterAll(async () => {
    await live.close();
  });

  beforeEach(async () => {
    await withTenant(live.database, live.orgId, async (tx) => {
      await tx.delete(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId));
      await tx
        .update(webhookEndpoints)
        .set({ enabled: true, consecutiveFailures: 0 })
        .where(eq(webhookEndpoints.id, endpointId));

      await tx.insert(webhookDeliveries).values(
        Array.from({ length: DELIVERIES }, () => {
          const eventId = newId('event');
          return {
            id: newId('webhookDelivery'),
            orgId: live.orgId,
            endpointId,
            eventId,
            eventType: 'entry.posted',
            payload: { id: eventId, type: 'entry.posted', data: {} },
          };
        }),
      );
    });
  });

  it('never hands the same delivery to two workers', async () => {
    const seen: string[] = [];

    // Each worker gets its own dispatcher; they share the database, not a
    // connection, which is the whole point.
    const workers = Array.from({ length: WORKERS }, () =>
      createDispatcher(live.database, live.orgId, {
        resolve: async () => ['93.184.216.34'],
        fetch: (async (_url: string, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string };
          if (body.id) seen.push(body.id);
          return new Response(null, { status: 200 });
        }) as unknown as typeof globalThis.fetch,
      }),
    );

    const results = await Promise.all(workers.map((worker) => worker.dispatch(DELIVERIES)));

    // Every delivery went out exactly once, and each was attempted once — no
    // worker re-sent another's row. This is the property the claim exists for;
    // the test below is the one that isolates SKIP LOCKED's contribution.
    expect(seen).toHaveLength(DELIVERIES);
    expect(new Set(seen).size).toBe(DELIVERIES);
    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(DELIVERIES);

    const rows = await withTenant(live.database, live.orgId, async (tx) =>
      tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId)),
    );
    expect(rows.every((row) => row.status === 'succeeded')).toBe(true);
    // One attempt each: nobody re-sent anything.
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
  });

  it('lets workers make progress in parallel rather than queueing on one row', async () => {
    // This is SKIP LOCKED's actual contribution, and removing the clause fails
    // exactly here: the workers serialise behind the first locked row, one of
    // them takes the whole batch, and `busy.length` collapses to 1.
    const workers = Array.from({ length: WORKERS }, () =>
      createDispatcher(live.database, live.orgId, {
        resolve: async () => ['93.184.216.34'],
        fetch: (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch,
      }),
    );

    const results = await Promise.all(workers.map((worker) => worker.dispatch(10)));
    const busy = results.filter((result) => result.claimed > 0);

    expect(busy.length).toBeGreaterThan(1);
    expect(results.reduce((total, result) => total + result.claimed, 0)).toBe(DELIVERIES);
  });
});

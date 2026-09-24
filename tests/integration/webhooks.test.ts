import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { createOrganization, openAccount, servicesFor, usd } from '../helpers/fixtures';
import { webhookDeliveries, webhookEndpoints } from '@/server/db/schema';
import { createDispatcher } from '@/server/services/webhook-dispatcher';
import { verify } from '@/server/services/webhook-signature';
import { FAILURE_THRESHOLD, MAX_ATTEMPTS } from '@/server/domain/webhook';
import { withTenant } from '@/server/db/tenancy';

/**
 * The outbox and the worker that drains it, against real Postgres.
 *
 * Nothing here mocks the database, because the guarantee under test is a
 * database guarantee: the delivery row and the ledger entry share a
 * transaction, so no mock of either could demonstrate it.
 */
describe('webhooks', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: { id: string };
  let revenue: { id: string };

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    // Opened before any endpoint exists, so the books are in place and the
    // delivery log starts empty. Registering first would announce them.
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    revenue = await openAccount(db, db.$orgId, { name: 'Revenue', type: 'revenue' });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function register(overrides: { url?: string; eventTypes?: string[] } = {}) {
    const result = await services.webhooks.register({
      url: overrides.url ?? 'https://hooks.example.com/ledger',
      eventTypes: (overrides.eventTypes ?? []) as never,
    });
    if (!result.ok) throw new Error(`registration failed: ${result.error.code}`);
    return result.value;
  }

  async function postAnEntry() {
    return services.journal.postEntry({
      description: 'Sale',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(5000n) },
        { accountId: revenue.id, amount: usd(-5000n) },
      ],
    });
  }

  async function deliveries() {
    return withTenant(db, db.$orgId, async (tx) =>
      tx.select().from(webhookDeliveries).orderBy(webhookDeliveries.createdAt),
    );
  }

  describe('the outbox', () => {
    it('writes a delivery in the same transaction as the entry', async () => {
      await register();
      const result = await postAnEntry();
      expect(result.ok).toBe(true);

      const rows = await deliveries();
      const posted = rows.filter((row) => row.eventType === 'entry.posted');
      expect(posted).toHaveLength(1);
      expect(posted[0]?.status).toBe('pending');
      expect(posted[0]?.attempts).toBe(0);
    });

    it('writes nothing when the entry is rejected', async () => {
      // The guarantee that makes the outbox worth having. An unbalanced entry
      // aborts the transaction, and the announcement aborts with it — there is
      // no state in which a subscriber was told about an entry the ledger
      // refused.
      await register();
      const result = await services.journal.postEntry({
        description: 'Does not balance',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(5000n) },
          { accountId: revenue.id, amount: usd(-4000n) },
        ],
      });

      expect(result.ok).toBe(false);
      const rows = await deliveries();
      expect(rows.filter((row) => row.eventType === 'entry.posted')).toHaveLength(0);
    });

    it('fans one event out to every subscribed endpoint, under one event id', async () => {
      await register({ url: 'https://one.example.com/hook' });
      await register({ url: 'https://two.example.com/hook' });
      await postAnEntry();

      const posted = (await deliveries()).filter((row) => row.eventType === 'entry.posted');
      expect(posted).toHaveLength(2);
      // One id per ledger change, so a subscriber watching both endpoints can
      // tell it is the same event rather than two sales.
      expect(new Set(posted.map((row) => row.eventId)).size).toBe(1);
    });

    it('respects the subscription list', async () => {
      await register({ eventTypes: ['account.opened'] });
      await postAnEntry();
      expect(await deliveries()).toHaveLength(0);

      await openAccount(db, db.$orgId, { name: 'Inventory', type: 'asset' });
      expect((await deliveries()).map((row) => row.eventType)).toEqual(['account.opened']);
    });

    it('sends nothing to a disabled endpoint', async () => {
      const endpoint = await register();
      await services.webhooks.setEnabled(endpoint.id, false);
      await postAnEntry();
      expect(await deliveries()).toHaveLength(0);
    });

    it('announces settlement and archival separately from the authorisation', async () => {
      await register();
      const pending = await services.journal.postEntry({
        description: 'Hold',
        currency: 'USD',
        status: 'pending',
        postings: [
          { accountId: cash.id, amount: usd(5000n) },
          { accountId: revenue.id, amount: usd(-5000n) },
        ],
      });
      if (!pending.ok) throw new Error('expected the pending entry to post');

      await services.journal.postPending(pending.value.transaction.id);

      const types = (await deliveries()).map((row) => row.eventType);
      expect(types).toContain('entry.pending');
      expect(types).toContain('entry.settled');
      // The authorisation is not re-announced as a posting; a subscriber that
      // counted both would double the money.
      expect(types.filter((type) => type === 'entry.posted')).toHaveLength(0);
    });
  });

  describe('delivery', () => {
    function dispatcherWith(handler: (request: Request) => Response | Promise<Response>) {
      const calls: {
        url: string;
        headers: Headers;
        body: string;
        redirect: RequestRedirect | undefined;
      }[] = [];
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const headers = new Headers(init?.headers);
        const body = String(init?.body ?? '');
        calls.push({ url, headers, body, redirect: init?.redirect });
        return handler(new Request(url, { method: 'POST', headers, body }));
      });
      return {
        calls,
        dispatcher: createDispatcher(db, db.$orgId, {
          fetch: fetchMock as unknown as typeof globalThis.fetch,
          // Resolution is stubbed so the suite does not depend on whether the
          // machine running it can reach a DNS server.
          resolve: async () => ['93.184.216.34'],
        }),
      };
    }

    it('signs every delivery so the receiver can verify it', async () => {
      const endpoint = await register();
      await postAnEntry();

      const { calls, dispatcher } = dispatcherWith(() => new Response(null, { status: 200 }));
      await dispatcher.dispatch();

      expect(calls.length).toBeGreaterThan(0);
      const call = calls[0];
      if (!call) throw new Error('no delivery was attempted');
      expect(
        verify({ secret: endpoint.secret, headers: call.headers, payload: call.body }),
      ).toEqual({ valid: true });
    });

    it('marks a 2xx succeeded and stops trying', async () => {
      await register();
      await postAnEntry();

      const { dispatcher } = dispatcherWith(() => new Response(null, { status: 204 }));
      const first = await dispatcher.dispatch();
      expect(first.succeeded).toBe(first.claimed);
      expect(first.claimed).toBeGreaterThan(0);

      // Nothing is due any more.
      expect((await dispatcher.dispatch()).claimed).toBe(0);
      expect((await deliveries()).every((row) => row.status === 'succeeded')).toBe(true);
    });

    it('schedules a retry after a 500, keeping the delivery in the log', async () => {
      await register();
      await postAnEntry();

      const { dispatcher } = dispatcherWith(
        () => new Response('upstream on fire', { status: 500 }),
      );
      const result = await dispatcher.dispatch();

      expect(result.retrying).toBe(result.claimed);
      const rows = await deliveries();
      const row = rows[0];
      expect(row?.status).toBe('pending');
      expect(row?.attempts).toBe(1);
      expect(row?.lastStatusCode).toBe(500);
      // The subscriber's own error text, kept so they can debug it themselves.
      expect(row?.lastError).toContain('upstream on fire');
      expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    // The address check vets the URL that was registered, not wherever that
    // URL sends us next. Followed, a public endpoint answering
    // `302 Location: http://169.254.169.254/…` would reach the metadata
    // service with the ledger's own network position — and the response
    // excerpt lands in a delivery log the subscriber can read.
    it('does not follow a redirect, and does not retry one', async () => {
      await register();
      await postAnEntry();

      const { calls, dispatcher } = dispatcherWith(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          }),
      );
      const result = await dispatcher.dispatch();

      expect(calls.every((call) => call.redirect === 'manual')).toBe(true);
      expect(result.failed).toBe(result.claimed);
      const row = (await deliveries())[0];
      expect(row?.status).toBe('failed');
      expect(row?.lastError).toContain('redirect');
    });

    it('gives up immediately on a 404, which retrying cannot fix', async () => {
      await register();
      await postAnEntry();

      const { dispatcher } = dispatcherWith(() => new Response(null, { status: 404 }));
      const result = await dispatcher.dispatch();

      expect(result.failed).toBe(result.claimed);
      expect((await deliveries())[0]?.status).toBe('failed');
    });

    it('abandons a delivery once the attempts are exhausted', async () => {
      await register();
      await postAnEntry();

      const { dispatcher } = dispatcherWith(() => new Response(null, { status: 503 }));
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        // The backoff would normally hold the row back; the test moves it
        // forward rather than waiting six hours for attempt seven.
        await withTenant(db, db.$orgId, async (tx) => {
          await tx.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) });
        });
        await dispatcher.dispatch();
      }

      const row = (await deliveries())[0];
      expect(row?.status).toBe('failed');
      expect(row?.attempts).toBe(MAX_ATTEMPTS);
    });

    it('refuses to deliver to an address inside the private network', async () => {
      // Registered directly, bypassing the API schema, to prove the dispatcher
      // is a real check rather than a comment about one.
      await withTenant(db, db.$orgId, async (tx) => {
        await tx.insert(webhookEndpoints).values({
          id: 'whe_00000000000000000000000000',
          orgId: db.$orgId,
          url: 'https://169.254.169.254/latest/meta-data/',
          secret: 'whsec_AAAA',
        });
      });
      await postAnEntry();

      const { calls, dispatcher } = dispatcherWith(() => new Response(null, { status: 200 }));
      await dispatcher.dispatch();

      // Not merely failed — never attempted.
      expect(calls).toHaveLength(0);
      const row = (await deliveries())[0];
      expect(row?.status).toBe('failed');
      expect(row?.lastError).toContain('blocked');
    });

    it('opens the circuit on an endpoint that keeps failing', async () => {
      const endpoint = await register();
      const { dispatcher } = dispatcherWith(() => new Response(null, { status: 500 }));

      for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
        await withTenant(db, db.$orgId, async (tx) => {
          await tx.insert(webhookDeliveries).values({
            id: `whd_${String(i).padStart(26, '0')}`,
            orgId: db.$orgId,
            endpointId: endpoint.id,
            eventId: `evt_${String(i).padStart(26, '0')}`,
            eventType: 'entry.posted',
            payload: { id: `evt_${i}`, type: 'entry.posted', data: {} },
          });
        });
        await dispatcher.dispatch();
      }

      const after = await services.webhooks.get(endpoint.id);
      expect(after.ok && after.value.enabled).toBe(false);
      expect(after.ok && after.value.disabledAt).not.toBeNull();
    });

    it('resets the failure count after a success', async () => {
      const endpoint = await register();
      await postAnEntry();

      const failing = dispatcherWith(() => new Response(null, { status: 500 }));
      await failing.dispatcher.dispatch();
      const midway = await services.webhooks.get(endpoint.id);
      expect(midway.ok && midway.value.consecutiveFailures).toBe(1);

      await withTenant(db, db.$orgId, async (tx) => {
        await tx.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) });
      });
      const healthy = dispatcherWith(() => new Response(null, { status: 200 }));
      await healthy.dispatcher.dispatch();

      const after = await services.webhooks.get(endpoint.id);
      // An endpoint that fails twice a month should never be disabled; only a
      // sustained run counts.
      expect(after.ok && after.value.consecutiveFailures).toBe(0);
    });
  });

  describe('replay', () => {
    it('queues a new delivery and leaves the original record intact', async () => {
      await register();
      await postAnEntry();
      const { dispatcher } = dispatcherWithFailure();
      await dispatcher.dispatch();

      const original = (await deliveries())[0];
      if (!original) throw new Error('expected a delivery');

      const replayed = await services.webhooks.replay(original.id);
      expect(replayed.ok).toBe(true);

      const rows = await deliveries();
      expect(rows).toHaveLength(2);
      // The evidence survives: "we tried, your server returned 500" is still
      // in the log after the retry.
      const kept = rows.find((row) => row.id === original.id);
      expect(kept?.lastStatusCode).toBe(500);
      const copy = rows.find((row) => row.id !== original.id);
      expect(copy?.status).toBe('pending');
      expect((copy?.payload as { replayOf?: string }).replayOf).toBe(original.eventId);
    });

    function dispatcherWithFailure() {
      return {
        dispatcher: createDispatcher(db, db.$orgId, {
          fetch: (async () => new Response(null, { status: 500 })) as typeof globalThis.fetch,
          resolve: async () => ['93.184.216.34'],
        }),
      };
    }
  });

  describe('tenancy', () => {
    it('keeps each tenant out of the other endpoints and delivery log', async () => {
      await register();
      await postAnEntry();

      const otherOrg = await createOrganization(db, 'other');
      const other = servicesFor(db, otherOrg);

      expect(await other.webhooks.list()).toHaveLength(0);
      expect(await other.webhooks.deliveries({})).toHaveLength(0);

      // And the claim query cannot reach across either: a worker running for
      // the other tenant finds nothing to send.
      const dispatcher = createDispatcher(db, otherOrg, {
        fetch: (async () => new Response(null, { status: 200 })) as typeof globalThis.fetch,
        resolve: async () => ['93.184.216.34'],
      });
      expect((await dispatcher.dispatch()).claimed).toBe(0);
    });

    it('refuses a second endpoint on the same url', async () => {
      await register();
      const again = await services.webhooks.register({ url: 'https://hooks.example.com/ledger' });
      // Every event would otherwise be delivered twice, which a subscriber
      // reads as duplicate business events rather than a config mistake.
      expect(again.ok).toBe(false);
      expect(!again.ok && again.error.code).toBe('endpoint_url_taken');
    });
  });

  describe('the delivery record', () => {
    it('never exposes the signing secret through the service', async () => {
      await register();
      const listed = await services.webhooks.list();
      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain('whsec_');

      const fetched = await services.webhooks.get(listed[0]?.id ?? '');
      expect(JSON.stringify(fetched)).not.toContain('whsec_');
    });

    it('deletes an endpoint together with its deliveries', async () => {
      const endpoint = await register();
      await postAnEntry();
      expect((await deliveries()).length).toBeGreaterThan(0);

      await services.webhooks.remove(endpoint.id);
      expect(await deliveries()).toHaveLength(0);

      const rows = await withTenant(db, db.$orgId, async (tx) =>
        tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id)),
      );
      expect(rows).toHaveLength(0);
    });
  });
});

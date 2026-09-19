import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { resetRateLimits } from '@/server/http/rate-limit';
import { apiKeys } from '@/server/db/schema';
import { digestToken } from '@/server/services/authentication';
import { newId } from '@/lib/id';
import { GET as listAccounts, POST as createAccount } from '@/app/api/v1/accounts/route';
import { GET as getAccount } from '@/app/api/v1/accounts/[accountId]/route';
import { GET as getStatement } from '@/app/api/v1/accounts/[accountId]/statement/route';
import { GET as listEntries, POST as createEntry } from '@/app/api/v1/entries/route';
import { GET as getEntry } from '@/app/api/v1/entries/[entryId]/route';
import { POST as createTransfer } from '@/app/api/v1/transfers/route';
import { GET as trialBalance } from '@/app/api/v1/reports/trial-balance/route';
import { POST as reverseEntry } from '@/app/api/v1/entries/[entryId]/reverse/route';
import { GET as balanceSheet } from '@/app/api/v1/reports/balance-sheet/route';
import { GET as incomeStatement } from '@/app/api/v1/reports/income-statement/route';
import { GET as metrics } from '@/app/api/v1/metrics/route';
import { GET as listEndpoints, POST as createEndpoint } from '@/app/api/v1/webhook-endpoints/route';
import {
  DELETE as deleteEndpoint,
  PATCH as patchEndpoint,
} from '@/app/api/v1/webhook-endpoints/[endpointId]/route';
import { GET as listDeliveries } from '@/app/api/v1/webhook-deliveries/route';

/**
 * These exercise the real route handlers — validation, auth, problem responses,
 * serialisation — against a real Postgres. Nothing is mocked, so a wiring
 * mistake between HTTP and the services shows up here rather than in production.
 */

const TOKEN = 'test-token';
const noParams = { params: Promise.resolve({} as Record<string, never>) };

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ledger.test${path}`, init);
}

function authed(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('API', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();

    // Reads act as the demo tenant, writes authenticate as a real API key —
    // both through the same code path the deployment uses, so these tests
    // exercise tenant resolution rather than skipping it.
    process.env['DEMO_ORG_SLUG'] = 'primary';
    await db.insert(apiKeys).values({
      id: newId('apiKey'),
      orgId: db.$orgId,
      name: 'test key',
      tokenDigest: digestToken(TOKEN),
    });
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  async function openAccount(
    name: string,
    type: string,
    overdraftAllowed = false,
  ): Promise<{ id: string }> {
    const response = await createAccount(
      authed('/api/v1/accounts', { name, type, currency: 'USD', overdraftAllowed }),
      noParams,
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: { id: string } };
    return payload.data;
  }

  describe('authentication', () => {
    it('rejects a write with no token', async () => {
      const response = await createAccount(
        request('/api/v1/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Cash', type: 'asset', currency: 'USD' }),
        }),
        noParams,
      );

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    });

    it('rejects a write with the wrong token', async () => {
      const response = await createAccount(
        authed(
          '/api/v1/accounts',
          { name: 'Cash', type: 'asset', currency: 'USD' },
          {
            authorization: 'Bearer nope-nope-nope',
          },
        ),
        noParams,
      );
      expect(response.status).toBe(401);
    });

    it('leaves reads open', async () => {
      const response = await listAccounts(request('/api/v1/accounts'), noParams);
      expect(response.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('reports every invalid field at once', async () => {
      const response = await createAccount(
        authed('/api/v1/accounts', { name: '', type: 'not-a-type', currency: 'XYZ' }),
        noParams,
      );

      expect(response.status).toBe(400);
      const payload = (await response.json()) as { errors: { field: string }[] };
      expect(payload.errors.map((issue) => issue.field).sort()).toEqual([
        'currency',
        'name',
        'type',
      ]);
    });

    it('rejects a body that is not JSON', async () => {
      const response = await createAccount(
        request('/api/v1/accounts', {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: 'not json',
        }),
        noParams,
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code?: string; type: string }).type).toContain(
        'malformed-json',
      );
    });

    it('rejects an amount with more precision than the currency allows', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      const response = await createEntry(
        authed('/api/v1/entries', {
          description: 'Too precise',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '10.005' },
            { accountId: revenue.id, direction: 'credit', amount: '10.005' },
          ],
        }),
        noParams,
      );

      expect(response.status).toBe(422);
      expect(((await response.json()) as { detail: string }).detail).toContain('10.005');
    });

    it('rejects a malformed account id before reaching the database', async () => {
      const response = await createEntry(
        authed('/api/v1/entries', {
          description: 'Bad id',
          currency: 'USD',
          postings: [
            { accountId: 'not-an-id', direction: 'debit', amount: '1.00' },
            { accountId: 'also-not', direction: 'credit', amount: '1.00' },
          ],
        }),
        noParams,
      );
      expect(response.status).toBe(400);
    });
  });

  describe('accounts', () => {
    it('creates, lists and fetches', async () => {
      const cash = await openAccount('Cash', 'asset');

      const list = (await (await listAccounts(request('/api/v1/accounts'), noParams)).json()) as {
        data: { id: string; balance: { amount: string } }[];
      };
      expect(list.data).toHaveLength(1);
      expect(list.data[0]?.balance.amount).toBe('0.00');

      const fetched = await getAccount(request(`/api/v1/accounts/${cash.id}`), {
        params: Promise.resolve({ accountId: cash.id }),
      });
      expect(fetched.status).toBe(200);
    });

    it('answers 404 with a problem document for an unknown account', async () => {
      const response = await getAccount(request('/api/v1/accounts/acct_missing'), {
        params: Promise.resolve({ accountId: 'acct_missing' }),
      });

      expect(response.status).toBe(404);
      const payload = (await response.json()) as { code: string; requestId: string };
      expect(payload.code).toBe('account_not_found');
      expect(payload.requestId).toBeTruthy();
    });

    it('refuses a duplicate name in the same currency', async () => {
      await openAccount('Cash', 'asset');
      const response = await createAccount(
        authed('/api/v1/accounts', { name: 'Cash', type: 'asset', currency: 'USD' }),
        noParams,
      );
      expect(response.status).toBe(409);
    });
  });

  describe('entries', () => {
    it('records a balanced entry and returns it with its postings', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      const response = await createEntry(
        authed('/api/v1/entries', {
          description: 'Consulting fee',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '1200.00' },
            { accountId: revenue.id, direction: 'credit', amount: '1200.00' },
          ],
        }),
        noParams,
      );

      expect(response.status).toBe(201);
      expect(response.headers.get('location')).toMatch(/^\/api\/v1\/entries\/txn_/u);

      const payload = (await response.json()) as {
        data: { id: string; postings: { direction: string; amount: { amount: string } }[] };
      };
      expect(payload.data.postings).toHaveLength(2);
      expect(payload.data.postings[0]?.amount.amount).toBe('1200.00');

      const fetched = await getEntry(request(`/api/v1/entries/${payload.data.id}`), {
        params: Promise.resolve({ entryId: payload.data.id }),
      });
      expect(fetched.status).toBe(200);
    });

    it('turns an unbalanced entry into a 422 that names the residual', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      const response = await createEntry(
        authed('/api/v1/entries', {
          description: 'Off by a cent',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '10.00' },
            { accountId: revenue.id, direction: 'credit', amount: '9.99' },
          ],
        }),
        noParams,
      );

      expect(response.status).toBe(422);
      const payload = (await response.json()) as { code: string; residual: string };
      expect(payload.code).toBe('unbalanced_transaction');
      expect(payload.residual).toBe('0.01');
    });

    it('pages with a cursor', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      for (let i = 0; i < 3; i += 1) {
        await createEntry(
          authed('/api/v1/entries', {
            description: `Entry ${i}`,
            currency: 'USD',
            postings: [
              { accountId: cash.id, direction: 'debit', amount: '1.00' },
              { accountId: revenue.id, direction: 'credit', amount: '1.00' },
            ],
          }),
          noParams,
        );
      }

      const first = (await (
        await listEntries(request('/api/v1/entries?limit=2'), noParams)
      ).json()) as { data: unknown[]; meta: { nextCursor: string | null } };
      expect(first.data).toHaveLength(2);
      expect(first.meta.nextCursor).toBeTruthy();

      const second = (await (
        await listEntries(
          request(`/api/v1/entries?limit=2&cursor=${first.meta.nextCursor}`),
          noParams,
        )
      ).json()) as { data: unknown[]; meta: { nextCursor: string | null } };
      expect(second.data).toHaveLength(1);
      expect(second.meta.nextCursor).toBeNull();
    });
  });

  describe('idempotency over HTTP', () => {
    it('replays rather than posting twice', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);
      const body = {
        description: 'Retryable',
        currency: 'USD',
        postings: [
          { accountId: cash.id, direction: 'debit', amount: '42.00' },
          { accountId: revenue.id, direction: 'credit', amount: '42.00' },
        ],
      };

      const first = await createEntry(
        authed('/api/v1/entries', body, { 'idempotency-key': 'abc-123' }),
        noParams,
      );
      const second = await createEntry(
        authed('/api/v1/entries', body, { 'idempotency-key': 'abc-123' }),
        noParams,
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.headers.get('idempotent-replay')).toBe('true');

      const firstBody = (await first.json()) as { data: { id: string } };
      const secondBody = (await second.json()) as { data: { id: string } };
      expect(secondBody.data.id).toBe(firstBody.data.id);

      const list = (await (await listEntries(request('/api/v1/entries'), noParams)).json()) as {
        data: unknown[];
      };
      expect(list.data).toHaveLength(1);
    });

    it('is insensitive to JSON key order on the retry', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);
      const postings = [
        { accountId: cash.id, direction: 'debit', amount: '7.00' },
        { accountId: revenue.id, direction: 'credit', amount: '7.00' },
      ];

      const first = await createEntry(
        authed(
          '/api/v1/entries',
          { description: 'Reordered', currency: 'USD', postings },
          { 'idempotency-key': 'order-1' },
        ),
        noParams,
      );
      const second = await createEntry(
        authed(
          '/api/v1/entries',
          { postings, currency: 'USD', description: 'Reordered' },
          { 'idempotency-key': 'order-1' },
        ),
        noParams,
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
    });

    it('answers 409 when the same key carries a different body', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      await createEntry(
        authed(
          '/api/v1/entries',
          {
            description: 'First',
            currency: 'USD',
            postings: [
              { accountId: cash.id, direction: 'debit', amount: '5.00' },
              { accountId: revenue.id, direction: 'credit', amount: '5.00' },
            ],
          },
          { 'idempotency-key': 'reused' },
        ),
        noParams,
      );

      const response = await createEntry(
        authed(
          '/api/v1/entries',
          {
            description: 'Different',
            currency: 'USD',
            postings: [
              { accountId: cash.id, direction: 'debit', amount: '6.00' },
              { accountId: revenue.id, direction: 'credit', amount: '6.00' },
            ],
          },
          { 'idempotency-key': 'reused' },
        ),
        noParams,
      );

      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe('idempotency_key_reused');
    });
  });

  describe('transfers', () => {
    it('moves money and reports insufficient funds with figures', async () => {
      const cash = await openAccount('Cash', 'asset');
      const savings = await openAccount('Savings', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      await createEntry(
        authed('/api/v1/entries', {
          description: 'Opening balance',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '100.00' },
            { accountId: revenue.id, direction: 'credit', amount: '100.00' },
          ],
        }),
        noParams,
      );

      const good = await createTransfer(
        authed('/api/v1/transfers', {
          description: 'To savings',
          currency: 'USD',
          fromAccountId: cash.id,
          toAccountId: savings.id,
          amount: '40.00',
        }),
        noParams,
      );
      expect(good.status).toBe(201);

      const tooMuch = await createTransfer(
        authed('/api/v1/transfers', {
          description: 'Too much',
          currency: 'USD',
          fromAccountId: cash.id,
          toAccountId: savings.id,
          amount: '1000.00',
        }),
        noParams,
      );

      expect(tooMuch.status).toBe(422);
      const payload = (await tooMuch.json()) as {
        code: string;
        available: string;
        requested: string;
      };
      expect(payload).toMatchObject({
        code: 'insufficient_funds',
        available: '60.00',
        requested: '1000.00',
      });
    });
  });

  describe('reports', () => {
    it('reports a balanced trial balance and a running statement', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      await createEntry(
        authed('/api/v1/entries', {
          description: 'Sale',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '250.00' },
            { accountId: revenue.id, direction: 'credit', amount: '250.00' },
          ],
        }),
        noParams,
      );

      const report = (await (
        await trialBalance(request('/api/v1/reports/trial-balance'), noParams)
      ).json()) as { data: { balanced: boolean }[]; meta: { balanced: boolean } };
      expect(report.meta.balanced).toBe(true);

      const statement = (await (
        await getStatement(request(`/api/v1/accounts/${cash.id}/statement`), {
          params: Promise.resolve({ accountId: cash.id }),
        })
      ).json()) as { data: { runningBalance: { amount: string } }[] };
      expect(statement.data[0]?.runningBalance.amount).toBe('250.00');
    });
  });

  describe('journal filters over HTTP', () => {
    it('applies the search filter rather than silently dropping it', async () => {
      // Regression: the route validated against the shared pagination schema,
      // which has no `search` field — and zod strips unknown keys without
      // complaint, so the filter vanished and every entry came back.
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);
      for (const description of ['Invoice 1042', 'Payroll run']) {
        await createEntry(
          authed('/api/v1/entries', {
            description,
            currency: 'USD',
            postings: [
              { accountId: cash.id, direction: 'debit', amount: '10.00' },
              { accountId: revenue.id, direction: 'credit', amount: '10.00' },
            ],
          }),
          noParams,
        );
      }

      const response = await listEntries(request('/api/v1/entries?search=invoice'), noParams);
      const payload = (await response.json()) as { data: { description: string }[] };
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]?.description).toBe('Invoice 1042');
    });

    it('applies the account filter', async () => {
      const cash = await openAccount('Cash', 'asset');
      const other = await openAccount('Other', 'asset', true);
      const revenue = await openAccount('Sales', 'revenue', true);

      await createEntry(
        authed('/api/v1/entries', {
          description: 'Touches other',
          currency: 'USD',
          postings: [
            { accountId: other.id, direction: 'debit', amount: '10.00' },
            { accountId: revenue.id, direction: 'credit', amount: '10.00' },
          ],
        }),
        noParams,
      );
      await createEntry(
        authed('/api/v1/entries', {
          description: 'Touches cash',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '10.00' },
            { accountId: revenue.id, direction: 'credit', amount: '10.00' },
          ],
        }),
        noParams,
      );

      const response = await listEntries(
        request(`/api/v1/entries?accountId=${other.id}`),
        noParams,
      );
      const payload = (await response.json()) as { data: { description: string }[] };
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]?.description).toBe('Touches other');
    });

    it('rejects a malformed account filter rather than ignoring it', async () => {
      const response = await listEntries(request('/api/v1/entries?accountId=nope'), noParams);
      expect(response.status).toBe(400);
    });
  });

  describe('reversals over HTTP', () => {
    it('reverses an entry and refuses to do it twice', async () => {
      const cash = await openAccount('Cash', 'asset');
      const revenue = await openAccount('Sales', 'revenue', true);

      const posted = await createEntry(
        authed('/api/v1/entries', {
          description: 'Invoice 1042',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '500.00' },
            { accountId: revenue.id, direction: 'credit', amount: '500.00' },
          ],
        }),
        noParams,
      );
      const entry = ((await posted.json()) as { data: { id: string } }).data;

      const first = await reverseEntry(authed(`/api/v1/entries/${entry.id}/reverse`, {}), {
        params: Promise.resolve({ entryId: entry.id }),
      });
      expect(first.status).toBe(201);

      const reversal = (
        (await first.json()) as {
          data: { id: string; reversesTransactionId: string };
        }
      ).data;
      expect(reversal.reversesTransactionId).toBe(entry.id);

      const second = await reverseEntry(authed(`/api/v1/entries/${entry.id}/reverse`, {}), {
        params: Promise.resolve({ entryId: entry.id }),
      });
      expect(second.status).toBe(409);
      expect(((await second.json()) as { code: string }).code).toBe('already_reversed');
    });

    it('requires a bearer token', async () => {
      const response = await reverseEntry(
        request('/api/v1/entries/txn_x/reverse', { method: 'POST', body: '{}' }),
        { params: Promise.resolve({ entryId: 'txn_x' }) },
      );
      expect(response.status).toBe(401);
    });

    it('answers 404 for an entry that does not exist', async () => {
      const response = await reverseEntry(authed('/api/v1/entries/txn_missing/reverse', {}), {
        params: Promise.resolve({ entryId: 'txn_missing' }),
      });
      expect(response.status).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe('entry_not_found');
    });
  });

  describe('financial statements over HTTP', () => {
    it('serves a balanced balance sheet', async () => {
      const cash = await openAccount('Cash', 'asset');
      const capital = await openAccount('Capital', 'equity', true);
      await createEntry(
        authed('/api/v1/entries', {
          description: 'Owner capital',
          currency: 'USD',
          postings: [
            { accountId: cash.id, direction: 'debit', amount: '1000.00' },
            { accountId: capital.id, direction: 'credit', amount: '1000.00' },
          ],
        }),
        noParams,
      );

      const response = await balanceSheet(request('/api/v1/reports/balance-sheet'), noParams);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        data: { assets: { total: { amount: string } }; balanced: boolean };
        meta: { balanced: boolean };
      };
      expect(payload.meta.balanced).toBe(true);
      expect(payload.data.assets.total.amount).toBe('1000.00');
    });

    it('rejects a period that runs backwards', async () => {
      const response = await incomeStatement(
        request(
          '/api/v1/reports/income-statement?from=2026-06-01T00:00:00Z&to=2026-01-01T00:00:00Z',
        ),
        noParams,
      );
      expect(response.status).toBe(400);
    });

    it('defaults to the last 30 days rather than all time', async () => {
      const response = await incomeStatement(request('/api/v1/reports/income-statement'), noParams);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { data: { from: string; to: string } };
      const span = new Date(payload.data.to).getTime() - new Date(payload.data.from).getTime();
      expect(Math.round(span / 86_400_000)).toBe(30);
    });
  });

  describe('webhooks over HTTP', () => {
    async function register(url = 'https://hooks.example.com/ledger') {
      const response = await createEndpoint(
        authed('/api/v1/webhook-endpoints', { url, eventTypes: ['entry.posted'] }),
        noParams,
      );
      expect(response.status).toBe(201);
      return (await response.json()) as { data: { id: string; secret: string } };
    }

    it('returns the signing secret exactly once', async () => {
      const created = await register();
      expect(created.data.secret).toMatch(/^whsec_/u);

      // Every subsequent read omits it. A credential that can be re-read is a
      // credential a read-only compromise turns into forged deliveries.
      const listed = await listEndpoints(request('/api/v1/webhook-endpoints'), noParams);
      const body = await listed.text();
      expect(body).toContain(created.data.id);
      expect(body).not.toContain('whsec_');
    });

    it('refuses a plaintext endpoint', async () => {
      const response = await createEndpoint(
        authed('/api/v1/webhook-endpoints', { url: 'http://hooks.example.com/ledger' }),
        noParams,
      );
      expect(response.status).toBe(400);
    });

    it('refuses an unknown event type rather than silently subscribing to none', async () => {
      const response = await createEndpoint(
        authed('/api/v1/webhook-endpoints', {
          url: 'https://hooks.example.com/typo',
          eventTypes: ['entry.exploded'],
        }),
        noParams,
      );
      expect(response.status).toBe(400);
    });

    it('rejects a second endpoint on the same url with a 409', async () => {
      await register();
      const again = await createEndpoint(
        authed('/api/v1/webhook-endpoints', { url: 'https://hooks.example.com/ledger' }),
        noParams,
      );
      expect(again.status).toBe(409);
      const problem = (await again.json()) as { code: string };
      expect(problem.code).toBe('endpoint_url_taken');
    });

    it('requires a key to register, but not to read the delivery log', async () => {
      const anonymous = await createEndpoint(
        request('/api/v1/webhook-endpoints', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://hooks.example.com/anon' }),
        }),
        noParams,
      );
      expect(anonymous.status).toBe(401);

      const log = await listDeliveries(request('/api/v1/webhook-deliveries'), noParams);
      expect(log.status).toBe(200);
    });

    it('logs a delivery for an entry posted after registration', async () => {
      await register();
      // Both assets: moving money into a revenue account would debit it,
      // pushing its presented balance negative and tripping the overdraft rule.
      const cash = await openAccount('Webhook cash', 'asset', true);
      const revenue = await openAccount('Webhook savings', 'asset');
      const transfer = await createTransfer(
        authed('/api/v1/transfers', {
          description: 'Hooked',
          currency: 'USD',
          fromAccountId: cash.id,
          toAccountId: revenue.id,
          amount: '10.00',
        }),
        noParams,
      );
      expect(transfer.status).toBe(201);

      const response = await listDeliveries(
        request('/api/v1/webhook-deliveries?status=pending'),
        noParams,
      );
      const payload = (await response.json()) as { data: { eventType: string }[] };
      expect(payload.data.map((row) => row.eventType)).toContain('entry.posted');
    });

    it('rejects an unknown delivery status instead of returning everything', async () => {
      const response = await listDeliveries(
        request('/api/v1/webhook-deliveries?status=maybe'),
        noParams,
      );
      expect(response.status).toBe(400);
    });

    it('disables and removes an endpoint', async () => {
      const created = await register();
      const params = { params: Promise.resolve({ endpointId: created.data.id }) };

      const disabled = await patchEndpoint(
        authed(`/api/v1/webhook-endpoints/${created.data.id}`, { enabled: false }),
        params,
      );
      expect(disabled.status).toBe(200);
      expect(((await disabled.json()) as { data: { enabled: boolean } }).data.enabled).toBe(false);

      const removed = await deleteEndpoint(
        authed(`/api/v1/webhook-endpoints/${created.data.id}`, {}),
        params,
      );
      expect(removed.status).toBe(204);

      const missing = await patchEndpoint(
        authed(`/api/v1/webhook-endpoints/${created.data.id}`, { enabled: true }),
        params,
      );
      expect(missing.status).toBe(404);
    });
  });

  describe('observability', () => {
    it('echoes an inbound correlation id on every response', async () => {
      const response = await listAccounts(
        request('/api/v1/accounts', { headers: { 'x-request-id': 'trace-me' } }),
        noParams,
      );
      expect(response.headers.get('x-request-id')).toBe('trace-me');
    });

    it('never caches ledger data', async () => {
      const response = await listAccounts(request('/api/v1/accounts'), noParams);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('exposes metrics a Prometheus scraper can actually parse', async () => {
      const response = await metrics(request('/api/v1/metrics'), noParams);
      expect(response.status).toBe(200);
      // A scraper checks the media type before it parses the body.
      expect(response.headers.get('content-type')).toContain('text/plain');

      const body = await response.text();
      for (const name of [
        'obol_ledger_residual_minor',
        'obol_ledger_reserved_outflow_minor',
        'obol_ledger_entries',
        'obol_ledger_accounts',
        'obol_tenant_isolation_enforced',
      ]) {
        expect(body).toContain(`# TYPE ${name} gauge`);
      }
    });

    it('reports a zero residual, which is the only value that is ever correct', async () => {
      const cash = await openAccount('Metrics cash', 'asset', true);
      const revenue = await openAccount('Metrics savings', 'asset');
      const transfer = await createTransfer(
        authed('/api/v1/transfers', {
          description: 'Metrics check',
          currency: 'USD',
          fromAccountId: cash.id,
          toAccountId: revenue.id,
          amount: '25.00',
        }),
        noParams,
      );
      expect(transfer.status).toBe(201);

      const body = await (await metrics(request('/api/v1/metrics'), noParams)).text();
      const residuals = body
        .split('\n')
        .filter((line) => line.startsWith('obol_ledger_residual_minor{'));

      expect(residuals.length).toBeGreaterThan(0);
      // Every currency, independently: postings net to zero, so balances must.
      for (const line of residuals) expect(line.split(' ').at(-1)).toBe('0');
    });
  });
});

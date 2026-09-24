import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { createOrganization, openAccount, servicesFor, usd } from '../helpers/fixtures';
import { checkTenantIsolation, withTenant } from '@/server/db/tenancy';
import { accounts, postings, transactions } from '@/server/db/schema';

/**
 * Tenant isolation, tested from the database's point of view.
 *
 * These deliberately do not trust the service layer. The claim under test is
 * that Postgres *itself* keeps tenants apart — so several of these issue raw
 * SQL, the way a migration, a console session or a future service would, and
 * assert that the policy holds anyway. A test that only went through the
 * services would be testing that the services pass an `orgId`, which is a much
 * weaker statement.
 */
describe('tenant isolation', () => {
  let db: TestDatabase;
  let alpha: string;
  let beta: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    alpha = db.$orgId;
    beta = await createOrganization(db, 'beta');

    for (const org of [alpha, beta]) {
      const cash = await openAccount(db, org, { name: 'Cash', type: 'asset' });
      const revenue = await openAccount(db, org, {
        name: 'Sales',
        type: 'revenue',
        overdraftAllowed: true,
      });
      const result = await servicesFor(db, org).journal.postEntry({
        description: `${org} sale`,
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(10_000n) },
          { accountId: revenue.id, amount: usd(-10_000n) },
        ],
      });
      expect(result.ok).toBe(true);
    }
  });

  afterEach(async () => {
    await db.$close();
  });

  it('shows each tenant only its own accounts', async () => {
    const alphaAccounts = await servicesFor(db, alpha).accounts.list();
    const betaAccounts = await servicesFor(db, beta).accounts.list();

    expect(alphaAccounts).toHaveLength(2);
    expect(betaAccounts).toHaveLength(2);
    // Same names, different rows — which is the point of per-tenant uniqueness.
    expect(alphaAccounts.map((a) => a.name).sort()).toEqual(betaAccounts.map((a) => a.name).sort());
    const overlap = alphaAccounts.filter((a) => betaAccounts.some((b) => b.id === a.id));
    expect(overlap).toEqual([]);
  });

  it('reports another tenant’s account as not found rather than forbidden', async () => {
    // 404 rather than 403: telling a caller "that exists but is not yours"
    // leaks the existence of another tenant's data.
    const [betaAccount] = await servicesFor(db, beta).accounts.list();
    const result = await servicesFor(db, alpha).accounts.byId(betaAccount?.id ?? 'acct_x');
    expect(result).toMatchObject({ ok: false, error: { code: 'account_not_found' } });
  });

  it('keeps journals separate', async () => {
    const alphaEntries = await servicesFor(db, alpha).journal.list({ limit: 50 });
    const betaEntries = await servicesFor(db, beta).journal.list({ limit: 50 });

    expect(alphaEntries.items).toHaveLength(1);
    expect(betaEntries.items).toHaveLength(1);
    expect(alphaEntries.items[0]?.description).toContain(alpha);
    expect(betaEntries.items[0]?.description).toContain(beta);
  });

  it('gives each tenant its own trial balance', async () => {
    for (const org of [alpha, beta]) {
      const rows = await servicesFor(db, org).reporting.trialBalance();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ balanced: true, debits: { amount: '100.00' } });
    }
  });

  describe('enforced by Postgres, not by the application', () => {
    it('returns nothing at all to a connection that names no tenant', async () => {
      // `org_id = NULL` is never true, so an unset tenant fails closed. This is
      // the behaviour that makes a forgotten `withTenant` harmless instead of
      // catastrophic.
      const rows = await db.select().from(accounts);
      expect(rows).toEqual([]);

      const entries = await db.select().from(transactions);
      expect(entries).toEqual([]);

      const lines = await db.select().from(postings);
      expect(lines).toEqual([]);
    });

    it('hides other tenants even from raw SQL inside a tenant context', async () => {
      const seen = await withTenant(db, alpha, async (tx) => {
        const [row] = await tx.select({ count: sql<string>`count(*)::text` }).from(accounts);
        return row?.count;
      });
      // Four accounts exist; alpha may see two.
      expect(seen).toBe('2');
    });

    it('refuses to write a row stamped with another tenant', async () => {
      // WITH CHECK, not just USING. Without it a tenant could insert rows it
      // would then never be able to read — corrupting someone else's ledger
      // while appearing to succeed.
      await expect(
        withTenant(db, alpha, async (tx) =>
          tx.insert(accounts).values({
            id: 'acct_smuggled',
            orgId: beta,
            name: 'Smuggled',
            type: 'asset',
            currency: 'USD',
          }),
        ),
      ).rejects.toThrow();
    });

    it('refuses to post into another tenant’s account', async () => {
      const [betaAccount] = await servicesFor(db, beta).accounts.list();
      const [alphaAccount] = await servicesFor(db, alpha).accounts.list();

      const result = await servicesFor(db, alpha).journal.postEntry({
        description: 'Cross-tenant raid',
        currency: 'USD',
        postings: [
          { accountId: alphaAccount?.id ?? '', amount: usd(500n) },
          { accountId: betaAccount?.id ?? '', amount: usd(-500n) },
        ],
      });

      // The other tenant's account is invisible, so it reads as missing.
      expect(result).toMatchObject({ ok: false, error: { code: 'account_not_found' } });

      // And beta's books are untouched.
      const betaBalance = await servicesFor(db, beta).reporting.trialBalance();
      expect(betaBalance[0]).toMatchObject({ balanced: true, debits: { amount: '100.00' } });
    });
  });

  describe('idempotency keys are per tenant', () => {
    it('lets two tenants use the same key without colliding', async () => {
      const key = 'shared-key';
      const results = [];

      for (const org of [alpha, beta]) {
        const [cash, revenue] = await servicesFor(db, org).accounts.list();
        results.push(
          await servicesFor(db, org).journal.postEntry({
            description: 'Same key, different tenant',
            currency: 'USD',
            postings: [
              { accountId: cash?.id ?? '', amount: usd(2_500n) },
              { accountId: revenue?.id ?? '', amount: usd(-2_500n) },
            ],
            idempotency: { key, fingerprint: 'identical-fingerprint' },
          }),
        );
      }

      // Neither is a replay of the other, and both were actually written.
      expect(results.every((r) => r.ok && !r.value.replayed)).toBe(true);
      expect(results[0]?.ok && results[1]?.ok).toBe(true);
      if (results[0]?.ok && results[1]?.ok) {
        expect(results[0].value.transaction.id).not.toBe(results[1].value.transaction.id);
      }
    });

    // The key is unique per tenant, so a lookup by key alone relies on the
    // policies to find the right row. On a connection that bypasses them —
    // the misconfiguration the health probe exists to catch — the second
    // tenant's write overwrote the first tenant's stored response, and the
    // first tenant's retry replayed somebody else's entry.
    it('replays a tenant its own entry even on a connection that bypasses the policies', async () => {
      const key = 'shared-key';
      // Read while the policies still apply: once they are off, a listing
      // returns every tenant's accounts.
      const accountsOf = new Map<string, string[]>();
      for (const org of [alpha, beta]) {
        const [cash, revenue] = await servicesFor(db, org).accounts.list();
        accountsOf.set(org, [cash?.id ?? '', revenue?.id ?? '']);
      }
      const post = async (org: string, description: string) => {
        const [cash, revenue] = accountsOf.get(org) ?? [];
        return servicesFor(db, org).journal.postEntry({
          description,
          currency: 'USD',
          postings: [
            { accountId: cash ?? '', amount: usd(2_500n) },
            { accountId: revenue ?? '', amount: usd(-2_500n) },
          ],
          idempotency: { key, fingerprint: 'identical-fingerprint' },
        });
      };

      const first = await post(alpha, 'Alpha invoice');
      await db.execute(sql`RESET ROLE`);
      await post(beta, 'Beta payroll');
      const retry = await post(alpha, 'Alpha invoice');

      expect(first.ok && retry.ok).toBe(true);
      if (first.ok && retry.ok) {
        expect(retry.value.replayed).toBe(true);
        expect(retry.value.transaction.id).toBe(first.value.transaction.id);
        expect(retry.value.transaction.description).toBe('Alpha invoice');
      }
    });
  });
});

/**
 * The guard that catches the one thing the schema cannot.
 *
 * A connection whose role is SUPERUSER or carries BYPASSRLS ignores every
 * policy, and `FORCE ROW LEVEL SECURITY` does not change that. The SQL still
 * looks right, the queries still return rows, and isolation is simply gone.
 * These assert that the runtime check notices.
 */
describe('isolation self-check', () => {
  it('reports enforcement under an ordinary role', async () => {
    const db = await createTestDatabase();
    try {
      await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
      const status = await checkTenantIsolation(db);

      expect(status).toEqual({
        enforced: true,
        privilegedRole: false,
        visibleWithoutTenant: 0,
      });
    } finally {
      await db.$close();
    }
  });

  it('reports a breach when the connection bypasses policies', async () => {
    const db = await createTestDatabase();
    try {
      await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });

      // Back to the superuser the test database was created with — the exact
      // mistake a production deployment can make without noticing.
      await db.execute(sql`RESET ROLE`);
      const status = await checkTenantIsolation(db);

      expect(status.enforced).toBe(false);
      expect(status.privilegedRole).toBe(true);
      expect(status.visibleWithoutTenant).toBeGreaterThan(0);
    } finally {
      await db.$close();
    }
  });
});

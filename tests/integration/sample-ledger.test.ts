import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { accounts, memberships, users } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { resolveViewer } from '@/server/auth/viewer';
import { createLedger, createSampleLedger } from '@/server/services/onboarding';
import { servicesFor } from '../helpers/fixtures';
import { CHART_TEMPLATE_DEFINITIONS } from '@/server/domain/chart';
import { newId } from '@/lib/id';

/**
 * The ledger a prospect gets from "Try it with sample data", and the chart a
 * Vietnamese small business keeps.
 *
 * The sample ledger is the first thing a stranger touches, so it is held to
 * the same standard as the seed: it balances, its stock agrees with its
 * accounts, and it is built entirely through the services — here as the
 * application's restricted role, which is how it runs in production.
 */
describe('sample ledgers and Thông tư 133', () => {
  let db: TestDatabase;

  async function createUser(email: string, isAnonymous = false): Promise<{ id: string }> {
    const id = newId('organization');
    await db.insert(users).values({ id, name: 'Guest', email, isAnonymous });
    return { id };
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  it('gives an anonymous visitor a writable quarter of books that balance', async () => {
    const visitor = await createUser('temp-1@sample.obol-ledger.invalid', true);
    const { orgId } = await createSampleLedger({ userId: visitor.id, name: 'Sample' });

    const services = servicesFor(db, orgId);
    const residual = await withTenant(db, orgId, async (tx) => {
      const [row] = await tx
        .select({ residual: sql<string>`coalesce(sum(${accounts.baseBalanceMinor}), 0)::text` })
        .from(accounts);
      return row?.residual;
    });
    expect(residual).toBe('0');
    expect((await services.inventory.reconcile()).agrees).toBe(true);
    expect((await services.sales.list()).length).toBeGreaterThan(5);
    expect((await services.creditNotes.list()).map((note) => note.reference)).toEqual([
      'CN-2612-01',
    ]);

    // The visitor is a member who can write, and is said to be trying it.
    const viewer = await resolveViewer({ ...visitor, name: 'Guest', email: '', isAnonymous: true });
    expect(viewer).toMatchObject({ kind: 'member', orgId, canWrite: true, sample: true });
  });

  it('keeps a real person off the sample flag', async () => {
    const person = await createUser('owner@example.test');
    const { orgId } = await createLedger({
      userId: person.id,
      name: 'Real books',
      functionalCurrency: 'VND',
      chartTemplate: 'vn_tt133',
    });
    const viewer = await resolveViewer({
      id: person.id,
      name: 'Owner',
      email: 'owner@example.test',
    });
    expect(viewer).toMatchObject({ kind: 'member', orgId, sample: false });

    const [membership] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, person.id));
    expect(membership?.role).toBe('owner');
  });

  it('opens Thông tư 133 with its own shape: no 521, no 641, 642 split in two', async () => {
    const person = await createUser('sme@example.test');
    const { orgId } = await createLedger({
      userId: person.id,
      name: 'SME',
      functionalCurrency: 'VND',
      chartTemplate: 'vn_tt133',
    });

    const codes = (await servicesFor(db, orgId).accounts.list()).map((account) => account.code);
    expect(codes).toEqual(CHART_TEMPLATE_DEFINITIONS.vn_tt133.accounts.map((a) => a.code));
    expect(codes).toContain('6421');
    expect(codes).toContain('6422');
    expect(codes).not.toContain('521');
    expect(codes).not.toContain('641');
  });

  it('enforces the class digit on Thông tư 133 as the database does on 200', async () => {
    const person = await createUser('sme2@example.test');
    const { orgId } = await createLedger({
      userId: person.id,
      name: 'SME two',
      functionalCurrency: 'VND',
      chartTemplate: 'vn_tt133',
    });

    // Through the service: refused with an explanation.
    const refused = await servicesFor(db, orgId).accounts.open({
      name: 'Hàng hóa filed as an expense',
      code: '156',
      type: 'expense',
      currency: 'VND',
      overdraftAllowed: false,
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'account_code_disagrees' } });

    // Around it: refused by the CHECK.
    await expectDatabaseError(
      withTenant(db, orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, org_id, name, type, currency, code)
          VALUES ('acct_forged', ${orgId}, 'Forged', 'expense', 'VND', '156')
        `),
      ),
      /accounts_statutory_code_check/,
    );
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { accounts, organizations, users } from '@/server/db/schema';
import { createLedger } from '@/server/services/onboarding';
import { servicesFor } from '../helpers/fixtures';
import { withTenant } from '@/server/db/tenancy';
import { CHART_TEMPLATE_DEFINITIONS, agreesWithTt200 } from '@/server/domain/chart';
import { newId } from '@/lib/id';

/**
 * Charts of accounts, and the difference between a convention and a law.
 *
 * A conventional chart's numbering is habit: Xero's own guidance is to choose
 * a scheme and leave gaps, and two mainstream Australian products ship
 * different defaults. A statutory chart's numbering is law, and Vietnam's
 * Thông tư 200 goes further — the leading digit *is* the account class.
 *
 * A model that treats both as "a list of suggested names" gets the second one
 * wrong, so these tests exercise the two separately.
 */
describe('chart of accounts', () => {
  let db: TestDatabase;

  async function createUser(email: string): Promise<{ id: string }> {
    const id = newId('organization');
    await db.insert(users).values({ id, name: email.split('@')[0] ?? 'u', email });
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

  describe('codes', () => {
    it('reads in code order, not alphabetical', async () => {
      const user = await createUser('a@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Generic',
        functionalCurrency: 'AUD',
        chartTemplate: 'generic',
      });

      const chart = await servicesFor(db, orgId).accounts.list();
      const codes = chart.map((account) => account.code);
      // Alphabetical would put "Accounts Payable" (a liability) above "Cash"
      // (an asset), which tells an accountant nothing.
      expect([...codes].sort()).toEqual(codes);
      expect(codes[0]).toBe('100');
    });

    it('keeps an uncoded account out of the way rather than at the top', async () => {
      const user = await createUser('a@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Generic',
        functionalCurrency: 'AUD',
      });
      const services = servicesFor(db, orgId);
      await services.accounts.create({
        name: 'Uncoded Petty Cash',
        type: 'asset',
        currency: 'AUD',
      });

      const chart = await services.accounts.list();
      // Postgres sorts NULLs first in ascending order by default, which would
      // put the one account nobody numbered above the entire chart.
      expect(chart.at(-1)?.code).toBeNull();
    });

    it('allows a tenant with no codes at all', async () => {
      // A sole trader with eleven accounts reads them by name perfectly well,
      // and every account that predates this feature has no code.
      const services = servicesFor(db, db.$orgId);
      await services.accounts.create({ name: 'Cash', type: 'asset', currency: 'USD' });
      const chart = await services.accounts.list();
      expect(chart.every((account) => account.code === null)).toBe(true);
    });

    it('refuses two accounts with the same code in one tenant', async () => {
      const services = servicesFor(db, db.$orgId);
      await services.accounts.create({ name: 'Cash', type: 'asset', currency: 'USD', code: '100' });
      await expectDatabaseError(
        services.accounts.create({
          name: 'Other Cash',
          type: 'asset',
          currency: 'USD',
          code: '100',
        }),
        /accounts_org_code_key|duplicate key/,
      );
    });

    it('lets two tenants use the same code', async () => {
      const one = await createUser('one@example.test');
      const two = await createUser('two@example.test');
      const first = await createLedger({ userId: one.id, name: 'A', functionalCurrency: 'AUD' });
      const second = await createLedger({ userId: two.id, name: 'B', functionalCurrency: 'NZD' });

      const a = await servicesFor(db, first.orgId).accounts.list();
      const b = await servicesFor(db, second.orgId).accounts.list();
      // Both charts start at 100. A code is unique within a tenant, not
      // globally — the opposite would make the demo's numbering everyone's.
      expect(a[0]?.code).toBe('100');
      expect(b[0]?.code).toBe('100');
    });

    it('refuses a code that is not digits', async () => {
      const services = servicesFor(db, db.$orgId);
      await expectDatabaseError(
        services.accounts.create({
          name: 'Odd',
          type: 'asset',
          currency: 'USD',
          code: 'CASH-1',
        }),
        /accounts_code_shape_check|violates check constraint/,
      );
    });
  });

  describe('a conventional chart', () => {
    it('does not constrain the leading digit', async () => {
      // 6-xxxx for expenses is a perfectly ordinary Australian habit, and
      // enforcing one vendor's numbering as though it were a rule would be
      // enforcing a habit.
      const user = await createUser('a@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Convention',
        functionalCurrency: 'AUD',
        chartTemplate: 'au_nz',
      });

      const account = await servicesFor(db, orgId).accounts.create({
        name: 'Telephone',
        type: 'expense',
        currency: 'AUD',
        code: '6100',
      });
      expect(account.code).toBe('6100');
    });

    it('opens AU/NZ with the accounts a local business actually has', async () => {
      const user = await createUser('a@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Kiwi Imports',
        functionalCurrency: 'NZD',
        chartTemplate: 'au_nz',
      });

      const names = (await servicesFor(db, orgId).accounts.list()).map((a) => a.name);
      // GST collected and GST paid are separate accounts because the return is
      // the net of the two, not a single balance.
      expect(names).toContain('GST Collected');
      expect(names).toContain('GST Paid (Input Tax Credits)');
      expect(names).toContain('PAYG Withholding Payable');
    });
  });

  describe('a statutory chart', () => {
    it('opens Thông tư 200 with prescribed codes', async () => {
      const user = await createUser('vn@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Công ty XNK',
        functionalCurrency: 'VND',
        chartTemplate: 'vn_tt200',
      });

      const chart = await servicesFor(db, orgId).accounts.list();
      const byCode = new Map(chart.map((a) => [a.code, a]));
      expect(byCode.get('111')?.name).toBe('Tiền mặt');
      expect(byCode.get('131')?.type).toBe('asset');
      expect(byCode.get('331')?.type).toBe('liability');
      // 421 is undistributed profit after tax — where a closed period lands.
      expect(byCode.get('421')?.role).toBe('retained_earnings');
      // 635 is financial expense, where realised exchange losses legally go.
      expect(byCode.get('635')?.role).toBe('fx_gain_loss');
    });

    it('refuses a code whose leading digit disagrees with the type', async () => {
      const user = await createUser('vn@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Công ty XNK',
        functionalCurrency: 'VND',
        chartTemplate: 'vn_tt200',
      });

      // 6xx is an expense class. Calling one revenue is not a preference.
      await expectDatabaseError(
        servicesFor(db, orgId).accounts.create({
          name: 'Sai loại',
          type: 'revenue',
          currency: 'VND',
          code: '642',
        }),
        /accounts_statutory_code_check|violates check constraint/,
      );
    });

    it('refuses an account with no code at all', async () => {
      const user = await createUser('vn@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Công ty XNK',
        functionalCurrency: 'VND',
        chartTemplate: 'vn_tt200',
      });

      await expectDatabaseError(
        servicesFor(db, orgId).accounts.create({
          name: 'Không số hiệu',
          type: 'asset',
          currency: 'VND',
        }),
        /accounts_statutory_code_check|violates check constraint/,
      );
    });

    it('refuses class 9, which this model has no equivalent for', async () => {
      // 911 is a clearing account that exists for the duration of a close and
      // holds nothing outside it. This model closes revenue and expense
      // straight into retained earnings, so there is nothing for it to be.
      const user = await createUser('vn@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Công ty XNK',
        functionalCurrency: 'VND',
        chartTemplate: 'vn_tt200',
      });

      for (const type of ['revenue', 'expense', 'equity'] as const) {
        await expectDatabaseError(
          servicesFor(db, orgId).accounts.create({
            name: 'Xác định kết quả kinh doanh',
            type,
            currency: 'VND',
            code: '911',
          }),
          /accounts_statutory_code_check|violates check constraint/,
        );
      }
    });

    it('cannot be claimed by an account whose organisation is not on it', async () => {
      // Two defences, and the first one means the second never fires on an
      // insert. A trigger fills the template from the organisation, so an
      // account *claiming* a different one is simply corrected rather than
      // rejected — the column cannot be wrong, so no error is the right
      // outcome.
      await withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO accounts (id, org_id, name, type, currency, chart_template, code)
          VALUES ('acct_mismatch000000000000', ${db.$orgId}, 'Mismatch', 'asset', 'USD', 'vn_tt200', '111')
        `),
      );

      const [row] = await withTenant(db, db.$orgId, (tx) =>
        tx.select().from(accounts).where(eq(accounts.id, 'acct_mismatch000000000000')),
      );
      expect(row?.chartTemplate).toBe('generic');
    });

    it('cannot be moved to a template its organisation is not on', async () => {
      // The composite foreign key is what covers the path the trigger does
      // not: an UPDATE that changes the column directly. There is no
      // (org, 'vn_tt200') row for it to reference.
      // Given a code the statutory CHECK would accept — 111 is an asset
      // under TT200 — so the foreign key is the constraint left to fire,
      // rather than the CHECK complaining about a missing code first.
      const services = servicesFor(db, db.$orgId);
      const account = await services.accounts.create({
        name: 'Cash',
        type: 'asset',
        currency: 'USD',
        code: '111',
      });

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.execute(sql`UPDATE accounts SET chart_template = 'vn_tt200' WHERE id = ${account.id}`),
        ),
        /accounts_org_template_fk|violates foreign key/,
      );
    });
  });

  describe('tax, which is where jurisdictions actually differ', () => {
    it('gives the US no input-tax account, because sales tax is not reclaimable', async () => {
      // The modelling error worth refusing: US sales tax is levied once, at
      // the final sale, and a business never reclaims tax it paid on its own
      // purchases. An input-tax asset would accumulate a receivable from the
      // state that does not exist.
      const names = CHART_TEMPLATE_DEFINITIONS.us_gaap.accounts.map((a) => a.name.toLowerCase());
      expect(names.some((name) => name.includes('sales tax payable'))).toBe(true);
      expect(names.some((name) => name.includes('tax') && name.includes('receivable'))).toBe(false);
      expect(names.some((name) => name.includes('input tax'))).toBe(false);
    });

    it('gives Japan both halves, because consumption tax is reclaimable', async () => {
      // 仮払消費税 paid and 仮受消費税 collected. The return is the net, which
      // is only expressible if both exist.
      const codes = CHART_TEMPLATE_DEFINITIONS.jp.accounts;
      const paid = codes.find((a) => a.name.includes('仮払消費税'));
      const received = codes.find((a) => a.name.includes('仮受消費税'));
      expect(paid?.type).toBe('asset');
      expect(received?.type).toBe('liability');
    });

    it('gives AU/NZ both halves too, for the same reason', async () => {
      const names = CHART_TEMPLATE_DEFINITIONS.au_nz.accounts;
      expect(names.find((a) => a.name.includes('GST Paid'))?.type).toBe('asset');
      expect(names.find((a) => a.name.includes('GST Collected'))?.type).toBe('liability');
    });
  });

  describe('every market this is aimed at', () => {
    it.each(['generic', 'au_nz', 'us_gaap', 'jp', 'vn_tt200'] as const)(
      'opens a usable ledger from the %s chart',
      async (template) => {
        const user = await createUser(`${template}@example.test`);
        const { orgId } = await createLedger({
          userId: user.id,
          name: template,
          functionalCurrency: template === 'jp' ? 'JPY' : template === 'vn_tt200' ? 'VND' : 'USD',
          chartTemplate: template,
        });

        const chart = await servicesFor(db, orgId).accounts.list();
        expect(chart.length).toBeGreaterThan(8);
        // Opened through the ordinary account service, so a template with a
        // code that contradicts its type would have been refused right here.
        expect(chart.every((account) => account.code !== null)).toBe(true);
      },
    );
  });

  describe('the templates themselves', () => {
    it('ships a statutory chart that satisfies its own rule', async () => {
      // A template with a wrong code would be rejected at onboarding rather
      // than shipped, but catching it here says which code.
      for (const account of CHART_TEMPLATE_DEFINITIONS.vn_tt200.accounts) {
        expect(
          agreesWithTt200(account.code, account.type),
          `${account.code} ${account.name} is typed ${account.type}`,
        ).toBe(true);
      }
    });

    it('gives every template exactly one retained-earnings account', async () => {
      for (const template of Object.values(CHART_TEMPLATE_DEFINITIONS)) {
        const retained = template.accounts.filter((a) => a.role === 'retained_earnings');
        const fx = template.accounts.filter((a) => a.role === 'fx_gain_loss');
        expect(retained, `${template.id} retained earnings`).toHaveLength(1);
        expect(fx, `${template.id} fx gain/loss`).toHaveLength(1);
      }
    });

    it('uses codes that are unique within each template', async () => {
      for (const template of Object.values(CHART_TEMPLATE_DEFINITIONS)) {
        const codes = template.accounts.map((a) => a.code);
        expect(new Set(codes).size, `${template.id} has a duplicate code`).toBe(codes.length);
      }
    });
  });

  it('records the template on the organisation', async () => {
    const user = await createUser('vn@example.test');
    const { orgId } = await createLedger({
      userId: user.id,
      name: 'Công ty XNK',
      functionalCurrency: 'VND',
      chartTemplate: 'vn_tt200',
    });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org?.chartTemplate).toBe('vn_tt200');

    // Read inside the tenant context: `accounts` carries a row-level security
    // policy, so an unscoped select returns nothing and the assertion would
    // pass or fail for the wrong reason.
    const [account] = await withTenant(db, orgId, (tx) =>
      tx.select().from(accounts).where(eq(accounts.orgId, orgId)).limit(1),
    );
    expect(account?.chartTemplate).toBe('vn_tt200');
  });
});

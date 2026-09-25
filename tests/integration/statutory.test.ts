import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { newId } from '@/lib/id';
import { createLedger, createSampleLedger } from '@/server/services/onboarding';
import { servicesFor } from '../helpers/fixtures';

/**
 * Vietnam's statutory statements, filled from real books.
 *
 * The sample company keeps its books under Thông tư 200: its balance sheet
 * must balance on the form's own totals, place every account that has a
 * balance, and agree with the ledger's ordinary reports; its income
 * statement must end at the same profit. A small business under Thông tư
 * 133 gets the shorter forms.
 */
describe('statutory statements', () => {
  let db: TestDatabase;

  async function user(): Promise<string> {
    const id = newId('organization');
    await db.insert(users).values({ id, name: 'Kế toán', email: `${id}@example.test` });
    return id;
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  it('draws Mẫu B01-DN and B02-DN from the sample books, complete and in agreement', async () => {
    const { orgId } = await createSampleLedger({ userId: await user(), name: 'Bình Minh' });
    const services = servicesFor(db, orgId);
    const today = new Date().toISOString().slice(0, 10);

    const sheet = await services.statutory.balanceSheet(today);
    expect(sheet?.form).toBe('B01-DN');
    expect(sheet?.unplaced).toEqual([]);
    expect(sheet?.balanced).toBe(true);

    const ledger = await services.reporting.balanceSheet();
    const line = (code: string) => sheet?.lines.find((l) => l.code === code)?.current.minorUnits;
    expect(line('270')).toBe(ledger.assets.total.minorUnits);
    expect(line('440')).toBe(ledger.liabilitiesAndEquity.minorUnits);

    const from = `${today.slice(0, 4)}-01-01`;
    const statement = await services.statutory.incomeStatement(from, today);
    const income = await services.reporting.incomeStatement({
      from: new Date(`${from}T00:00:00.000Z`),
      to: new Date(`${today}T23:59:59.999Z`),
    });
    expect(statement?.form).toBe('B02-DN');
    expect(statement?.unplaced).toEqual([]);
    expect(statement?.lines.find((l) => l.code === '60')?.current.minorUnits).toBe(
      income.netIncome.minorUnits,
    );
    // The credit note's returns are a deduction from revenue, not a cost.
    expect(
      BigInt(statement?.lines.find((l) => l.code === '02')?.current.minorUnits ?? '0'),
    ).toBeGreaterThan(0n);
  });

  it('draws the Thông tư 133 forms for a small business, and nothing outside Vietnam', async () => {
    const small = await createLedger({
      userId: await user(),
      name: 'Hộ kinh doanh',
      functionalCurrency: 'VND',
      chartTemplate: 'vn_tt133',
    });
    const services = servicesFor(db, small.orgId);
    const chart = await services.accounts.list();
    const code = (c: string) => chart.find((account) => account.code === c)?.id ?? '';
    for (const [description, debit, credit, amount] of [
      ['Góp vốn', '111', '411', 50_000_000n],
      ['Tiền thuê văn phòng', '6422', '111', 5_000_000n],
    ] as const) {
      const posted = await services.journal.postEntry({
        description,
        currency: 'VND',
        postings: [
          { accountId: code(debit), amount: amount as never },
          { accountId: code(credit), amount: -amount as never },
        ],
      });
      expect(posted.ok).toBe(true);
    }

    const today = new Date().toISOString().slice(0, 10);
    expect(await services.statutory.forms()).toEqual({
      balanceSheet: 'B01a-DNN',
      incomeStatement: 'B02-DNN',
    });
    const statement = await services.statutory.incomeStatement(`${today.slice(0, 4)}-01-01`, today);
    expect(statement?.lines.find((l) => l.code === '24')?.current.minorUnits).toBe('5000000');
    const sheet = await services.statutory.balanceSheet(today);
    expect(sheet).toMatchObject({ form: 'B01a-DNN', balanced: true, unplaced: [] });

    const elsewhere = await createLedger({
      userId: await user(),
      name: 'Sydney Tiles',
      functionalCurrency: 'AUD',
      chartTemplate: 'au_nz',
    });
    expect(await servicesFor(db, elsewhere.orgId).statutory.balanceSheet(today)).toBeNull();
  });
});

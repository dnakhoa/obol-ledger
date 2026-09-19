import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import type { AccountDto } from '@/server/services/dto';

/**
 * Financial statements.
 *
 * A trial balance proves the ledger is internally consistent; these are what it
 * exists to produce. The assertions are mostly about the accounting identity
 * holding, because a statement that does not balance means the data behind it
 * is wrong — not that the report needs rounding.
 */
describe('financial statements', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: AccountDto;
  let loan: AccountDto;
  let capital: AccountDto;
  let revenue: AccountDto;
  let rent: AccountDto;

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    loan = await openAccount(db, db.$orgId, {
      name: 'Loan',
      type: 'liability',
      overdraftAllowed: true,
    });
    capital = await openAccount(db, db.$orgId, {
      name: 'Capital',
      type: 'equity',
      overdraftAllowed: true,
    });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    rent = await openAccount(db, db.$orgId, {
      name: 'Rent',
      type: 'expense',
      overdraftAllowed: true,
    });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function post(
    description: string,
    legs: { accountId: string; amount: bigint }[],
    at?: Date,
  ) {
    const result = await services.journal.postEntry({
      description,
      currency: 'USD',
      ...(at ? { occurredAt: at } : {}),
      postings: legs.map((leg) => ({ accountId: leg.accountId, amount: usd(leg.amount) })),
    });
    if (!result.ok) throw new Error(`${description}: ${result.error.code}`);
  }

  describe('balance sheet', () => {
    it('balances an empty ledger', async () => {
      const sheet = await services.reporting.balanceSheet('USD');
      expect(sheet.balanced).toBe(true);
      expect(sheet.assets.total.amount).toBe('0.00');
    });

    it('balances after capital, borrowing and trading', async () => {
      await post('Owner capital', [
        { accountId: cash.id, amount: 100_000n },
        { accountId: capital.id, amount: -100_000n },
      ]);
      await post('Bank loan', [
        { accountId: cash.id, amount: 50_000n },
        { accountId: loan.id, amount: -50_000n },
      ]);
      await post('Sale', [
        { accountId: cash.id, amount: 30_000n },
        { accountId: revenue.id, amount: -30_000n },
      ]);
      await post('Rent', [
        { accountId: rent.id, amount: 12_000n },
        { accountId: cash.id, amount: -12_000n },
      ]);

      const sheet = await services.reporting.balanceSheet('USD');

      expect(sheet.assets.total.amount).toBe('1680.00');
      expect(sheet.liabilities.total.amount).toBe('500.00');
      expect(sheet.equity.total.amount).toBe('1000.00');
      // Revenue 300 less expenses 120, folded into equity as it would be at close.
      expect(sheet.retainedEarnings.amount).toBe('180.00');
      expect(sheet.liabilitiesAndEquity.amount).toBe('1680.00');
      expect(sheet.balanced).toBe(true);
    });

    it('lists every account in its own section', async () => {
      await post('Owner capital', [
        { accountId: cash.id, amount: 100_000n },
        { accountId: capital.id, amount: -100_000n },
      ]);

      const sheet = await services.reporting.balanceSheet('USD');
      expect(sheet.assets.lines.map((line) => line.accountName)).toEqual(['Cash']);
      expect(sheet.equity.lines.map((line) => line.accountName)).toEqual(['Capital']);
      // Shown in the sign a reader expects, whichever side it sits on.
      expect(sheet.equity.lines[0]?.amount.amount).toBe('1000.00');
    });

    it('stays balanced after a reversal', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 30_000n },
        { accountId: revenue.id, amount: -30_000n },
      ]);
      const page = await services.journal.list({ limit: 1 });
      await services.journal.reverseEntry({ transactionId: page.items[0]?.id ?? '' });

      const sheet = await services.reporting.balanceSheet('USD');
      expect(sheet.balanced).toBe(true);
      expect(sheet.retainedEarnings.amount).toBe('0.00');
    });
  });

  describe('income statement', () => {
    const march = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-31T23:59:59Z') };

    it('counts only entries inside the period', async () => {
      await post(
        'February sale',
        [
          { accountId: cash.id, amount: 10_000n },
          { accountId: revenue.id, amount: -10_000n },
        ],
        new Date('2026-02-15T12:00:00Z'),
      );
      await post(
        'March sale',
        [
          { accountId: cash.id, amount: 25_000n },
          { accountId: revenue.id, amount: -25_000n },
        ],
        new Date('2026-03-15T12:00:00Z'),
      );

      const statement = await services.reporting.incomeStatement('USD', march);
      expect(statement.revenue.total.amount).toBe('250.00');
      expect(statement.netIncome.amount).toBe('250.00');
      expect(statement.profitable).toBe(true);
    });

    it('nets revenue against expenses', async () => {
      // Funded before the period, so it does not appear on the statement but
      // does mean the rent payment is affordable.
      await post(
        'Owner capital',
        [
          { accountId: cash.id, amount: 100_000n },
          { accountId: capital.id, amount: -100_000n },
        ],
        new Date('2026-01-05T12:00:00Z'),
      );
      await post(
        'March sale',
        [
          { accountId: cash.id, amount: 25_000n },
          { accountId: revenue.id, amount: -25_000n },
        ],
        new Date('2026-03-10T12:00:00Z'),
      );
      await post(
        'March rent',
        [
          { accountId: rent.id, amount: 40_000n },
          { accountId: cash.id, amount: -40_000n },
        ],
        new Date('2026-03-20T12:00:00Z'),
      );

      const statement = await services.reporting.incomeStatement('USD', march);
      expect(statement.revenue.total.amount).toBe('250.00');
      expect(statement.expenses.total.amount).toBe('400.00');
      expect(statement.netIncome.amount).toBe('-150.00');
      expect(statement.profitable).toBe(false);
    });

    it('includes accounts with no activity, so the shape of the period is visible', async () => {
      const statement = await services.reporting.incomeStatement('USD', march);
      expect(statement.revenue.lines.map((line) => line.accountName)).toEqual(['Sales']);
      expect(statement.revenue.lines[0]?.amount.amount).toBe('0.00');
      expect(statement.netIncome.amount).toBe('0.00');
    });

    it('agrees with the balance sheet over an all-time period', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 30_000n },
        { accountId: revenue.id, amount: -30_000n },
      ]);
      await post('Rent', [
        { accountId: rent.id, amount: 12_000n },
        { accountId: cash.id, amount: -12_000n },
      ]);

      const allTime = {
        from: new Date('2000-01-01T00:00:00Z'),
        to: new Date('2100-01-01T00:00:00Z'),
      };
      const income = await services.reporting.incomeStatement('USD', allTime);
      const sheet = await services.reporting.balanceSheet('USD');

      // Retained earnings is net income when nothing has been closed out.
      expect(sheet.retainedEarnings.amount).toBe(income.netIncome.amount);
    });
  });
});

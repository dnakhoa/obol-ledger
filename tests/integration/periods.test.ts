import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import { withTenant } from '@/server/db/tenancy';
import { createAccountService } from '@/server/services/accounts';
import { transactions } from '@/server/db/schema';

/**
 * Closing the books.
 *
 * A period close is what makes a financial statement a fact rather than a
 * snapshot: without a line behind which the numbers stop moving, last
 * quarter's revenue can change tomorrow because somebody back-dated an entry,
 * and the figure an auditor signed no longer reproduces.
 */
describe('period close', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: { id: string };
  let revenue: { id: string };
  let rent: { id: string };
  let retained: { id: string };

  // Fixed so "the current month" is never the month under test.
  const NOW = new Date(Date.UTC(2026, 2, 15, 12, 0, 0));
  const JANUARY = '2026-01-01';
  const FEBRUARY = '2026-02-01';

  const inJanuary = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));
  const inFebruary = (day: number) => new Date(Date.UTC(2026, 1, day, 10, 0, 0));

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, {
      name: 'Cash',
      type: 'asset',
      overdraftAllowed: true,
    });
    revenue = await openAccount(db, db.$orgId, { name: 'Sales', type: 'revenue' });
    rent = await openAccount(db, db.$orgId, { name: 'Rent', type: 'expense' });
    retained = await createAccountService(db, db.$orgId).create({
      name: 'Retained Earnings',
      type: 'equity',
      currency: 'USD',
      role: 'retained_earnings',
    });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function earn(amount: bigint, when: Date) {
    const result = await services.journal.postEntry({
      description: 'Sale',
      currency: 'USD',
      occurredAt: when,
      postings: [
        { accountId: cash.id, amount: usd(amount) },
        { accountId: revenue.id, amount: usd(-amount) },
      ],
    });
    if (!result.ok) throw new Error(`earn failed: ${result.error.code}`);
    return result.value.transaction;
  }

  async function spend(amount: bigint, when: Date) {
    const result = await services.journal.postEntry({
      description: 'Rent',
      currency: 'USD',
      occurredAt: when,
      postings: [
        { accountId: rent.id, amount: usd(amount) },
        { accountId: cash.id, amount: usd(-amount) },
      ],
    });
    if (!result.ok) throw new Error(`spend failed: ${result.error.code}`);
    return result.value.transaction;
  }

  /**
   * The *presented* balance — the sign an accountant reads, where positive
   * means healthy whichever side the account normally sits on. Revenue of
   * 10,000 reads as +10,000 here and is stored as -10,000.
   */
  async function balanceOf(accountId: string): Promise<bigint> {
    const result = await services.accounts.byId(accountId);
    if (!result.ok) throw new Error('account vanished');
    return BigInt(result.value.balance.minorUnits);
  }

  describe('the closing entry', () => {
    it('zeroes revenue and expense and lands the profit in retained earnings', async () => {
      await earn(10_000n, inJanuary(5));
      await spend(4_000n, inJanuary(20));

      const closed = await services.periods.close(JANUARY, NOW);
      expect(closed.ok).toBe(true);

      // Temporary accounts measure a period, so they start the next one at
      // zero. An income statement that never resets measures since the
      // beginning of time.
      expect(await balanceOf(revenue.id)).toBe(0n);
      expect(await balanceOf(rent.id)).toBe(0n);
      // 10,000 earned less 4,000 spent, now sitting in equity.
      expect(await balanceOf(retained.id)).toBe(6_000n);
      // Nothing touched the real position.
      expect(await balanceOf(cash.id)).toBe(6_000n);
    });

    it('goes through the journal, so it obeys every other rule', async () => {
      await earn(10_000n, inJanuary(5));
      const closed = await services.periods.close(JANUARY, NOW);
      if (!closed.ok) throw new Error('close failed');

      const entry = await services.journal.byId(closed.value.closingTransactionId ?? '');
      expect(entry).toBeDefined();
      // The deferred constraint checked it at COMMIT like any other entry —
      // a closing entry that skipped the balance rule would be the one entry
      // nothing checked, and the first one an auditor reads.
      const total = entry?.postings.reduce(
        (sum, posting) =>
          sum + (posting.direction === 'debit' ? 1n : -1n) * BigInt(posting.amount.minorUnits),
        0n,
      );
      expect(total).toBe(0n);
      expect(entry?.metadata['closingPeriod']).toBe('2026-01');
    });

    it('closes out only the month being closed', async () => {
      // Computed from the month's postings, not from the account balance: a
      // balance is since the account opened, so using it would zero out
      // January a second time when February closes.
      await earn(10_000n, inJanuary(5));
      await earn(3_000n, inFebruary(7));

      await services.periods.close(JANUARY, NOW);
      expect(await balanceOf(revenue.id)).toBe(3_000n);

      await services.periods.close(FEBRUARY, NOW);
      expect(await balanceOf(revenue.id)).toBe(0n);
      expect(await balanceOf(retained.id)).toBe(13_000n);
    });

    it('records nothing when the month had no revenue or expense', async () => {
      // A transfer between two asset accounts is a real entry that changes no
      // temporary account, so there is nothing to close out.
      const other = await openAccount(db, db.$orgId, { name: 'Savings', type: 'asset' });
      await services.journal.postEntry({
        description: 'Sweep',
        currency: 'USD',
        occurredAt: inJanuary(9),
        postings: [
          { accountId: other.id, amount: usd(1_000n) },
          { accountId: cash.id, amount: usd(-1_000n) },
        ],
      });

      const closed = await services.periods.close(JANUARY, NOW);
      expect(closed.ok).toBe(true);
      expect(closed.ok && closed.value.closingTransactionId).toBeNull();
    });
  });

  describe('the lock', () => {
    it('refuses an entry dated inside a closed month', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);

      await expectDatabaseError(earn(500n, inJanuary(28)), /period 2026-01 is closed/);
    });

    it('refuses one written straight to the table, not just through the service', async () => {
      // Back-dating arrives through an import script, a migration or a psql
      // session — the paths that never see the service. A rule enforced only
      // where it is convenient is not enforced.
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.insert(transactions).values({
            id: 'txn_backdated00000000000000',
            orgId: db.$orgId,
            description: 'Slipped in',
            currency: 'USD',
            occurredAt: inJanuary(15),
          }),
        ),
        /period 2026-01 is closed/,
      );
    });

    it('still accepts entries in an open month', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);

      const later = await earn(2_000n, inFebruary(3));
      expect(later.id).toBeTruthy();
    });
  });

  describe('refusals', () => {
    it('will not close a month that has not finished', async () => {
      // Locking out entries that have not happened yet is a mistake nobody
      // makes deliberately and everybody makes by typo.
      const result = await services.periods.close('2026-03-01', NOW);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('period_not_finished');
    });

    it('will not close the same month twice', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);

      const again = await services.periods.close(JANUARY, NOW);
      expect(!again.ok && again.error.code).toBe('period_already_closed');
    });

    it('will not close out of order', async () => {
      // Closing February while January is open carries an unclosed month's
      // profit into a figure that claims to be final.
      await earn(10_000n, inJanuary(5));
      await earn(3_000n, inFebruary(7));

      const result = await services.periods.close(FEBRUARY, NOW);
      expect(!result.ok && result.error.code).toBe('earlier_period_open');
      expect(!result.ok && result.error.code === 'earlier_period_open' && result.error.open).toBe(
        JANUARY,
      );
    });

    it('will not close without somewhere for the profit to go', async () => {
      await withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE accounts SET role = NULL WHERE role = 'retained_earnings'`),
      );
      await earn(10_000n, inJanuary(5));

      const result = await services.periods.close(JANUARY, NOW);
      expect(!result.ok && result.error.code).toBe('retained_earnings_missing');
    });
  });

  describe('designating retained earnings', () => {
    it('allows only one per tenant', async () => {
      await expectDatabaseError(
        createAccountService(db, db.$orgId).create({
          name: 'Second Retained',
          type: 'equity',
          currency: 'USD',
          role: 'retained_earnings',
        }),
        /accounts_one_retained_earnings|duplicate key/,
      );
    });

    it('refuses a non-equity account', async () => {
      // Profit accrues to the owners. Posting a period's earnings into an
      // expense account would balance and mean nothing.
      await expectDatabaseError(
        createAccountService(db, db.$orgId).create({
          name: 'Wrong Class',
          type: 'expense',
          currency: 'USD',
          role: 'retained_earnings',
        }),
        /accounts_role_type_check|violates check constraint/,
      );
    });
  });

  describe('reopening', () => {
    it('reverses the closing entry and accepts entries again', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);

      const reopened = await services.periods.reopen(JANUARY);
      expect(reopened.ok).toBe(true);

      // The close is undone: revenue is back and retained earnings is flat.
      expect(await balanceOf(revenue.id)).toBe(10_000n);
      expect(await balanceOf(retained.id)).toBe(0n);

      const late = await earn(500n, inJanuary(28));
      expect(late.id).toBeTruthy();
    });

    it('keeps the original close on the record', async () => {
      await earn(10_000n, inJanuary(5));
      const closed = await services.periods.close(JANUARY, NOW);
      const closingId = closed.ok ? closed.value.closingTransactionId : null;

      await services.periods.reopen(JANUARY);

      // Deleting the closing entry would leave no evidence the month was ever
      // closed — the fact a reopening most needs to record.
      const original = await services.journal.byId(closingId ?? '');
      expect(original).toBeDefined();
      expect(original?.reversedByTransactionId).not.toBeNull();
    });

    it('will not reopen a month that is not closed', async () => {
      const result = await services.periods.reopen(JANUARY);
      expect(!result.ok && result.error.code).toBe('period_not_closed');
    });

    it('can close again after reopening', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);
      await services.periods.reopen(JANUARY);
      await earn(1_000n, inJanuary(28));

      const again = await services.periods.close(JANUARY, NOW);
      expect(again.ok).toBe(true);
      expect(await balanceOf(revenue.id)).toBe(0n);
      expect(await balanceOf(retained.id)).toBe(11_000n);
    });
  });

  describe('the income statement across a close', () => {
    // The closing entry moves a month's result into equity; it is not
    // something the business earned or spent. Counted, it zeroes a closed
    // month's performance and — dated at the month's last instant — drags the
    // whole month's revenue into any window that happens to span that instant.
    it('still reports what a closed month earned', async () => {
      await earn(10_000n, inJanuary(5));
      await spend(4_000n, inJanuary(20));
      expect((await services.periods.close(JANUARY, NOW)).ok).toBe(true);

      const january = await services.reporting.incomeStatement({
        from: inJanuary(1),
        to: new Date(Date.UTC(2026, 0, 31, 23, 59, 59, 999)),
      });
      expect(january.revenue.total.amount).toBe('100.00');
      expect(january.netIncome.amount).toBe('60.00');
    });

    it('does not carry a closed month into a window that crosses its end', async () => {
      await earn(10_000n, inJanuary(5));
      await earn(1_000n, inFebruary(3));
      expect((await services.periods.close(JANUARY, NOW)).ok).toBe(true);

      const window = await services.reporting.incomeStatement({
        from: inJanuary(21),
        to: inFebruary(20),
      });
      expect(window.revenue.total.amount).toBe('10.00');
    });

    it('is unchanged by reopening a month', async () => {
      await earn(10_000n, inJanuary(5));
      await services.periods.close(JANUARY, NOW);
      await services.periods.reopen(JANUARY);

      const january = await services.reporting.incomeStatement({
        from: inJanuary(1),
        to: new Date(Date.UTC(2026, 0, 31, 23, 59, 59, 999)),
      });
      expect(january.revenue.total.amount).toBe('100.00');
    });
  });

  describe('listing', () => {
    it('reports every month with entries, closed or not', async () => {
      await earn(10_000n, inJanuary(5));
      await earn(3_000n, inFebruary(7));
      await services.periods.close(JANUARY, NOW);

      const periods = await services.periods.list();
      const january = periods.find((period) => period.periodMonth === JANUARY);
      const february = periods.find((period) => period.periodMonth === FEBRUARY);

      expect(january?.status).toBe('closed');
      expect(february?.status).toBe('open');
      expect(february?.entryCount).toBe(1);
    });
  });
});

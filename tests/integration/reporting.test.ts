import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import type { AccountDto } from '@/server/services/dto';

describe('reporting service', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: AccountDto;
  let revenue: AccountDto;
  let expenses: AccountDto;

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    expenses = await openAccount(db, db.$orgId, {
      name: 'Rent',
      type: 'expense',
      overdraftAllowed: true,
    });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function post(description: string, legs: { accountId: string; amount: bigint }[]) {
    const result = await services.journal.postEntry({
      description,
      currency: 'USD',
      postings: legs.map((leg) => ({ accountId: leg.accountId, amount: usd(leg.amount) })),
    });
    if (!result.ok) throw new Error(`${description} failed: ${result.error.code}`);
    return result.value.transaction;
  }

  describe('trial balance', () => {
    it('balances an empty ledger', async () => {
      const [row] = await services.reporting.trialBalance();
      expect(row).toMatchObject({ currency: 'USD', balanced: true, residual: { amount: '0.00' } });
    });

    it('balances after every kind of entry', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 100_000n },
        { accountId: revenue.id, amount: -100_000n },
      ]);
      await post('Rent', [
        { accountId: expenses.id, amount: 30_000n },
        { accountId: cash.id, amount: -30_000n },
      ]);

      // A trial balance totals *balances*, not turnover: cash ends at 700
      // (1000 in, 300 out) and rent at 300, against 1000 of revenue.
      const [row] = await services.reporting.trialBalance();
      expect(row).toMatchObject({
        currency: 'USD',
        balanced: true,
        debits: { amount: '1000.00' },
        credits: { amount: '1000.00' },
        residual: { amount: '0.00' },
      });
    });

    it('still balances once a foreign account is in the mix', async () => {
      // The trial balance is a statement about the *functional* currency, not
      // one row per transaction currency. A euro balance added to a dollar
      // balance is a number with no meaning; summing per currency only looked
      // correct while every account was USD. See ADR 10.
      const euro = await openAccount(db, db.$orgId, {
        name: 'Euro cash',
        type: 'asset',
        currency: 'EUR',
      });
      const euroRevenue = await openAccount(db, db.$orgId, {
        name: 'Euro sales',
        type: 'revenue',
        currency: 'EUR',
        overdraftAllowed: true,
      });
      const result = await services.journal.postEntry({
        description: 'Euro sale',
        currency: 'USD',
        postings: [
          { accountId: euro.id, amount: usd(5_000n), fxRate: '1.08' },
          { accountId: euroRevenue.id, amount: usd(-5_000n), fxRate: '1.08' },
        ],
      });
      expect(result.ok).toBe(true);

      const rows = await services.reporting.trialBalance();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.currency).toBe('USD');
      expect(rows[0]?.balanced).toBe(true);
      // 50.00 EUR at 1.08 is 54.00 USD, debited and credited.
      expect(rows[0]?.debits.minorUnits).toBe('5400');
    });
  });

  describe('account statement', () => {
    it('returns undefined for an account that does not exist', async () => {
      expect(await services.reporting.statement('acct_nope', { limit: 10 })).toBeUndefined();
    });

    it('carries a running balance that ends at the account balance', async () => {
      await post('One', [
        { accountId: cash.id, amount: 10_000n },
        { accountId: revenue.id, amount: -10_000n },
      ]);
      await post('Two', [
        { accountId: cash.id, amount: 5_000n },
        { accountId: revenue.id, amount: -5_000n },
      ]);
      await post('Three', [
        { accountId: expenses.id, amount: 2_500n },
        { accountId: cash.id, amount: -2_500n },
      ]);

      const statement = await services.reporting.statement(cash.id, { limit: 10 });
      expect(statement).toBeDefined();
      if (!statement) return;

      // Newest first, so the first line's running balance is the current one.
      expect(statement.lines.items[0]?.runningBalance.amount).toBe('125.00');
      expect(statement.account.balance.amount).toBe('125.00');
      expect(statement.lines.items.map((line) => line.description)).toEqual([
        'Three',
        'Two',
        'One',
      ]);
      expect(statement.lines.items.map((line) => line.direction)).toEqual([
        'credit',
        'debit',
        'debit',
      ]);
    });

    it('presents a credit-normal account with positive running balances', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 10_000n },
        { accountId: revenue.id, amount: -10_000n },
      ]);

      const statement = await services.reporting.statement(revenue.id, { limit: 10 });
      expect(statement?.lines.items[0]?.runningBalance.amount).toBe('100.00');
    });

    it('pages without repeating or dropping a line', async () => {
      for (let i = 0; i < 5; i += 1) {
        await post(`Entry ${i}`, [
          { accountId: cash.id, amount: 1_000n },
          { accountId: revenue.id, amount: -1_000n },
        ]);
      }

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const statement = await services.reporting.statement(cash.id, { limit: 2, cursor });
        if (!statement) throw new Error('statement disappeared mid-pagination');
        seen.push(...statement.lines.items.map((line) => line.postingId));
        cursor = statement.lines.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('walks a statement back through the same lines it walked forward', async () => {
      for (let i = 0; i < 7; i += 1) {
        await post(`Entry ${i}`, [
          { accountId: cash.id, amount: 1_000n },
          { accountId: revenue.id, amount: -1_000n },
        ]);
      }

      const forward: string[][] = [];
      let cursor: string | undefined;
      let lastPage = await services.reporting.statement(cash.id, { limit: 3 });
      do {
        const statement = await services.reporting.statement(cash.id, { limit: 3, cursor });
        if (!statement) throw new Error('statement disappeared mid-pagination');
        forward.push(statement.lines.items.map((line) => line.postingId));
        lastPage = statement;
        cursor = statement.lines.nextCursor ?? undefined;
      } while (cursor);

      const backward: string[][] = [lastPage?.lines.items.map((line) => line.postingId) ?? []];
      let previous = lastPage?.lines.previousCursor ?? undefined;
      while (previous) {
        const statement = await services.reporting.statement(cash.id, {
          limit: 3,
          cursor: previous,
          direction: 'backward',
        });
        if (!statement) throw new Error('statement disappeared mid-pagination');
        backward.unshift(statement.lines.items.map((line) => line.postingId));
        previous = statement.lines.previousCursor ?? undefined;
      }

      expect(backward).toEqual(forward);
    });

    it('keeps the running balance consistent when paging backward', async () => {
      // The window function is ordered by the same key as the page, so the
      // balance beside a line must not change depending on how it was reached.
      for (let i = 0; i < 5; i += 1) {
        await post(`Entry ${i}`, [
          { accountId: cash.id, amount: 1_000n },
          { accountId: revenue.id, amount: -1_000n },
        ]);
      }

      const firstPage = await services.reporting.statement(cash.id, { limit: 2 });
      const secondPage = await services.reporting.statement(cash.id, {
        limit: 2,
        cursor: firstPage?.lines.nextCursor ?? undefined,
      });
      const backToFirst = await services.reporting.statement(cash.id, {
        limit: 2,
        cursor: secondPage?.lines.previousCursor ?? undefined,
        direction: 'backward',
      });

      expect(backToFirst?.lines.items).toEqual(firstPage?.lines.items);
    });
  });

  describe('summary', () => {
    it('counts accounts, entries and postings', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 10_000n },
        { accountId: revenue.id, amount: -10_000n },
      ]);

      expect(await services.reporting.summary()).toEqual({
        accountCount: 3,
        entryCount: 1,
        postingCount: 2,
      });
    });
  });

  describe('daily volume', () => {
    it('sums only the debit side, so a transfer counts once', async () => {
      await post('Sale', [
        { accountId: cash.id, amount: 10_000n },
        { accountId: revenue.id, amount: -10_000n },
      ]);

      const volume = await services.reporting.dailyVolume('USD', 30);
      // Today is the last point on the spine.
      expect(volume.at(-1)?.volume.amount).toBe('100.00');
      // 100 debit + 100 credit moved, but only 100 changed hands.
      const total = volume.reduce((sum, point) => sum + BigInt(point.volume.minorUnits), 0n);
      expect(total).toBe(10_000n);
    });

    it('returns a gap-free spine so quiet days plot as zero', async () => {
      // A chart that drops empty days compresses its x-axis and makes a gap
      // look like activity, so the query fills them rather than the component.
      const volume = await services.reporting.dailyVolume('USD', 30);
      expect(volume).toHaveLength(30);
      expect(volume.every((point) => point.volume.amount === '0.00')).toBe(true);

      const days = volume.map((point) => point.day);
      expect([...days].sort()).toEqual(days);
      expect(new Set(days).size).toBe(30);
    });

    it('clamps an absurd window rather than scanning forever', async () => {
      expect(await services.reporting.dailyVolume('USD', 10_000)).toHaveLength(366);
      expect(await services.reporting.dailyVolume('USD', 0)).toHaveLength(1);
    });
  });
});

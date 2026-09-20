import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { createAccountService } from '@/server/services/accounts';
import { organizations } from '@/server/db/schema';
import { minorUnits, type MinorUnits } from '@/lib/money';

/**
 * Unrealized foreign exchange: retranslating what you still hold.
 *
 * Realized gain and loss answers "the rate moved between booking and paying".
 * This answers the other half — the rate moved and you have *not* paid. A
 * 40,000 USD payable on a dong ledger is worth a different number of dong at
 * month end than when it was booked, and that difference is real whether or
 * not anyone settled anything.
 */
describe('FX revaluation', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let usdBank: { id: string };
  let payable: { id: string };
  let inventory: { id: string };
  let capital: { id: string };

  const vnd = (value: bigint): MinorUnits => minorUnits(value);

  const NOW = new Date(Date.UTC(2026, 2, 15, 12, 0, 0));
  const JANUARY = '2026-01-01';
  const inJanuary = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

  // 100,000.00 USD held, booked at 25,400 and worth 25,700 at month end.
  const HELD_USD = 10_000_000n;
  const AT_BOOKING = 2_540_000_000n;
  const AT_CLOSING = 2_570_000_000n;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));

    services = servicesFor(db, db.$orgId);
    const accountService = createAccountService(db, db.$orgId);

    usdBank = await openAccount(db, db.$orgId, {
      name: 'Vietcombank USD',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    payable = await openAccount(db, db.$orgId, {
      name: 'Supplier Payable USD',
      type: 'liability',
      currency: 'USD',
      overdraftAllowed: true,
    });
    // Bought in dollars and carried at the purchase-date rate forever.
    inventory = await accountService.create({
      name: 'Imported Stock',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
      monetary: false,
    });
    capital = await openAccount(db, db.$orgId, {
      name: 'Owner Capital',
      type: 'equity',
      currency: 'VND',
      overdraftAllowed: true,
    });
    // A closed period's profit has to land somewhere, so the close refuses
    // without this — including the profit a revaluation just created.
    await accountService.create({
      name: 'Lợi nhuận sau thuế chưa phân phối',
      type: 'equity',
      currency: 'VND',
      overdraftAllowed: true,
      role: 'retained_earnings',
    });
    await accountService.create({
      name: 'Chi phí tài chính',
      type: 'expense',
      currency: 'VND',
      overdraftAllowed: true,
      role: 'fx_gain_loss',
    });

    await services.rates.record({
      base: 'USD',
      quote: 'VND',
      rate: '25700',
      asOf: '2026-01-31',
    });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function hold(accountId: string, usd: bigint, base: bigint) {
    const result = await services.journal.postEntry({
      description: 'Opening foreign position',
      currency: 'VND',
      occurredAt: inJanuary(5),
      postings: [
        { accountId, amount: vnd(usd), baseAmount: vnd(base) },
        { accountId: capital.id, amount: vnd(-base) },
      ],
    });
    if (!result.ok) throw new Error(`setup failed: ${result.error.code}`);
  }

  async function baseBalanceOf(accountId: string): Promise<bigint> {
    const [row] = await db.select().from((await import('@/server/db/schema')).accounts);
    void row;
    const result = await services.accounts.byId(accountId);
    if (!result.ok) throw new Error('gone');
    return BigInt(result.value.balance.minorUnits);
  }

  describe('what it retranslates', () => {
    it('retranslates a foreign bank balance to the closing rate', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);

      const result = await services.revaluation.revalue(JANUARY, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const line = result.value.lines.find((l) => l.accountId === usdBank.id);
      expect(line?.carriedMinor).toBe(String(AT_BOOKING));
      expect(line?.retranslatedMinor).toBe(String(AT_CLOSING));
      // Holding dollars that got dearer is a gain.
      expect(line?.differenceMinor).toBe(String(AT_CLOSING - AT_BOOKING));
    });

    it('leaves the foreign balance itself untouched', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      await services.revaluation.revalue(JANUARY, NOW);

      // The dollars in the bank are the same dollars. Only their worth in
      // dong changed, which is why the posting carries a zero amount.
      expect(await baseBalanceOf(usdBank.id)).toBe(HELD_USD);
    });

    it('does not touch inventory bought in the same currency', async () => {
      // The most examined point in IAS 21: one credit purchase produces two
      // treatments. The payable moves every month end; the stock it bought
      // stays at the rate it was bought at.
      await hold(inventory.id, HELD_USD, AT_BOOKING);

      const result = await services.revaluation.revalue(JANUARY, NOW);
      expect(result.ok && result.value.lines).toHaveLength(0);
      expect(result.ok && result.value.entry).toBeNull();
    });

    it('retranslates a payable the other way', async () => {
      // Owing dollars that got dearer is a loss.
      await hold(payable.id, -HELD_USD, -AT_BOOKING);

      const result = await services.revaluation.revalue(JANUARY, NOW);
      if (!result.ok) throw new Error('rejected');
      const line = result.value.lines.find((l) => l.accountId === payable.id);
      expect(line?.differenceMinor).toBe(String(AT_BOOKING - AT_CLOSING));
    });
  });

  describe('the entry it posts', () => {
    it('balances, with the difference in FX gain/loss', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      const result = await services.revaluation.revalue(JANUARY, NOW);
      if (!result.ok || !result.value.entry) throw new Error('no entry');

      const entry = result.value.entry;
      expect(entry.postings).toHaveLength(2);
      // The retranslated leg moves no currency at all.
      const bankLeg = entry.postings.find((p) => p.accountId === usdBank.id);
      expect(bankLeg?.amount.minorUnits).toBe('0');
      expect(bankLeg?.baseAmount.minorUnits).toBe(String(AT_CLOSING - AT_BOOKING));
    });

    it('is cumulative, so running it twice posts nothing the second time', async () => {
      // The carrying amount genuinely changed, so the second run computes the
      // difference from the adjusted amount — which is zero.
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      const first = await services.revaluation.revalue(JANUARY, NOW);
      expect(first.ok && first.value.entry).not.toBeNull();

      const second = await services.revaluation.revalue(JANUARY, NOW);
      expect(second.ok && second.value.entry).toBeNull();
    });

    it('previews without posting', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);

      const preview = await services.revaluation.preview(JANUARY);
      expect(preview.ok && preview.value.entry).toBeNull();
      expect(preview.ok && preview.value.lines).toHaveLength(1);

      // Still unadjusted: a preview that changed something would not be one.
      const after = await services.revaluation.preview(JANUARY);
      expect(after.ok && after.value.lines[0]?.differenceMinor).toBe(
        String(AT_CLOSING - AT_BOOKING),
      );
    });
  });

  describe('rates', () => {
    it('uses the rate in force at month end, not today', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      // A later rate exists but belongs to a month that is not being closed.
      await services.rates.record({
        base: 'USD',
        quote: 'VND',
        rate: '26500',
        asOf: '2026-02-20',
      });

      const result = await services.revaluation.revalue(JANUARY, NOW);
      if (!result.ok) throw new Error('rejected');
      expect(result.value.lines[0]?.rate).toBe('25700');
    });

    it('refuses when no rate is on file for the pair', async () => {
      const gbp = await openAccount(db, db.$orgId, {
        name: 'Barclays GBP',
        type: 'asset',
        currency: 'GBP',
        overdraftAllowed: true,
      });
      await hold(gbp.id, 100_000n, 3_000_000_000n);

      const result = await services.revaluation.revalue(JANUARY, NOW);
      expect(!result.ok && result.error.code).toBe('rate_not_found');
    });

    it('treats a re-recorded rate as a correction, not a second opinion', async () => {
      await services.rates.record({
        base: 'USD',
        quote: 'VND',
        rate: '25750',
        asOf: '2026-01-31',
      });
      const rates = await services.rates.list();
      const january = rates.filter((r) => r.asOf === '2026-01-31');
      expect(january).toHaveLength(1);
      expect(january[0]?.rate).toBe('25750');
    });
  });

  describe('the close gate', () => {
    it('refuses to close a month with untranslated foreign balances', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);

      const close = await services.periods.close(JANUARY, NOW);
      expect(!close.ok && close.error.code).toBe('revaluation_required');
      expect(
        !close.ok && close.error.code === 'revaluation_required' && close.error.accounts,
      ).toContain('Vietcombank USD');
    });

    it('allows the close once retranslated', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      await services.revaluation.revalue(JANUARY, NOW);

      const close = await services.periods.close(JANUARY, NOW);
      expect(close.ok).toBe(true);
    });

    it('counts "we looked and nothing moved" as having looked', async () => {
      // A month where the rate did not move posts no entry, and the period
      // still records that it was retranslated — otherwise it would be
      // unclosable forever.
      await hold(usdBank.id, HELD_USD, AT_CLOSING);
      const revalued = await services.revaluation.revalue(JANUARY, NOW);
      expect(revalued.ok && revalued.value.entry).toBeNull();

      const close = await services.periods.close(JANUARY, NOW);
      expect(close.ok).toBe(true);
    });

    it('never gates a ledger with nothing foreign in it', async () => {
      const local = await openAccount(db, db.$orgId, {
        name: 'Tiền mặt',
        type: 'asset',
        currency: 'VND',
        overdraftAllowed: true,
      });
      await hold(local.id, 1_000_000n, 1_000_000n);

      const close = await services.periods.close(JANUARY, NOW);
      expect(close.ok).toBe(true);
    });

    it('will not revalue a month that is already closed', async () => {
      await hold(usdBank.id, HELD_USD, AT_BOOKING);
      await services.revaluation.revalue(JANUARY, NOW);
      await services.periods.close(JANUARY, NOW);

      const again = await services.revaluation.revalue(JANUARY, NOW);
      expect(!again.ok && again.error.code).toBe('period_already_closed');
    });

    it('will not revalue a month that has not finished', async () => {
      const result = await services.revaluation.revalue('2026-03-01', NOW);
      expect(!result.ok && result.error.code).toBe('period_not_finished');
    });
  });
});

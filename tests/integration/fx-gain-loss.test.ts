import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { createAccountService } from '@/server/services/accounts';
import { withTenant } from '@/server/db/tenancy';
import { organizations } from '@/server/db/schema';
import { minorUnits, type MinorUnits } from '@/lib/money';

/**
 * Realized foreign exchange gain and loss.
 *
 * An importer books a 40,000 USD supplier invoice on 1 September at 25,400
 * dong to the dollar, and pays it on the 20th when dollars cost 25,700. The
 * liability that left the books was worth twelve million dong less than the
 * money spent clearing it. That is a real loss and it belongs on the income
 * statement — an importer's margin lives or dies on this number.
 */
describe('realized FX gain and loss', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let usdBank: { id: string };
  let payable: { id: string };
  let receivable: { id: string };
  let fx: { id: string };

  const vnd = (value: bigint): MinorUnits => minorUnits(value);

  // 40,000.00 USD, in USD minor units.
  const INVOICE_USD = 4_000_000n;
  // The same dollars, in dong, at the two rates.
  const AT_BOOKING = 1_016_000_000n; // 25,400
  const AT_SETTLEMENT = 1_028_000_000n; // 25,700
  const DIFFERENCE = AT_SETTLEMENT - AT_BOOKING; // 12,000,000 VND

  beforeEach(async () => {
    db = await createTestDatabase();
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));

    services = servicesFor(db, db.$orgId);
    usdBank = await openAccount(db, db.$orgId, {
      name: 'Vietcombank USD',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    payable = await openAccount(db, db.$orgId, {
      name: 'Supplier Payable',
      type: 'liability',
      currency: 'USD',
      overdraftAllowed: true,
    });
    receivable = await openAccount(db, db.$orgId, {
      name: 'Customer Receivable',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    fx = await createAccountService(db, db.$orgId).create({
      name: 'Foreign Exchange Gain/Loss',
      type: 'expense',
      currency: 'VND',
      overdraftAllowed: true,
      role: 'fx_gain_loss',
    });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function balanceOf(accountId: string): Promise<bigint> {
    const result = await services.accounts.byId(accountId);
    if (!result.ok) throw new Error('account vanished');
    return BigInt(result.value.balance.minorUnits);
  }

  it('books the loss when the currency moved against you', async () => {
    // Clear the payable at the rate it was booked at, paying with dollars
    // that are now worth more dong. The dollars cancel exactly; the dong do
    // not, and the difference is the loss.
    const result = await services.journal.postEntry({
      description: 'Pay supplier invoice INV-4471',
      currency: 'VND',
      fxAdjustment: true,
      postings: [
        { accountId: payable.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_BOOKING) },
        { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_SETTLEMENT) },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Three legs: the caller wrote two and the adjustment supplied the third.
    const entry = result.value.transaction;
    expect(entry.postings).toHaveLength(3);

    const adjustment = entry.postings.find((posting) => posting.accountId === fx.id);
    expect(adjustment?.direction).toBe('debit');
    expect(adjustment?.amount.minorUnits).toBe(String(DIFFERENCE));
    // An expense debit is a loss, and it reads positive on the income
    // statement the way an accountant expects.
    expect(await balanceOf(fx.id)).toBe(DIFFERENCE);
  });

  it('books a gain when the currency moved in your favour', async () => {
    // A receivable booked when dollars were cheap, collected when they are
    // dear: you invoiced 1,016,000,000 dong of value and received
    // 1,028,000,000. The same mechanism, the other sign.
    const result = await services.journal.postEntry({
      description: 'Collect customer invoice',
      currency: 'VND',
      fxAdjustment: true,
      postings: [
        { accountId: receivable.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_BOOKING) },
        { accountId: usdBank.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_SETTLEMENT) },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const adjustment = result.value.transaction.postings.find(
      (posting) => posting.accountId === fx.id,
    );
    expect(adjustment?.direction).toBe('credit');
    // A credit balance on the expense account is a gain — which is why the
    // role requires overdraft to be allowed.
    expect(await balanceOf(fx.id)).toBe(-DIFFERENCE);
  });

  it('leaves the real accounts at exactly what moved', async () => {
    await services.journal.postEntry({
      description: 'Pay supplier',
      currency: 'VND',
      fxAdjustment: true,
      postings: [
        { accountId: payable.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_BOOKING) },
        { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_SETTLEMENT) },
      ],
    });

    // The bank really did part with 40,000 dollars, and the payable really is
    // cleared. The adjustment changed neither — it only recorded what the
    // difference in dong was worth.
    expect(await balanceOf(usdBank.id)).toBe(-INVOICE_USD);
    expect(await balanceOf(payable.id)).toBe(-INVOICE_USD);
  });

  describe('the rule that makes it safe', () => {
    it('refuses to absorb a mistyped amount', async () => {
      // This is the property the whole design turns on. The dollars do not
      // cancel — 40,000 out against 4,000 in — so the difference is not an
      // exchange difference, and the adjustment must not hide it.
      const result = await services.journal.postEntry({
        description: 'Fat finger',
        currency: 'VND',
        fxAdjustment: true,
        postings: [
          { accountId: payable.id, amount: vnd(400_000n), baseAmount: vnd(AT_BOOKING) },
          { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_SETTLEMENT) },
        ],
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe('currency_imbalance');
      expect(
        !result.ok && result.error.code === 'currency_imbalance' && result.error.currency,
      ).toBe('USD');
    });

    it('does nothing when there is no difference to absorb', async () => {
      const result = await services.journal.postEntry({
        description: 'Same rate both sides',
        currency: 'VND',
        fxAdjustment: true,
        postings: [
          { accountId: payable.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_BOOKING) },
          { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_BOOKING) },
        ],
      });

      expect(result.ok).toBe(true);
      // No third leg: an adjustment of zero is not an adjustment, and a
      // posting of zero is refused by the ledger anyway.
      expect(result.ok && result.value.transaction.postings).toHaveLength(2);
    });

    it('is opt-in, so an unadjusted entry still fails', async () => {
      // An adjustment applied by default is how a ledger hides arithmetic
      // errors, so the same entry without the flag is refused.
      const result = await services.journal.postEntry({
        description: 'Unadjusted settlement',
        currency: 'VND',
        postings: [
          { accountId: payable.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_BOOKING) },
          { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_SETTLEMENT) },
        ],
      });

      expect(!result.ok && result.error.code).toBe('unbalanced_transaction');
    });

    it('refuses when no account is designated to receive the difference', async () => {
      // Removed directly: the role is deliberately not something the account
      // API lets a caller take away, since an entry mid-flight would lose the
      // account it was going to balance against.
      // Inside a tenant context, or row-level security silently matches
      // nothing and the test passes for the wrong reason.
      await withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE accounts SET role = NULL WHERE role = 'fx_gain_loss'`),
      );

      const result = await services.journal.postEntry({
        description: 'Nowhere to put it',
        currency: 'VND',
        fxAdjustment: true,
        postings: [
          { accountId: payable.id, amount: vnd(INVOICE_USD), baseAmount: vnd(AT_BOOKING) },
          { accountId: usdBank.id, amount: vnd(-INVOICE_USD), baseAmount: vnd(-AT_SETTLEMENT) },
        ],
      });

      expect(!result.ok && result.error.code).toBe('fx_account_missing');
    });
  });

  describe('designating the account', () => {
    it('allows only one per tenant', async () => {
      await expectDatabaseError(
        createAccountService(db, db.$orgId).create({
          name: 'Second FX',
          type: 'expense',
          currency: 'VND',
          overdraftAllowed: true,
          role: 'fx_gain_loss',
        }),
        /accounts_one_fx_gain_loss|duplicate key/,
      );
    });

    it('requires an account that may hold either sign', async () => {
      // A month of favourable moves leaves an expense account with a credit
      // balance. That is a gain, not a violation — so the role demands an
      // account that permits it.
      await expectDatabaseError(
        createAccountService(db, db.$orgId).create({
          name: 'Strict FX',
          type: 'expense',
          currency: 'VND',
          overdraftAllowed: false,
          role: 'fx_gain_loss',
        }),
        /accounts_role_type_check|violates check constraint/,
      );
    });

    it('refuses a balance-sheet account', async () => {
      await expectDatabaseError(
        createAccountService(db, db.$orgId).create({
          name: 'Wrong Class',
          type: 'asset',
          currency: 'VND',
          overdraftAllowed: true,
          role: 'fx_gain_loss',
        }),
        /accounts_role_type_check|violates check constraint/,
      );
    });
  });
});

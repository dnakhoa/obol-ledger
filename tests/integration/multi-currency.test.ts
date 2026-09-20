import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { withTenant } from '@/server/db/tenancy';
import { organizations, postings } from '@/server/db/schema';
import { minorUnits, type MinorUnits } from '@/lib/money';

/**
 * An entry that crosses currencies.
 *
 * Until migration 0010 this was unrepresentable: a composite foreign key tied
 * every posting to its entry's currency, so nothing could pay a USD supplier
 * from a VND bank account. Across currencies "sums to zero" needs a unit, and
 * the unit is the organisation's functional currency.
 */
describe('multi-currency entries', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let vndBank: { id: string };
  let usdBank: { id: string };
  let payable: { id: string };

  const vnd = (value: bigint): MinorUnits => minorUnits(value);

  beforeEach(async () => {
    db = await createTestDatabase();
    // An importer keeping books in dong.
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));

    services = servicesFor(db, db.$orgId);
    vndBank = await openAccount(db, db.$orgId, {
      name: 'Vietcombank VND',
      type: 'asset',
      currency: 'VND',
      overdraftAllowed: true,
    });
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
  });

  afterEach(async () => {
    await db.$close();
  });

  async function postingRows(transactionId: string) {
    return withTenant(db, db.$orgId, async (tx) =>
      tx.select().from(postings).where(eq(postings.transactionId, transactionId)),
    );
  }

  it('buys foreign currency with local currency in one entry', async () => {
    // 25,470,500 VND out, 1,000.00 USD in, at 25,470.5 VND per USD. The two
    // legs are in different currencies and different minor-unit scales, and
    // the entry balances because both are worth the same in dong.
    const result = await services.journal.postEntry({
      description: 'Buy USD for supplier payment',
      currency: 'VND',
      postings: [
        { accountId: vndBank.id, amount: vnd(-25_470_500n) },
        { accountId: usdBank.id, amount: vnd(100_000n), fxRate: '25470.5' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await postingRows(result.value.transaction.id);
    const usdLeg = rows.find((row) => row.currency === 'USD');
    const vndLeg = rows.find((row) => row.currency === 'VND');

    // Each posting keeps the amount that actually moved…
    expect(usdLeg?.amountMinor).toBe(100_000n);
    expect(vndLeg?.amountMinor).toBe(-25_470_500n);
    // …and what it was worth in the functional currency.
    expect(usdLeg?.baseAmountMinor).toBe(25_470_500n);
    expect(vndLeg?.baseAmountMinor).toBe(-25_470_500n);
    // The balance rule is about the second pair, and only the second.
    expect((usdLeg?.baseAmountMinor ?? 0n) + (vndLeg?.baseAmountMinor ?? 0n)).toBe(0n);
    expect((usdLeg?.amountMinor ?? 0n) + (vndLeg?.amountMinor ?? 0n)).not.toBe(0n);
  });

  it('records the rate that was used', async () => {
    const result = await services.journal.postEntry({
      description: 'Buy USD',
      currency: 'VND',
      postings: [
        { accountId: vndBank.id, amount: vnd(-25_470_500n) },
        { accountId: usdBank.id, amount: vnd(100_000n), fxRate: '25470.5' },
      ],
    });
    if (!result.ok) throw new Error('entry rejected');

    const rows = await postingRows(result.value.transaction.id);
    const usdLeg = rows.find((row) => row.currency === 'USD');
    expect(Number(usdLeg?.fxRate)).toBeCloseTo(25_470.5, 4);
    // A posting already in the functional currency is at a rate of one.
    expect(Number(rows.find((row) => row.currency === 'VND')?.fxRate)).toBe(1);
  });

  it('accepts a base amount instead of a rate', async () => {
    // The caller who has already decided both amounts owns the rounding, and
    // is not asked to restate a rate that could disagree with them.
    const result = await services.journal.postEntry({
      description: 'Supplier invoice',
      currency: 'VND',
      postings: [
        { accountId: payable.id, amount: vnd(-40_000_00n), baseAmount: vnd(-1_018_820_000n) },
        { accountId: vndBank.id, amount: vnd(1_018_820_000n) },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an entry that balances in neither currency', async () => {
    const result = await services.journal.postEntry({
      description: 'Wrong rate',
      currency: 'VND',
      postings: [
        { accountId: vndBank.id, amount: vnd(-25_470_500n) },
        // A rate an order of magnitude out. Each leg is individually fine;
        // the entry is not.
        { accountId: usdBank.id, amount: vnd(100_000n), fxRate: '2547.05' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('unbalanced_transaction');
  });

  it('refuses a rate that is not a positive decimal', async () => {
    const result = await services.journal.postEntry({
      description: 'Nonsense rate',
      currency: 'VND',
      postings: [
        { accountId: vndBank.id, amount: vnd(-25_470_500n) },
        { accountId: usdBank.id, amount: vnd(100_000n), fxRate: '-3' },
      ],
    });
    expect(!result.ok && result.error.code).toBe('invalid_fx_rate');
  });

  it('refuses a base amount that contradicts the account currency', async () => {
    // A posting already in the functional currency has exactly one correct
    // base amount. A caller supplying a different one is told, rather than
    // quietly overruled.
    const result = await services.journal.postEntry({
      description: 'Contradictory',
      currency: 'VND',
      postings: [
        { accountId: vndBank.id, amount: vnd(-100n), baseAmount: vnd(-999n) },
        { accountId: usdBank.id, amount: vnd(100n), fxRate: '1' },
      ],
    });
    expect(!result.ok && result.error.code).toBe('currency_mismatch');
  });

  describe('enforced by Postgres, not the service', () => {
    it('rejects an unbalanced pair at COMMIT even written directly', async () => {
      const result = await services.journal.postEntry({
        description: 'Valid entry',
        currency: 'VND',
        postings: [
          { accountId: vndBank.id, amount: vnd(-25_470_500n) },
          { accountId: usdBank.id, amount: vnd(100_000n), fxRate: '25470.5' },
        ],
      });
      if (!result.ok) throw new Error('setup entry rejected');

      await expectDatabaseError(
        withTenant(db, db.$orgId, async (tx) => {
          await tx.execute(sql`
            INSERT INTO transactions (id, org_id, description, currency, occurred_at, status, posted_at)
            VALUES ('txn_direct0000000000000000', ${db.$orgId}, 'Direct', 'VND', now(), 'posted', now())
          `);
          await tx.execute(sql`
            INSERT INTO postings (id, org_id, transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate, sequence)
            VALUES
              ('post_d10000000000000000000000', ${db.$orgId}, 'txn_direct0000000000000000', ${vndBank.id}, -100, 'VND', -100, 1, 0),
              ('post_d20000000000000000000000', ${db.$orgId}, 'txn_direct0000000000000000', ${usdBank.id}, 1, 'USD', 50, 50, 1)
          `);
        }),
        /unbalanced by -50 minor units of the functional currency/,
      );
    });

    it('rejects a base amount pointing the opposite way', async () => {
      // A debit of 100 USD cannot be worth a credit of 2,500,000 VND.
      await expectDatabaseError(
        withTenant(db, db.$orgId, async (tx) => {
          await tx.execute(sql`
            INSERT INTO transactions (id, org_id, description, currency, occurred_at, status, posted_at)
            VALUES ('txn_sign00000000000000000', ${db.$orgId}, 'Sign', 'VND', now(), 'posted', now())
          `);
          await tx.execute(sql`
            INSERT INTO postings (id, org_id, transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate, sequence)
            VALUES ('post_s10000000000000000000000', ${db.$orgId}, 'txn_sign00000000000000000', ${usdBank.id}, 100, 'USD', -2500000, 25000, 0)
          `);
        }),
        /postings_base_sign_check|violates check constraint/,
      );
    });

    it('rejects a rate of zero', async () => {
      await expectDatabaseError(
        withTenant(db, db.$orgId, async (tx) => {
          await tx.execute(sql`
            INSERT INTO transactions (id, org_id, description, currency, occurred_at, status, posted_at)
            VALUES ('txn_zero00000000000000000', ${db.$orgId}, 'Zero', 'VND', now(), 'posted', now())
          `);
          await tx.execute(sql`
            INSERT INTO postings (id, org_id, transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate, sequence)
            VALUES ('post_z10000000000000000000000', ${db.$orgId}, 'txn_zero00000000000000000', ${usdBank.id}, 100, 'USD', 100, 0, 0)
          `);
        }),
        /postings_fx_rate_check|violates check constraint/,
      );
    });
  });

  it('still keeps a posting out of an account that does not hold its currency', async () => {
    // The `(account_id, currency)` key stays. It was never the constraint in
    // the way — only `(transaction_id, currency)` was.
    await expectDatabaseError(
      withTenant(db, db.$orgId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO transactions (id, org_id, description, currency, occurred_at, status, posted_at)
          VALUES ('txn_wrongcur000000000000', ${db.$orgId}, 'Wrong', 'VND', now(), 'posted', now())
        `);
        await tx.execute(sql`
          INSERT INTO postings (id, org_id, transaction_id, account_id, amount_minor, currency, base_amount_minor, fx_rate, sequence)
          VALUES ('post_w10000000000000000000000', ${db.$orgId}, 'txn_wrongcur000000000000', ${vndBank.id}, 100, 'USD', 100, 1, 0)
        `);
      }),
      /postings_account_currency_fk|violates foreign key/,
    );
  });
});

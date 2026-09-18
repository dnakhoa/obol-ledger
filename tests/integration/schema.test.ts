import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { accounts } from '@/server/db/schema';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';

/**
 * These tests bypass the service layer on purpose.
 *
 * Their subject is the database itself: if someone connects with psql and tries
 * to write a corrupt ledger, does Postgres stop them? Every assertion here is a
 * guarantee the application layer is then free to rely on.
 */
describe('schema invariants', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.execute(sql`
      INSERT INTO accounts (id, name, type, currency, overdraft_allowed)
      VALUES
        ('acct_cash',    'Cash',    'asset',     'USD', false),
        ('acct_revenue', 'Revenue', 'revenue',   'USD', true),
        ('acct_loan',    'Loan',    'liability', 'USD', true),
        ('acct_eur',     'Euro',    'asset',     'EUR', true)
    `);
    await db.execute(sql`
      INSERT INTO transactions (id, description, currency, occurred_at)
      VALUES ('txn_seed', 'seed', 'USD', now())
    `);
  });

  afterAll(async () => {
    await db.$close();
  });

  it('rejects an entry whose postings do not sum to zero', async () => {
    const unbalanced = db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO transactions (id, description, currency, occurred_at)
        VALUES ('txn_unbalanced', 'bad', 'USD', now())
      `);
      await tx.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES
          ('post_a', 'txn_unbalanced', 'acct_cash',      1000, 'USD', 0),
          ('post_b', 'txn_unbalanced', 'acct_revenue', 0 - 999, 'USD', 1)
      `);
    });

    await expectDatabaseError(unbalanced, /unbalanced by 1 minor units/);
  });

  it('rejects a single-sided entry', async () => {
    const oneSided = db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO transactions (id, description, currency, occurred_at)
        VALUES ('txn_single', 'bad', 'USD', now())
      `);
      // acct_revenue allows overdraft, so nothing but the double-entry rule
      // itself can reject this row.
      await tx.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES ('post_single', 'txn_single', 'acct_revenue', 1000, 'USD', 0)
      `);
    });

    await expectDatabaseError(oneSided, /requires at least two/);
  });

  it('makes a cross-currency posting unrepresentable', async () => {
    // acct_eur holds EUR, so the composite foreign key has no row to point at.
    await expectDatabaseError(
      db.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES ('post_x', 'txn_seed', 'acct_eur', 100, 'USD', 99)
      `),
      /postings_account_currency_fk/,
    );
  });

  it('accepts a balanced entry and updates the cached balances', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO transactions (id, description, currency, occurred_at)
        VALUES ('txn_good', 'sale', 'USD', now())
      `);
      await tx.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES
          ('post_c', 'txn_good', 'acct_cash',        2500, 'USD', 0),
          ('post_d', 'txn_good', 'acct_revenue', 0 - 2500, 'USD', 1)
      `);
    });

    // Read through the ORM rather than raw SQL: drivers disagree on how they
    // hand back int8 (PGlite gives a number, node-postgres a string), and the
    // mapping that normalises it to bigint is part of what we want covered.
    const rows = await db
      .select({ id: accounts.id, balance: accounts.balanceMinor })
      .from(accounts)
      .where(inArray(accounts.id, ['acct_cash', 'acct_revenue']))
      .orderBy(accounts.id);

    expect(rows).toEqual([
      { id: 'acct_cash', balance: 2500n },
      { id: 'acct_revenue', balance: -2500n },
    ]);
  });

  it('refuses to overdraw an account that does not allow it', async () => {
    const overdraft = db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO transactions (id, description, currency, occurred_at)
        VALUES ('txn_overdraw', 'too much', 'USD', now())
      `);
      await tx.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES
          ('post_e', 'txn_overdraw', 'acct_cash', 0 - 999999, 'USD', 0),
          ('post_f', 'txn_overdraw', 'acct_loan',     999999, 'USD', 1)
      `);
    });

    await expectDatabaseError(overdraft, /accounts_overdraft_check/);
  });

  it('refuses to edit or delete history', async () => {
    await expectDatabaseError(
      db.execute(sql`UPDATE postings SET amount_minor = 1 WHERE id = 'post_c'`),
      /append-only/,
    );
    await expectDatabaseError(
      db.execute(sql`DELETE FROM transactions WHERE id = 'txn_good'`),
      /append-only/,
    );
  });

  it('refuses to post to a closed account', async () => {
    await db.execute(sql`UPDATE accounts SET status = 'closed' WHERE id = 'acct_loan'`);
    await expectDatabaseError(
      db.execute(sql`
        INSERT INTO postings (id, transaction_id, account_id, amount_minor, currency, sequence)
        VALUES ('post_g', 'txn_seed', 'acct_loan', 100, 'USD', 98)
      `),
      /is closed/,
    );
    await db.execute(sql`UPDATE accounts SET status = 'open' WHERE id = 'acct_loan'`);
  });
});

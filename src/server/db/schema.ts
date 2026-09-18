import {
  bigint,
  boolean,
  char,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES } from '@/server/domain/account';

/**
 * The ledger schema.
 *
 * Two things are deliberately pushed down into Postgres rather than being left
 * to application code, because "the application is the only writer" stops being
 * true the moment someone opens psql or a second service appears:
 *
 *  - **Currency agreement** is enforced by composite foreign keys. A posting
 *    references `(account_id, currency)` and `(transaction_id, currency)`, so a
 *    posting in a currency its account does not hold is not merely rejected —
 *    it is unrepresentable.
 *  - **The balance invariant** is enforced by a deferred constraint trigger
 *    that runs at COMMIT (see `drizzle/0001_ledger_invariants.sql`), once every
 *    posting of the entry is present.
 *
 * `accounts.balance_minor` is a cache of `SUM(postings.amount_minor)`,
 * maintained by trigger so it cannot drift from the postings that justify it.
 */

export const accountType = pgEnum('account_type', ACCOUNT_TYPES);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    status: accountStatus('status').notNull().default('open'),
    /** When false, the account's presented balance may never go below zero. */
    overdraftAllowed: boolean('overdraft_allowed').notNull().default(false),
    /** Signed cache of the account's postings; debit-positive. Trigger-maintained. */
    balanceMinor: bigint('balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Target of the postings composite foreign key: an account's currency is
    // immutable from the postings' point of view.
    unique('accounts_id_currency_key').on(table.id, table.currency),
    index('accounts_type_idx').on(table.type),
    unique('accounts_name_currency_key').on(table.name, table.currency),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    description: text('description').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** When the economic event happened, which is not always when we recorded it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('transactions_id_currency_key').on(table.id, table.currency),
    // Ids are ULIDs, so a descending id scan is also a descending time scan.
    index('transactions_occurred_at_idx').on(table.occurredAt, table.id),
  ],
);

export const postings = pgTable(
  'postings',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    accountId: text('account_id').notNull(),
    /** Signed minor units: positive debits the account, negative credits it. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Position within the entry, so a journal renders in the order it was written. */
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'postings_transaction_currency_fk',
      columns: [table.transactionId, table.currency],
      foreignColumns: [transactions.id, transactions.currency],
    }).onDelete('restrict'),
    foreignKey({
      name: 'postings_account_currency_fk',
      columns: [table.accountId, table.currency],
      foreignColumns: [accounts.id, accounts.currency],
    }).onDelete('restrict'),
    uniqueIndex('postings_transaction_sequence_key').on(table.transactionId, table.sequence),
    // Keyset pagination of an account's statement: WHERE account_id = $1 AND id < $2.
    index('postings_account_id_idx').on(table.accountId, table.id),
  ],
);

/**
 * Replay cache for `Idempotency-Key`.
 *
 * The fingerprint is a hash of the canonicalised request body. Replaying a key
 * with the same body returns the stored response; replaying it with a different
 * body is a client bug and is rejected, rather than silently posting twice or
 * silently returning someone else's transaction.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'restrict',
    }),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idempotency_keys_expires_at_idx').on(table.expiresAt)],
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  postings: many(postings),
}));

export const transactionsRelations = relations(transactions, ({ many }) => ({
  postings: many(postings),
}));

export const postingsRelations = relations(postings, ({ one }) => ({
  transaction: one(transactions, {
    fields: [postings.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [postings.accountId],
    references: [accounts.id],
  }),
}));

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type PostingRow = typeof postings.$inferSelect;
export type NewPostingRow = typeof postings.$inferInsert;

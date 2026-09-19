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
  primaryKey,
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
 *
 * Tenancy follows the same principle. Every ledger table carries `org_id` and
 * is covered by a `FORCE`d row-level security policy keyed on
 * `current_setting('app.current_org')`, so isolation is a property of the
 * database rather than a `WHERE` clause each query has to remember. See
 * `drizzle/0002_tenancy.sql` and `docs/adr/0007-tenant-isolation.md`.
 */

/**
 * A tenant. Control-plane tables (`organizations`, `api_keys`) deliberately
 * carry no RLS policy: resolving a request's tenant requires reading them
 * *before* a tenant is known, so a policy keyed on the tenant would be
 * circular. They are never exposed through a tenant-facing endpoint.
 */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An API credential, stored as a SHA-256 digest rather than in the clear.
 *
 * A leaked backup then yields nothing usable, and lookup is still one indexed
 * probe because the digest is the search key. `revokedAt` is a timestamp rather
 * than a delete so a revoked key stays auditable.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    tokenDigest: text('token_digest').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('api_keys_org_id_idx').on(table.orgId)],
);

export const accountType = pgEnum('account_type', ACCOUNT_TYPES);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
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
    unique('accounts_org_name_currency_key').on(table.orgId, table.name, table.currency),
    unique('accounts_id_org_key').on(table.id, table.orgId),
    index('accounts_org_idx').on(table.orgId, table.name),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
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
    index('transactions_org_occurred_idx').on(table.orgId, table.occurredAt, table.id),
  ],
);

export const postings = pgTable(
  'postings',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
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
    // Extends the same trick to tenancy: a posting pointing at another
    // tenant's account has no row to reference, so it is unrepresentable
    // rather than merely filtered out.
    foreignKey({
      name: 'postings_account_org_fk',
      columns: [table.accountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'postings_transaction_org_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
    index('postings_org_account_idx').on(table.orgId, table.accountId, table.id),
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
    orgId: text('org_id').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'restrict',
    }),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'idempotency_keys_pkey', columns: [table.orgId, table.key] }),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  ],
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

export type OrganizationRow = typeof organizations.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type PostingRow = typeof postings.$inferSelect;
export type NewPostingRow = typeof postings.$inferInsert;

import {
  bigint,
  boolean,
  char,
  date,
  numeric,
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
import { TRANSACTION_STATUSES } from '@/server/domain/transaction-status';
import { DELIVERY_STATUSES } from '@/server/domain/webhook';
import { ACCOUNT_ROLES, PERIOD_STATUSES } from '@/server/domain/period';

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
  /**
   * The currency the books are kept in.
   *
   * Every posting is also measured in this, and the balance rule applies to
   * that measurement — across currencies, "sums to zero" needs a unit. See
   * `docs/adr/0010-multi-currency.md`.
   */
  functionalCurrency: char('functional_currency', { length: 3 }).notNull().default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rates as point-in-time facts, never updated.
 *
 * A rate that changes is a new row with a later `as_of`, and a lookup asks for
 * the most recent one at or before the entry's date — so re-running last
 * quarter's reports uses last quarter's rates, which is the only way a
 * restated figure can be explained.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    baseCurrency: char('base_currency', { length: 3 }).notNull(),
    quoteCurrency: char('quote_currency', { length: 3 }).notNull(),
    /** One unit of base is worth this many of quote. Numeric, never a float. */
    rate: numeric('rate', { precision: 20, scale: 10 }).notNull(),
    asOf: date('as_of').notNull(),
    /** Where it came from: a provider, a contract, a customs declaration. */
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('exchange_rates_unique_key').on(
      table.orgId,
      table.baseCurrency,
      table.quoteCurrency,
      table.asOf,
      table.source,
    ),
    index('exchange_rates_lookup_idx').on(
      table.orgId,
      table.baseCurrency,
      table.quoteCurrency,
      table.asOf,
    ),
  ],
);

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
    /**
     * The token's opening characters, in the clear.
     *
     * Not a weakening of the digest — it is what lets a person with four keys
     * tell them apart. Without it a management screen can only offer the name
     * someone typed months ago, and revoking the right one becomes a guess.
     */
    tokenPrefix: text('token_prefix').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('api_keys_org_id_idx').on(table.orgId)],
);

export const accountType = pgEnum('account_type', ACCOUNT_TYPES);
export const accountStatus = pgEnum('account_status', ACCOUNT_STATUSES);
export const transactionStatus = pgEnum('transaction_status', TRANSACTION_STATUSES);
export const periodStatus = pgEnum('period_status', PERIOD_STATUSES);
export const accountRole = pgEnum('account_role', ACCOUNT_ROLES);

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
    /**
     * A structural job this account does, beyond its class.
     *
     * Only retained earnings so far, and designated by a column rather than
     * found by name — "Retained Earnings" is a string a tenant may rename or
     * translate, and a closing routine matching on it breaks silently the day
     * somebody does. A partial unique index allows one per tenant.
     */
    role: accountRole('role'),
    /**
     * Signed cache of the account's *posted* postings; debit-positive.
     * Trigger-maintained. Pending entries are not included here.
     */
    balanceMinor: bigint('balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /**
     * The same balance in the organisation's functional currency.
     *
     * Maintained by the same trigger, so the two cannot drift apart. Without
     * it the trial balance has nothing to sum: adding a dong balance to a
     * dollar balance produces a number with no meaning, and it only ever
     * looked right because every account was USD.
     */
    baseBalanceMinor: bigint('base_balance_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /**
     * In-flight amounts, in presented terms — the sign a reader expects.
     *
     * Kept as two non-negative totals rather than one signed number because
     * `available` only subtracts the *outflows*: an unsettled deposit does not
     * make money spendable, while an unsettled withdrawal does reserve it.
     */
    pendingInflowMinor: bigint('pending_inflow_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    pendingOutflowMinor: bigint('pending_outflow_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Optimistic-concurrency token, incremented on every balance change. */
    version: integer('version').notNull().default(0),
    /**
     * Caller-supplied annotation: an invoice id, an order number, their own
     * reference. Deliberately a bag of strings rather than a schema — the
     * moment it has a schema it is a domain model, and the domain belongs to
     * the caller rather than to the ledger.
     */
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

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
    /**
     * pending -> posted | archived.
     *
     * A pending entry is a proposal: its amounts are already immutable, but it
     * has not settled, so it reserves funds without moving them. Posted and
     * archived are terminal — correcting either needs a reversing entry.
     */
    status: transactionStatus('status').notNull().default('posted'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** When the economic event happened, which is not always when we recorded it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /**
     * Caller-supplied annotation — see the note on `accounts.metadata`.
     *
     * The one field of an entry that may change after it settles, because an
     * invoice reference often arrives after the entry does. Refusing it would
     * push the caller back to the parallel mapping table this exists to
     * remove. Everything an accountant would recognise as the entry stays
     * frozen; `obol_guard_transaction_mutation` is the authority.
     */
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * Set when this entry exists to undo another one.
     *
     * A partial unique index enforces at most one reversal per entry, so two
     * concurrent reversal requests resolve in the database rather than in a
     * check either of them could win.
     */
    reversesTransactionId: text('reverses_transaction_id'),
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
    /**
     * The same movement, measured in the organisation's functional currency.
     *
     * This is what the balance rule checks. Supplied rather than computed
     * here — rounding a rate multiplication per leg is how an entry stops
     * summing to zero, and where that cent goes is an accounting policy
     * rather than arithmetic. See `docs/adr/0010-multi-currency.md`.
     */
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),
    /** The rate used, recorded for audit. Nothing is checked against it. */
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }).notNull(),
    /** Position within the entry, so a journal renders in the order it was written. */
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // `(transaction_id, currency)` deliberately absent: it is the constraint
    // that made a cross-currency entry unrepresentable, and dropping it is
    // the substance of migration 0010. The account one stays — a posting
    // still cannot be denominated in a currency its account does not hold.
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

export const deliveryStatus = pgEnum('webhook_delivery_status', DELIVERY_STATUSES);

/**
 * A subscriber's HTTPS endpoint.
 *
 * The signing secret is stored in the clear, unlike an API key — and that is
 * not an oversight. An API key is a *bearer* credential: the server only ever
 * needs to recognise one, so a digest suffices and a database leak yields
 * nothing usable. A webhook secret is a *shared* symmetric key that this side
 * must reproduce on every delivery in order to sign. There is no digest that
 * can be signed with. The honest mitigations are rotation and encryption at
 * rest, not a hash that would make the feature impossible.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    url: text('url').notNull(),
    description: text('description'),
    secret: text('secret').notNull(),
    /** Event types this endpoint wants. Empty means every type. */
    eventTypes: jsonb('event_types')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Drives the circuit breaker. A subscriber whose endpoint has been gone
     * for days should not cost a retry budget forever, so a run of failures
     * disables it and the operator re-enables it deliberately.
     */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('webhook_endpoints_org_url_key').on(table.orgId, table.url),
    index('webhook_endpoints_org_idx').on(table.orgId, table.createdAt),
  ],
);

/**
 * The outbox: one row per (event, endpoint), written inside the same
 * transaction as the ledger change that caused it.
 *
 * This is the whole point of the table. A webhook fired after COMMIT — from a
 * queue client, an HTTP call, a `setTimeout` — is lost if the process dies in
 * the gap, and a subscriber that never hears about a posted entry has no way
 * to discover the omission. A row written *in* the transaction cannot
 * disagree with the ledger: either both exist or neither does.
 *
 * Fan-out happens at write time rather than at delivery time, which duplicates
 * the payload across endpoints. That is a deliberate trade — see
 * `docs/adr/0009-webhooks.md`.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    endpointId: text('endpoint_id').notNull(),
    /**
     * Stable across every attempt and every retry of the same event, so a
     * subscriber can deduplicate. At-least-once delivery is the only honest
     * guarantee over HTTP; this is what makes it survivable for the receiver.
     */
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** When this row next becomes claimable. Drives the backoff schedule. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'webhook_deliveries_endpoint_fk',
      columns: [table.endpointId],
      foreignColumns: [webhookEndpoints.id],
    }).onDelete('cascade'),
    // The claim query's covering index: status first, then due time, so a
    // worker reads only the rows it is about to take.
    index('webhook_deliveries_claim_idx').on(table.status, table.nextAttemptAt),
    index('webhook_deliveries_endpoint_idx').on(table.endpointId, table.createdAt),
    index('webhook_deliveries_org_idx').on(table.orgId, table.createdAt),
  ],
);

/**
 * A month of the ledger, and whether it still accepts entries.
 *
 * Monthly rather than an arbitrary date range: overlap becomes a unique
 * constraint instead of needing an exclusion constraint over `daterange`,
 * whose `btree_gist` dependency the embedded Postgres the tests run against
 * does not carry. See `drizzle/0009_period_close.sql`.
 */
export const accountingPeriods = pgTable(
  'accounting_periods',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** The first day of the month covered; a CHECK enforces that. */
    periodMonth: date('period_month').notNull(),
    status: periodStatus('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** The entry that zeroed revenue and expense. Null while open. */
    closingTransactionId: text('closing_transaction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('accounting_periods_org_month_key').on(table.orgId, table.periodMonth),
    index('accounting_periods_org_idx').on(table.orgId, table.periodMonth),
  ],
);

/**
 * Shared rate-limit counters.
 *
 * Not tenant data and carrying no policy: the key is a client and a route, and
 * the check runs before a tenant is resolved. See `drizzle/0008_rate_limits.sql`.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    /** The window before this one, weighted by elapsed time into the current. */
    previousCount: integer('previous_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rate_limits_updated_at_idx').on(table.updatedAt)],
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

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
import type { CostingMethod, WriteOffReason } from '@/server/domain/costing';
import type { AllocationBasis } from '@/server/domain/landed-cost';
import type { Supply, TaxTreatment } from '@/server/domain/tax';
import type { Unit } from '@/lib/quantity';
import type { Locale } from '@/lib/i18n/locales';

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
  /**
   * Which chart of accounts this tenant keeps.
   *
   * Carried onto every account row and pinned there by a composite foreign
   * key, so a statutory chart's rules can be a CHECK on the account rather
   * than a trigger that reads this table.
   */
  chartTemplate: text('chart_template').notNull().default('generic'),
  /**
   * How this tenant decides what the stock that left actually cost.
   *
   * Beside the chart template because it is the same shape of decision:
   * partly convention, partly law. LIFO is permitted under US GAAP and
   * prohibited under IFRS and Vietnamese VAS, and a CHECK refuses it on any
   * chart but the US one. See `docs/adr/0013-inventory-costing.md`.
   */
  costingMethod: text('costing_method').$type<CostingMethod>().notNull().default('fifo'),
  /**
   * The language the *books* are kept in — not the viewer's.
   *
   * Only the descriptions the ledger writes for itself follow this: a closing
   * entry, a revaluation, the cost of goods sold behind a shipment. Those
   * become part of the accounting record and cannot be retranslated later
   * without rewriting history. Account names and anything a person typed are
   * left exactly as they were typed.
   */
  locale: text('locale').$type<Locale>().notNull().default('en'),
  /**
   * The one ledger a signed-out visitor may read.
   *
   * A column rather than a slug compared against an environment variable,
   * because that is how a tenant becomes publicly readable by renaming
   * itself. A partial unique index allows exactly one.
   */
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/*
 * Authentication tables.
 *
 * Shaped by the auth library rather than by this project's conventions —
 * camel-case column names and singular table names included — because a
 * schema the library does not recognise is a schema it cannot migrate. They
 * carry no row-level security policy, for the same reason `api_keys` does
 * not: resolving a session happens before a tenant is known.
 */
export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

export const authAccounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The join that authorises.
 *
 * Authentication is delegated; this is not. A membership row is what turns a
 * session into an `org_id`, and every row-level security policy in the schema
 * takes it from there — which is why this is the project's own table rather
 * than the auth library's organisation plugin. Two organisation tables would
 * be two answers to the one question the policies key off.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('memberships_user_org_key').on(table.userId, table.orgId),
    index('memberships_user_idx').on(table.userId, table.createdAt),
  ],
);

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
    /**
     * The number an accountant actually files this under.
     *
     * Nullable: every account that predates this had none, and a
     * conventional-chart tenant may genuinely not want one. A statutory chart
     * is different, and a CHECK says so.
     */
    code: text('code'),
    /** Denormalised from the organisation and pinned by a composite key. */
    chartTemplate: text('chart_template').notNull().default('generic'),
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
    /**
     * Whether this account holds a fixed number of currency units.
     *
     * IAS 21's distinction, and the one our five account types cannot make:
     * cash, receivables and payables are *monetary* and are retranslated at
     * each period end; inventory and fixed assets are not, and stay at the
     * rate they were bought at. One credit purchase of stock produces both
     * treatments at once.
     */
    monetary: boolean('monetary').notNull().default(true),
    /**
     * Whether this account is managed as a set of open items.
     *
     * "How long has this been outstanding" only means something for an
     * account whose balance is unsettled documents — invoices a customer has
     * not paid, bills we have not. A bank account is a monetary asset with a
     * balance exactly like a receivable, and ageing it produces a confident,
     * meaningless table: that money is not outstanding, it is there.
     *
     * The third property the five types cannot express, after `monetary` and
     * `role`, and carried the same way rather than guessed from a code prefix
     * that would only work on one chart.
     */
    openItems: boolean('open_items').notNull().default(false),
    /** Days a customer or supplier has to pay; null assumes thirty. Only on open items. */
    paymentTermsDays: integer('payment_terms_days'),
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
    // The chart is read in code order, so it is indexed in code order.
    index('accounts_org_code_idx').on(table.orgId, table.code),
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
    /**
     * Who entered this, and by what route.
     *
     * Nullable because every entry written before this column existed has no
     * author, and inventing one would be inventing evidence. No foreign key
     * to `user`: deleting a person must not be blocked by, or cascade into,
     * the entries they posted — those are the accounting record and they
     * outlive the account.
     */
    createdBy: text('created_by'),
    createdVia: text('created_via')
      .$type<'ui' | 'api' | 'system' | 'import' | 'unknown'>()
      .notNull()
      .default('unknown'),
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
    /** When foreign monetary balances were retranslated for this month. */
    revaluedAt: timestamp('revalued_at', { withTimezone: true }),
    revaluationTransactionId: text('revaluation_transaction_id'),
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
/**
 * A thing that is bought, held and sold.
 *
 * Distinct from the account it sits in, which is the whole point: one
 * inventory account holds many items, so the account balance alone can never
 * answer "what did that container cost" — the question the spreadsheet exists
 * to answer.
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** What the business calls it. Unique within the tenant. */
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    /** Closed list; see `src/lib/quantity.ts` for why it is not free text. */
    unit: text('unit').$type<Unit>().notNull(),
    /** Decimal places this item's quantities carry. Scaled integers, like money. */
    quantityPrecision: integer('quantity_precision').notNull().default(0),
    /** Where the stock sits, and where its cost goes when it leaves. */
    inventoryAccountId: text('inventory_account_id').notNull(),
    cogsAccountId: text('cogs_account_id').notNull(),
    /**
     * Null means "whatever the organisation uses".
     *
     * Overridable per item because a business genuinely needs two at once: a
     * granite block is not interchangeable with another granite block and
     * IAS 2 requires specific identification for it, while a pallet of pavers
     * is interchangeable and FIFO is right.
     */
    costingMethod: text('costing_method').$type<CostingMethod>(),
    /** Denormalised from the organisation and pinned by a composite key. */
    chartTemplate: text('chart_template').notNull().default('generic'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_items_id_org_key').on(table.id, table.orgId),
    uniqueIndex('inventory_items_org_sku_key').on(table.orgId, table.sku),
    index('inventory_items_org_name_idx').on(table.orgId, table.name),
    foreignKey({
      name: 'inventory_items_inventory_account_fk',
      columns: [table.inventoryAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inventory_items_cogs_account_fk',
      columns: [table.cogsAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * A purchase lot: a quantity that arrived at a price, and what is left of it.
 *
 * The only table in the ledger whose rows legitimately change, and only in one
 * way — the remainder falls as the lot is consumed. Everything else about a
 * layer is as fixed as a posting.
 */
export const costLayers = pgTable(
  'cost_layers',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    itemId: text('item_id').notNull(),
    /** The entry that brought it in; null only for an opening balance. */
    transactionId: text('transaction_id'),
    /** Container number, supplier invoice, quarry batch — what they search for. */
    reference: text('reference'),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }).notNull().default('1'),
    quantityMinor: bigint('quantity_minor', { mode: 'bigint' }).notNull(),
    remainingQuantityMinor: bigint('remaining_quantity_minor', { mode: 'bigint' }).notNull(),
    costMinor: bigint('cost_minor', { mode: 'bigint' }).notNull(),
    remainingCostMinor: bigint('remaining_cost_minor', { mode: 'bigint' }).notNull(),
    /**
     * The functional-currency cost, frozen at the rate on the day it arrived.
     *
     * Inventory is non-monetary under IAS 21, so this never moves again even
     * while the payable that financed it is retranslated every month end. One
     * credit purchase, two treatments — see `docs/adr/0012-fx-revaluation.md`.
     */
    baseCostMinor: bigint('base_cost_minor', { mode: 'bigint' }).notNull(),
    remainingBaseCostMinor: bigint('remaining_base_cost_minor', { mode: 'bigint' }).notNull(),
    /** The shipment this lot arrived on, when it arrived on one. */
    shipmentId: text('shipment_id'),
    /**
     * Grams, so a tonne is 1,000,000 and nothing is lost to a float.
     *
     * Null because most stock is never weighed; a charge apportioned by weight
     * refuses rather than treating an unweighed lot as weightless.
     */
    weightGrams: bigint('weight_grams', { mode: 'bigint' }),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('cost_layers_id_org_key').on(table.id, table.orgId),
    index('cost_layers_item_idx').on(table.orgId, table.itemId, table.acquiredAt),
    foreignKey({
      name: 'cost_layers_item_fk',
      columns: [table.itemId, table.orgId],
      foreignColumns: [inventoryItems.id, inventoryItems.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'cost_layers_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * How a consumption tax behaves, which is three different things.
 *
 * The `CHECK` in migration 0022 is the substance: a sales-tax code may not
 * have an input account, because US sales tax is never reclaimable and a
 * business given one accumulates a receivable from a state that does not owe
 * it — while the accounts balance perfectly. See `domain/tax.ts`.
 */
export const taxCodes = pgTable(
  'tax_codes',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** Basis points: 10% is 1000, 8.25% is 825. Never a float. */
    rateBasisPoints: integer('rate_basis_points').notNull(),
    treatment: text('treatment').$type<TaxTreatment>().notNull(),
    inputAccountId: text('input_account_id'),
    outputAccountId: text('output_account_id'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tax_codes_id_org_key').on(table.id, table.orgId),
    uniqueIndex('tax_codes_org_name_key').on(table.orgId, table.name),
    foreignKey({
      name: 'tax_codes_input_account_fk',
      columns: [table.inputAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tax_codes_output_account_fk',
      columns: [table.outputAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * The lots that arrived together, and the charges that attach to them.
 *
 * `reference` is what the business already calls it — a bill of lading, a
 * container number, a customs declaration — because that is what they will
 * search for when the freight invoice turns up six weeks later.
 */
export const shipments = pgTable(
  'shipments',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    reference: text('reference').notNull(),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('shipments_id_org_key').on(table.id, table.orgId),
    uniqueIndex('shipments_org_reference_key').on(table.orgId, table.reference),
    index('shipments_org_arrived_idx').on(table.orgId, table.arrivedAt),
  ],
);

/**
 * One charge on one shipment: a freight invoice, a duty assessment, a
 * broker's fee. Append-only, like every other record of something that
 * happened.
 */
export const landedCostCharges = pgTable(
  'landed_cost_charges',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    shipmentId: text('shipment_id').notNull(),
    kind: text('kind')
      .$type<'freight' | 'duty' | 'insurance' | 'handling' | 'tax' | 'other'>()
      .notNull(),
    description: text('description').notNull(),
    /** What was billed, in the currency it was billed in. */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }).notNull().default('1'),
    /** The same charge in the books' own currency, which is what the lots carry. */
    baseAmountMinor: bigint('base_amount_minor', { mode: 'bigint' }).notNull(),
    basis: text('basis').$type<AllocationBasis>().notNull(),
    /**
     * Whether this charge belongs in the cost of the goods.
     *
     * Recoverable import VAT does not — it is reclaimed, so it never was a
     * cost. Customs duty is not recoverable and does. Getting those two the
     * wrong way round is the commonest landed-cost mistake, so it is a column
     * rather than something inferred from the account somebody picked.
     */
    capitalise: boolean('capitalise').notNull().default(true),
    /** Where a non-capitalising charge is debited: the input-tax asset. */
    debitAccountId: text('debit_account_id'),
    toInventoryMinor: bigint('to_inventory_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    toCogsMinor: bigint('to_cogs_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    transactionId: text('transaction_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('landed_cost_charges_id_org_key').on(table.id, table.orgId),
    index('landed_cost_charges_shipment_idx').on(table.orgId, table.shipmentId, table.createdAt),
    index('landed_cost_charges_transaction_idx').on(table.orgId, table.transactionId),
    foreignKey({
      name: 'landed_cost_charges_shipment_fk',
      columns: [table.shipmentId, table.orgId],
      foreignColumns: [shipments.id, shipments.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'landed_cost_charges_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'landed_cost_charges_debit_account_fk',
      columns: [table.debitAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * Which lots a charge landed on, and how much each took.
 *
 * The answer to "why is this container carried at more than we paid for it",
 * which is the question the spreadsheet was keeping.
 */
export const landedCostAllocations = pgTable(
  'landed_cost_allocations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    chargeId: text('charge_id').notNull(),
    layerId: text('layer_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    toInventoryMinor: bigint('to_inventory_minor', { mode: 'bigint' }).notNull(),
    toCogsMinor: bigint('to_cogs_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('landed_cost_allocations_charge_layer_key').on(table.chargeId, table.layerId),
    index('landed_cost_allocations_layer_idx').on(table.orgId, table.layerId),
    foreignKey({
      name: 'landed_cost_allocations_charge_fk',
      columns: [table.chargeId, table.orgId],
      foreignColumns: [landedCostCharges.id, landedCostCharges.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'landed_cost_allocations_layer_fk',
      columns: [table.layerId, table.orgId],
      foreignColumns: [costLayers.id, costLayers.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * A sale: the invoice and the stock that left, as one record.
 *
 * Its lines are its stock movements — each an issue that also carries what it
 * was sold for — so the margin on a line is a subtraction on one row. See
 * `drizzle/0027_sales.sql` and `docs/adr/0018-sales-and-margin.md`.
 */
export const sales = pgTable(
  'sales',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    /** The invoice number. Unique per tenant. */
    reference: text('reference').notNull(),
    customerAccountId: text('customer_account_id').notNull(),
    revenueAccountId: text('revenue_account_id').notNull(),
    taxCodeId: text('tax_code_id'),
    currency: char('currency', { length: 3 }).notNull(),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }).notNull().default('1'),
    netMinor: bigint('net_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull(),
    grossMinor: bigint('gross_minor', { mode: 'bigint' }).notNull(),
    baseNetMinor: bigint('base_net_minor', { mode: 'bigint' }).notNull(),
    baseTaxMinor: bigint('base_tax_minor', { mode: 'bigint' }).notNull(),
    baseCostMinor: bigint('base_cost_minor', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** When the customer agreed to pay; absent means on receipt. */
    dueOn: date('due_on', { mode: 'string' }),
    transactionId: text('transaction_id').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('sales_id_org_key').on(table.id, table.orgId),
    uniqueIndex('sales_org_reference_key').on(table.orgId, table.reference),
    index('sales_org_occurred_idx').on(table.orgId, table.occurredAt, table.id),
    index('sales_org_customer_idx').on(table.orgId, table.customerAccountId, table.occurredAt),
    index('sales_transaction_idx').on(table.orgId, table.transactionId),
    foreignKey({
      name: 'sales_customer_account_fk',
      columns: [table.customerAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_revenue_account_fk',
      columns: [table.revenueAccountId, table.orgId],
      foreignColumns: [accounts.id, accounts.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_tax_code_fk',
      columns: [table.taxCodeId, table.orgId],
      foreignColumns: [taxCodes.id, taxCodes.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
  ],
);

/** Something happened to the stock. Append-only, like postings. */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    itemId: text('item_id').notNull(),
    kind: text('kind').$type<'receipt' | 'issue' | 'writeoff'>().notNull(),
    quantityMinor: bigint('quantity_minor', { mode: 'bigint' }).notNull(),
    costMinor: bigint('cost_minor', { mode: 'bigint' }).notNull(),
    baseCostMinor: bigint('base_cost_minor', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /**
     * The entry this movement generated.
     *
     * Every movement posts one. The point of the exercise is that the cost of
     * goods sold goes through the ordinary journal and so obeys the balance
     * rule and the period lock like anything else; what the layers decide is
     * the amount, not the rules.
     */
    transactionId: text('transaction_id').notNull(),
    /** For a receipt, the layer it opened. */
    layerId: text('layer_id'),
    /**
     * The method in force when this happened, recorded rather than looked up.
     * A tenant that changes method must not have its history reinterpreted.
     */
    costingMethod: text('costing_method').$type<CostingMethod>().notNull(),
    reference: text('reference'),
    /** The sale this issue was a line of, when it was one. */
    saleId: text('sale_id'),
    /** What the line was sold for, net, in the books' own currency. */
    revenueBaseMinor: bigint('revenue_base_minor', { mode: 'bigint' }),
    /** Where the line sits on the invoice, from 1. */
    saleLine: integer('sale_line'),
    /** Why stock left without being sold. Set on a write-off and nothing else. */
    reason: text('reason').$type<WriteOffReason>(),
    metadata: jsonb('metadata')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_movements_id_org_key').on(table.id, table.orgId),
    index('inventory_movements_item_idx').on(table.orgId, table.itemId, table.occurredAt, table.id),
    index('inventory_movements_transaction_idx').on(table.orgId, table.transactionId),
    uniqueIndex('inventory_movements_sale_line_key')
      .on(table.orgId, table.saleId, table.saleLine)
      .where(sql`${table.saleId} IS NOT NULL`),
    foreignKey({
      name: 'inventory_movements_sale_fk',
      columns: [table.saleId, table.orgId],
      foreignColumns: [sales.id, sales.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inventory_movements_item_fk',
      columns: [table.itemId, table.orgId],
      foreignColumns: [inventoryItems.id, inventoryItems.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inventory_movements_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inventory_movements_layer_fk',
      columns: [table.layerId, table.orgId],
      foreignColumns: [costLayers.id, costLayers.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * Which lots a movement ate.
 *
 * The answer to "which container did this shipment come from" — the question
 * the spreadsheet existed to answer and the one a packaged accounting system
 * usually cannot.
 */
export const layerConsumptions = pgTable(
  'layer_consumptions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    movementId: text('movement_id').notNull(),
    layerId: text('layer_id').notNull(),
    quantityMinor: bigint('quantity_minor', { mode: 'bigint' }).notNull(),
    costMinor: bigint('cost_minor', { mode: 'bigint' }).notNull(),
    baseCostMinor: bigint('base_cost_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A movement that drew from the same lot twice is a movement whose
    // arithmetic ran twice, which is how a double count gets in.
    uniqueIndex('layer_consumptions_movement_layer_key').on(table.movementId, table.layerId),
    index('layer_consumptions_layer_idx').on(table.orgId, table.layerId),
    foreignKey({
      name: 'layer_consumptions_movement_fk',
      columns: [table.movementId, table.orgId],
      foreignColumns: [inventoryMovements.id, inventoryMovements.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'layer_consumptions_layer_fk',
      columns: [table.layerId, table.orgId],
      foreignColumns: [costLayers.id, costLayers.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * What tax a particular entry attracted.
 *
 * The tax accounts alone cannot answer a return. A balance of 4,200 says
 * nothing about which rate produced it or whether it arose on a sale or a
 * purchase, and every return form asks exactly that. So the split is recorded
 * when it is known — at the moment of posting — rather than reconstructed
 * later from evidence that no longer exists.
 */
export const taxEntries = pgTable(
  'tax_entries',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    transactionId: text('transaction_id').notNull(),
    taxCodeId: text('tax_code_id').notNull(),
    supply: text('supply').$type<Supply>().notNull(),
    /** The amount before tax, which the form asks for beside the tax. */
    baseMinor: bigint('base_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tax_entries_id_org_key').on(table.id, table.orgId),
    index('tax_entries_period_idx').on(table.orgId, table.occurredAt, table.id),
    foreignKey({
      name: 'tax_entries_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tax_entries_code_fk',
      columns: [table.taxCodeId, table.orgId],
      foreignColumns: [taxCodes.id, taxCodes.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * A filed return.
 *
 * `carriedForwardMinor` is the column that makes this a chain rather than a
 * list: when input tax exceeds output tax the excess is generally not
 * refunded but set against the next period, so each return opens with the
 * previous one's closing credit. Vietnam's 01/GTGT calls it chi tieu 22.
 */
export const taxReturns = pgTable(
  'tax_returns',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    outputTaxMinor: bigint('output_tax_minor', { mode: 'bigint' }).notNull(),
    inputTaxMinor: bigint('input_tax_minor', { mode: 'bigint' }).notNull(),
    broughtForwardMinor: bigint('brought_forward_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    payableMinor: bigint('payable_minor', { mode: 'bigint' }).notNull(),
    carriedForwardMinor: bigint('carried_forward_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** The entry that cleared the tax accounts, when there was one to clear. */
    transactionId: text('transaction_id'),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    filedBy: text('filed_by'),
  },
  (table) => [
    unique('tax_returns_id_org_key').on(table.id, table.orgId),
    index('tax_returns_org_period_idx').on(table.orgId, table.periodStart),
    foreignKey({
      name: 'tax_returns_transaction_fk',
      columns: [table.transactionId, table.orgId],
      foreignColumns: [transactions.id, transactions.orgId],
    }).onDelete('restrict'),
  ],
);

/**
 * Which months a return covers, one row each.
 *
 * The unique index on (org, month) is the whole point: it makes a second
 * return over an already-filed month impossible to write, which is a stronger
 * statement than any check the application could make. It also lets monthly
 * and quarterly filing share one table — a quarter is a return owning three
 * of these.
 */
export const taxReturnMonths = pgTable(
  'tax_return_months',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    returnId: text('return_id').notNull(),
    periodMonth: date('period_month').notNull(),
  },
  (table) => [
    uniqueIndex('tax_return_months_org_month_key').on(table.orgId, table.periodMonth),
    foreignKey({
      name: 'tax_return_months_return_fk',
      columns: [table.returnId, table.orgId],
      foreignColumns: [taxReturns.id, taxReturns.orgId],
    }).onDelete('restrict'),
  ],
);

export type PostingRow = typeof postings.$inferSelect;
export type NewPostingRow = typeof postings.$inferInsert;
export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type CostLayerRow = typeof costLayers.$inferSelect;
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type TaxCodeRow = typeof taxCodes.$inferSelect;
export type LandedCostChargeRow = typeof landedCostCharges.$inferSelect;
export type TaxEntryRow = typeof taxEntries.$inferSelect;
export type TaxReturnRow = typeof taxReturns.$inferSelect;

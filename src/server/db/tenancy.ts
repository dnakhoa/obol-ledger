import { sql } from 'drizzle-orm';
import type { Database, Transactional } from './types';

/**
 * Runs work as a particular tenant.
 *
 * The row-level security policies added in `drizzle/0002_tenancy.sql` key off
 * `current_setting('app.current_org')`. Nothing sets that by default, and
 * `org_id = NULL` is never true, so a connection that has not identified its
 * tenant sees an empty database. Every read and write therefore has to pass
 * through here.
 *
 * Three details are load-bearing:
 *
 * 1. **It is a transaction.** `SET LOCAL` is scoped to one, and that is the
 *    point: with a connection pool in transaction mode, a session-level `SET`
 *    would leak one tenant's identity onto the next request that happened to
 *    inherit the backend. Scoping it to the transaction makes that impossible.
 *
 * 2. **`set_config`, not `SET LOCAL`.** `SET` does not accept bind parameters,
 *    so using it would mean interpolating a value into SQL. `set_config(name,
 *    value, is_local)` is the parameterised equivalent, and the third argument
 *    `true` is what makes it local to the transaction.
 *
 * 3. **The transaction boundary belongs here**, not inside each service.
 *    Tenancy and atomicity share a scope — a journal entry must be written as
 *    one tenant, atomically — so opening a second transaction underneath this
 *    one would only add a savepoint and a way for the two to disagree.
 */
export async function withTenant<T>(
  database: Database,
  orgId: string,
  work: (tx: Transactional) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
    return work(tx);
  });
}

/**
 * Reads back the tenant the current transaction is acting as.
 *
 * Only used by the tests, which assert that isolation holds from the database's
 * point of view rather than the application's.
 */
export async function currentTenant(tx: Transactional): Promise<string | null> {
  const [row] = await tx
    .select({ org: sql<string | null>`current_setting('app.current_org', true)` })
    .from(sql`(select 1) as anchor`);
  return row?.org ?? null;
}

export type IsolationStatus = {
  /** False when the connection can see rows without naming a tenant. */
  readonly enforced: boolean;
  /** True when the connecting role bypasses policies outright. */
  readonly privilegedRole: boolean;
  /** Rows an unscoped read could see. Anything but zero is a breach. */
  readonly visibleWithoutTenant: number;
};

/**
 * Checks that row-level security is actually doing something.
 *
 * RLS has a failure mode that no amount of correct SQL protects against: a
 * connection whose role is `SUPERUSER` or carries `BYPASSRLS` ignores every
 * policy, and `FORCE ROW LEVEL SECURITY` does not change that — it only
 * subjects the table *owner*. Deploy with such a role and tenancy silently
 * stops existing, while every query keeps returning plausible rows.
 *
 * Nothing in the schema can catch that, so it is checked at runtime instead:
 * read the accounts table with no tenant set, and require that it returns
 * nothing. That is the property that matters, tested directly, rather than
 * inferred from configuration.
 *
 * Surfaced by `/api/v1/health` so it is monitored rather than assumed.
 */
export async function checkTenantIsolation(database: Database): Promise<IsolationStatus> {
  const [row] = await database
    .select({
      visible: sql<string>`(select count(*)::text from accounts)`,
      privileged: sql<boolean>`(
        select rolsuper or rolbypassrls from pg_roles where rolname = current_user
      )`,
    })
    .from(sql`(select 1) as anchor`);

  const visibleWithoutTenant = Number(row?.visible ?? 0);
  const privilegedRole = row?.privileged === true;

  return {
    visibleWithoutTenant,
    privilegedRole,
    enforced: visibleWithoutTenant === 0 && !privilegedRole,
  };
}

export type PolicyStatus = {
  readonly tablesWithRls: number;
  readonly tablesForced: number;
  readonly policies: number;
  /** True when all four ledger tables are protected. */
  readonly configured: boolean;
};

const TENANT_TABLES = [
  'accounts',
  'transactions',
  'postings',
  'idempotency_keys',
  'webhook_endpoints',
  'webhook_deliveries',
  'accounting_periods',
  'exchange_rates',
  'inventory_items',
  'cost_layers',
  'inventory_movements',
  'layer_consumptions',
  'shipments',
  'landed_cost_charges',
  'landed_cost_allocations',
  'tax_codes',
  'tax_entries',
  'tax_returns',
  'tax_return_months',
  'sales',
  'credit_notes',
  'credit_note_lines',
  'layer_restorations',
  'supplier_returns',
] as const;

// A fixed internal constant, inlined rather than bound: drizzle passes a JS
// array as a single scalar parameter, which `= any(...)` rejects. There is no
// injection surface — these names never come from input.
const TENANT_TABLE_LIST = sql.raw(TENANT_TABLES.map((table) => `'${table}'`).join(', '));

/**
 * How many tables the isolation check expects to find covered.
 *
 * Exported so a caller reporting the result cannot print a stale denominator —
 * which it did, quietly reading "6/4 tables forced" after two tables were
 * added.
 */
export const TENANT_TABLE_COUNT = TENANT_TABLES.length;

/**
 * Checks that the *schema* carries the isolation policies.
 *
 * Distinct from `checkTenantIsolation`, and the difference matters. This asks
 * "are the policies defined and forced?" — a property of the database, true or
 * false regardless of who is connected. `checkTenantIsolation` asks "is *this
 * connection* subject to them?", which additionally depends on the role.
 *
 * An administrative task such as the seed legitimately runs as a privileged
 * role, so it can only meaningfully assert the first. The application's own
 * connection must satisfy both, which is why the health probe uses the other.
 */
export async function checkTenantPolicies(database: Database): Promise<PolicyStatus> {
  const [row] = await database
    .select({
      withRls: sql<string>`count(*) filter (where c.relrowsecurity)::text`,
      forced: sql<string>`count(*) filter (where c.relforcerowsecurity)::text`,
      policies: sql<string>`(
        select count(*)::text from pg_policy p
        join pg_class pc on pc.oid = p.polrelid
        where pc.relname in (${TENANT_TABLE_LIST})
      )`,
    })
    .from(sql`pg_class c join pg_namespace n on n.oid = c.relnamespace`)
    .where(sql`c.relname in (${TENANT_TABLE_LIST}) and n.nspname = current_schema()`);

  const tablesWithRls = Number(row?.withRls ?? 0);
  const tablesForced = Number(row?.forced ?? 0);
  const policies = Number(row?.policies ?? 0);

  return {
    tablesWithRls,
    tablesForced,
    policies,
    configured:
      tablesWithRls === TENANT_TABLES.length &&
      tablesForced === TENANT_TABLES.length &&
      policies >= TENANT_TABLES.length,
  };
}

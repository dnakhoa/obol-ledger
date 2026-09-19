# 7. Enforce tenant isolation with row-level security

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

A ledger with one shared credential is a demo. A real one serves many
businesses, and the rule it must never break is that one tenant cannot see
another's books.

The usual implementation is a `WHERE org_id = $1` on every query. That works
until it doesn't: one query written without the predicate, one join that widens
the result, one report added in a hurry, and a tenant reads someone else's
accounts. The failure is silent — the query returns rows, the page renders, and
nobody notices until an auditor does.

This is the same argument that put the balance rule in a constraint trigger
(see [ADR 1](0001-invariants-in-the-database.md)), so isolation goes to the same
place.

## Decision

Every ledger table carries `org_id` and a row-level security policy keyed on
`current_setting('app.current_org')`. Requests run inside `withTenant`, which
opens a transaction and sets that key with `set_config(..., is_local => true)`.

Four decisions inside that are load-bearing:

**`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** `ENABLE` exempts the table's
owner, and on most managed Postgres the application connects as exactly that
owner — leaving policies that read correctly and do nothing.

**`set_config`, not `SET LOCAL`.** `SET` takes no bind parameters, so using it
would mean interpolating a value into SQL. `set_config` is the parameterised
equivalent, and `is_local => true` scopes it to the transaction. That scoping
matters with a pooled connection: a session-level setting would outlive the
request and hand one tenant's identity to whoever inherited the backend.

**`USING` *and* `WITH CHECK`.** `USING` filters reads. Without `WITH CHECK` a
tenant could insert rows stamped with another tenant's id — invisible to itself
afterwards, and corrupting books it does not own.

**Composite foreign keys on `(account_id, org_id)`.** The same trick already
used for currency: a posting referencing another tenant's account has no row to
point at, so it is unrepresentable rather than merely filtered.

Failure is closed by construction. `org_id = NULL` is never true, so a
connection that has not named a tenant sees an empty database. A forgotten
`withTenant` returns nothing instead of everything.

## The trap this has, and the guard for it

RLS does not apply to a role that is `SUPERUSER` or has `BYPASSRLS`, and
`FORCE` does not change that. Deploy with such a role and every policy goes
inert while the application keeps returning plausible rows.

We hit this immediately: the test suite runs on PGlite, which connects as a
superuser, so the first isolation tests passed against a database where the
policies never ran. The symptom was not a security failure but a foreign-key
error — two tenants' identically-named accounts sorted together, so a posting
referenced an account belonging to someone else.

Two things came out of that:

- `tests/helpers/database.ts` drops to a `NOSUPERUSER NOBYPASSRLS` role after
  migrating, so the suite exercises the policies rather than bypassing them.
- `checkTenantIsolation` reads the accounts table with no tenant set and
  requires zero rows. `/api/v1/health` reports it and returns 503 when it
  fails, so a deployment that bypasses RLS is a monitored outage rather than an
  undetected breach.

The second is the more important. Isolation is not something the schema can
prove about the connection using it, so it is checked at runtime instead.

## Consequences

- Every read and write is inside a transaction, because `SET LOCAL` requires
  one. That is a real cost, and it is the right scope anyway: tenancy and
  atomicity cover the same work.
- `organizations` and `api_keys` carry no policy. Resolving a request's tenant
  reads them *before* a tenant is known, so a policy keyed on the tenant would
  be circular. Neither is reachable from a tenant-facing endpoint.
- The application must not connect as a superuser. That is now a documented
  deployment requirement, a health-check assertion, and a test.
- Uniqueness became per-tenant: two businesses may both keep an account called
  "Operating Cash", and two may choose the same idempotency key.

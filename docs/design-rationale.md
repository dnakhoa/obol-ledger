# Design rationale

The [ADRs](adr/) record individual decisions. This is the argument they all
serve, and the shapes that were considered and rejected — the questions an
interviewer asks that a decision log does not answer.

---

## The one idea

**Put a rule where it cannot be bypassed, not where it is merely followed.**

Everything distinctive here follows from that sentence.

An application-level check protects against the application. It does not
protect against a migration, a `psql` session, a second service added next
quarter, or the ORM dropping a statement from a batch. Those are not
hypotheticals — they are how ledgers actually end up inconsistent, and the
damage is discovered long after the code that caused it shipped.

So the rules live in Postgres:

| Rule                                     | Mechanism                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| Entries balance                          | `DEFERRABLE INITIALLY DEFERRED` constraint trigger, checked at `COMMIT` |
| History is immutable                     | `BEFORE UPDATE OR DELETE` triggers that raise                           |
| Cached balances match their postings     | `AFTER INSERT` trigger maintains them                                   |
| A posting's currency matches its account | composite FK `(account_id, currency)`                                   |
| A posting cannot cross tenants           | composite FK `(account_id, org_id)`                                     |
| No overdraft where disallowed            | `CHECK` constraint on the cached balance                                |
| One tenant cannot read another           | `FORCE`d row-level security policy                                      |

Note what these have in common: several make the bad state **unrepresentable**
rather than merely rejected. A cross-currency posting is not caught by a
validation — there is no row for its foreign key to reference.

The application still checks the same rules first. That is not redundancy for
its own sake: a constraint can only say `check_violation`, while the service can
answer with the account, the residual and the currency. Read the stack downward
for helpfulness and upward for authority.

---

## What was considered and rejected

### Event sourcing

The obvious suggestion for a ledger, and the postings table already _is_ an
append-only event log — immutable by trigger, with balances as a projection.

What event sourcing would add is a separate event store, projections rebuilt by
replay, and eventual consistency between the two. What it would cost is the
thing this project is about: the balance invariant can be a deferred constraint
precisely because the write is one transaction against one table. Split writes
from reads and `SUM(amount) = 0` at `COMMIT` is no longer expressible — you get
a projection that may be wrong for a while and a reconciliation job to notice.

Event sourcing earns its cost when you need to replay history under new
business rules, or when the write model and read models genuinely diverge.
Neither is true here: the ledger's history is the ledger, and the read models
are aggregates Postgres computes better than a projection would.

### CQRS

Same answer, shorter. The reads here are `SUM`s and keyset scans over a few
tables with the right indexes. The benchmark puts a deep page at 0.02ms. A
separate read model would be complexity bought against a problem that has not
appeared.

### A separate API service

Next.js Route Handlers and the dashboard share a process, which is unusual in a
fintech context where the API is often its own deployable.

The reason to split is independent scaling or an independent release cadence,
and neither applies to a single-tenant-per-request ledger whose reads are
milliseconds. What the shared process buys is real: a Server Component calls
`createJournalService(...).postEntry(...)` directly, with no serialisation, no
socket, and no second cold start — and, more importantly, the browser form and a
`curl` run _the same code_, so the rules cannot drift between them.

The seam is drawn where it would need to be if that changed: services take a
`Database` and a tenant and know nothing about HTTP. Extracting them is a build
change, not a rewrite.

### Decimal / numeric for money

Postgres `numeric` is exact, so it is a defensible choice. It was rejected at
the _boundary_ rather than in the database: JavaScript has no decimal type, so
every value would need a decimal library on the way in and out, and a JSON
number is a double regardless. Integer minor units are exact in both languages
at once, and `bigint` needs no library.

The cost is that the scale is implicit — `1234` means nothing without knowing
the currency — which is why `MinorUnits` is a branded type and why every
function that formats one demands a `CurrencyCode` beside it.

### Storing debit and credit as separate columns

It mirrors how a journal is printed, and it makes the balance rule awkward:
`SUM(debit) = SUM(credit)`, plus a constraint to stop both columns being
populated at once, plus double the arithmetic in every aggregate. One signed
column makes the invariant `SUM(amount) = 0` — a single expression a constraint
trigger can assert.

The cost is a convention to remember, and it is paid in exactly one function
([`presentedBalance`](../src/server/domain/account.ts)), which is round-trip
tested for every account class.

### A shared `updated_at` audit trail instead of immutability

Rejected because it answers a different question. An audit column tells you a
row changed; it does not stop the change, and it does not tell you what the row
said before. A ledger corrects a mistake with a reversing entry — which is both
the accounting convention and a complete history by construction.

---

## Where the seams are, and why

```
routes / pages ── thin. HTTP and rendering only.
      │
services ─────── the only path to the ledger. Take (Database, orgId).
      │
domain ───────── pure. No I/O, no framework. Money, account classes,
      │          the balance rule.
database ─────── the invariants, as constraints and triggers.
```

**Services take their dependencies as arguments** rather than importing a
singleton client. The cost is two parameters; the benefit is that the
integration suite hands them a throwaway Postgres, and that no method can run
without a tenant in scope.

**The domain layer has no imports from `server/`.** That is what lets the
balance rule be property-tested with `fast-check` over thousands of generated
entries without a database anywhere near it.

**Errors are values, not exceptions.** `postEntry` returns
`Result<PostEntryResult, LedgerError>`, so "this does not balance" appears in
the type signature and a caller cannot forget it. Exceptions are reserved for
genuinely exceptional things, which the route wrapper turns into a 500 with a
correlation id.

There is one deliberate exception, documented at the throw site: drizzle commits
whatever a transaction callback _returns_, so a domain failure inside a
transaction travels as a thrown sentinel purely to trigger the rollback, and is
converted straight back into an `Err` outside it.

---

## What the tests are actually for

Three suites, three different claims.

**Unit and property tests** cover the pure domain. Property-based where an
example would only prove the example: any storable amount round-trips through
its string form, any balanced multiset of postings validates, any perturbation
of one breaks it, sign conversion round-trips for every account class.

**Integration tests run against real Postgres via PGlite** — WebAssembly, in
process, no service to install. The migrations run verbatim, so the triggers and
the deferred constraint are exercised as deployed. `schema.test.ts` deliberately
_bypasses the services_ and attacks the database with raw SQL, because the claim
under test is about the database.

**Concurrency tests need a real server**, since PGlite is one connection and
cannot express two transactions racing. They cover lock ordering, lost updates
under contention, and simultaneous idempotent retries.

Each concurrency test was verified by breaking the thing it protects. Delete the
`.sort` that orders posting inserts by account id and Postgres reports
`40P01 deadlock detected`. That is the only way to know a test has teeth rather
than merely passing — and it is worth doing for any test whose failure mode is
"silently stops checking".

---

## The mistakes, kept on the record

Three things went wrong that the design did not anticipate. They are in the
history because they are the most useful part of it.

**Isolation tests that proved nothing.** The first row-level security suite
passed against a database where the policies never ran — PGlite connects as a
superuser, and a superuser bypasses RLS regardless of `FORCE`. The symptom was
not a security failure but a _foreign-key error_: two tenants' identically-named
accounts sorted together. Had the names differed, the suite would have been
green and the feature decorative. Tests now drop to a `NOSUPERUSER` role.

**The same trap, in production.** After deploying, `/api/v1/health` reported
`privilegedRole: true, enforced: false` — Neon's default role carries
`BYPASSRLS`. Every policy was inert in the live deployment. Nothing in the
schema, the tests or the migration could have revealed it, because none of them
run as the deployed connection. Hence the split between `DATABASE_URL` (owner,
for migrations) and `APP_DATABASE_URL` (least privilege, for the app) — and
hence the runtime probe, which is the only thing that could have caught it.

**A migration that only worked on an empty database.** The tenancy backfill
does `UPDATE transactions SET org_id = …`, which the append-only trigger
refuses — as designed. CI passed because it migrates a _fresh_ schema, where a
row-level trigger never fires. It failed against the first database that had
data in it.

The pattern in all three: **a check that cannot fail is indistinguishable from a
check that passes.** Everything that matters here is now verified against
conditions where it could actually break.

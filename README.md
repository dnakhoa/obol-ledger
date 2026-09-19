# Obol Ledger

[![CI](https://github.com/dnakhoa/obol-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/dnakhoa/obol-ledger/actions/workflows/ci.yml)
[![Live](https://img.shields.io/badge/live-obol--ledger.vercel.app-0f172a)](https://obol-ledger.vercel.app)
[![Licence](https://img.shields.io/badge/licence-MIT-0f172a)](LICENSE)

**[Live demo →](https://obol-ledger.vercel.app)** · seeded with a month of
trading for a coffee roastery, and you can post entries yourself.

A double-entry ledger with a typed HTTP API and a server-rendered dashboard.
Entries are balanced by construction, history is append-only, and the rules are
enforced by Postgres as well as by the application.

Built as a demonstration of production-shaped engineering: the interesting parts
are the invariants and where they live, not the CRUD.

![The overview, in dark mode: a trial-balance banner reading "The books balance", headline figures, a 30-day posting-volume chart, and the accounting equation by account class](docs/screenshots/overview-dark.png)

<details>
<summary>More screens</summary>

Every shot is the live deployment, not a mockup.

**The chart of accounts.** Grouped by class, with each group's own total and
its normal balance stated. Balances read the way an accountant expects —
positive means healthy, whichever side the account normally sits on — which is
one sign flip, applied in one function, never re-derived per view.

![The chart of accounts: assets, liabilities, equity, revenue and expenses, each group totalled](docs/screenshots/accounts-light.png)

**The journal.** One `<tbody>` per entry, so an entry and its postings are a
single group for a screen reader as well as for the eye. Debits and credits get
their own columns above `sm` and collapse to one `Dr`/`Cr` column on a phone.

![The journal: entries in date order, each with its postings and a "Balanced" badge](docs/screenshots/journal-dark.png)

**Composing an entry.** The balance is checked as you type — this one balances,
so the badge says so and the button is live. That check has no authority; the
domain layer and a deferred Postgres constraint each check it again. A rejected
submit keeps every field exactly as typed and moves focus to the error.

![The entry composer with a balanced two-line entry and a green "Balanced" badge](docs/screenshots/compose-light.png)

**Light mode.** Not an inversion — the dark steps were chosen against the dark
surface, which is why neither theme has the washed-out greys an algorithmic
flip produces.

![The same overview in light mode](docs/screenshots/overview-light.png)

</details>

---

## Why a ledger

Most portfolio projects are CRUD, which makes them hard to judge — there are no
invariants, so there is no opportunity for a decision to be right or wrong. A
ledger has several that are provable:

- **Every entry balances.** The postings of a journal entry sum to zero. Always.
- **Retries are safe.** A client that times out can retry without posting twice.
- **History is immutable.** Mistakes are corrected with a reversing entry, never
  by editing the past.
- **Money is exact.** Not approximately exact — exact, for every currency,
  including the ones without two decimal places.

Each of those forces a real engineering decision, and each is enforced
somewhere you can point at.

## The interesting parts

### The database refuses to hold a corrupt ledger

Application-level validation is defeated by a `psql` session, a migration
backfill, or a second service. So the rule lives in Postgres too — a
`CONSTRAINT TRIGGER` declared `DEFERRABLE INITIALLY DEFERRED`, which asserts at
`COMMIT` that every touched entry has at least two postings and sums to zero.
Deferral is the trick: an immediate trigger fires after the first posting, when
nothing has ever balanced yet.

Alongside it: `postings` and `transactions` reject `UPDATE` and `DELETE`;
`accounts.balance_minor` is trigger-maintained so the cached balance cannot drift
from the postings behind it; and composite foreign keys on
`(account_id, currency)` make a cross-currency posting _unrepresentable_ rather
than merely rejected.

`tests/integration/schema.test.ts` proves all of it by bypassing the application
entirely and attacking the database directly.

### Tenant isolation the database enforces, and a probe that proves it

Every ledger table carries a `FORCE`d row-level security policy keyed on
`current_setting('app.current_org')`. `org_id = NULL` is never true, so a
connection that has not named a tenant sees an **empty database** — a forgotten
tenant scope returns nothing rather than everything.

The part worth reading is the failure mode. RLS does not apply to a role with
`BYPASSRLS`, and `FORCE` does not change that. Neon's default role has exactly
that attribute, so the first deploy ran with every policy inert — caught not by
an incident but by `/api/v1/health`, which asserts isolation is really in force
and returns 503 when it is not:

```json
{ "tenantIsolation": { "visibleWithoutTenant": 13, "privilegedRole": true, "enforced": false } }
```

Hence two connections: `DATABASE_URL` (owner, for migrations) and
`APP_DATABASE_URL` (`NOSUPERUSER NOBYPASSRLS`, no DDL rights, for the app).

### Money is never a float

`0.1 + 0.2 !== 0.3`, and a JSON number is a double — `12.10` is already
`12.099999999999999` before the server sees it. So amounts are `bigint` counts of
minor units end to end, branded so a raw number cannot be passed where money is
expected, with the decimal exponent coming from a currency registry (JPY has
zero, BHD has three). Across the wire they are exact decimal _strings_.

### Retries cannot double-post

`Idempotency-Key` claims its row _before_ any work happens, inside the same
transaction as the entry. A concurrent duplicate blocks on the index rather than
racing; a retry with the same body replays the stored response; the same key
with a _different_ body is a `409`. A rejected entry rolls its claim back with
it, so the key stays usable.

### Pagination that stays correct under writes

`OFFSET` walks and discards rows, and shifts every page when a row is inserted
mid-read. Pages here seek on `(occurredAt, id)` with a row-wise comparison that
Postgres answers straight from the matching index. `occurredAt` alone is not
unique; `id` alone orders by _recording_ time, which puts a back-dated invoice at
the top of today's journal.

### Tests that run the real schema, with no database to install

Integration tests run on **PGlite** — Postgres compiled to WebAssembly, embedded
in the test process. The migrations are applied verbatim, so the plpgsql triggers
and the deferred constraint are exercised as they will be in production.

```
211 tests · 16 files · ~14s · no external services
```

## Stack

|                |                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**  | Next.js 16 (App Router), React 19, TypeScript 5.9 in strict mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| **Database**   | Postgres via drizzle-orm and `node-postgres` — see [ADR 3](docs/adr/0003-database-driver.md)                                      |
| **Validation** | zod 4, with the OpenAPI document generated from the same schemas                                                                  |
| **Testing**    | Vitest, PGlite, fast-check                                                                                                        |
| **Styling**    | Tailwind CSS v4 with semantic design tokens                                                                                       |

## Running it

Any Postgres 15+ will do — local, containerised, or managed.

```bash
pnpm install
cp .env.example .env.local     # point DATABASE_URL at your Postgres
pnpm db:migrate                # apply the schema and its invariants
pnpm db:seed                   # a month of trading for a coffee roastery
pnpm dev
```

The seed is deterministic and asserts its own output: if the books do not
balance it fails rather than leaving a broken ledger behind.

```bash
pnpm verify      # format check, lint, typecheck, tests — what CI runs
pnpm test        # tests alone (no database required)
```

## The API

`GET /api/openapi.json` serves the full contract, assembled from the live zod
schemas — it cannot describe a body the server would reject. A rendered version
is at `/api-reference`.

Reads are public — try them against the live deployment:

```bash
curl -s https://obol-ledger.vercel.app/api/v1/reports/trial-balance | jq
```

Writes need `Authorization: Bearer $LEDGER_API_TOKEN`.

```bash
curl -X POST https://$HOST/api/v1/entries \
  -H "Authorization: Bearer $LEDGER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "description": "Consulting fee",
    "currency": "USD",
    "postings": [
      { "accountId": "acct_…", "direction": "debit",  "amount": "1200.00" },
      { "accountId": "acct_…", "direction": "credit", "amount": "1200.00" }
    ]
  }'
```

An unbalanced entry comes back as an RFC 9457 problem document, with the figures
as extension members so nothing has to be parsed out of prose:

```json
{
  "type": "https://obol-ledger.dev/problems/unbalanced-transaction",
  "title": "Transaction does not balance",
  "status": 422,
  "detail": "Postings sum to 0.01 USD; a balanced transaction sums to zero.",
  "code": "unbalanced_transaction",
  "residual": "0.01",
  "currency": "USD",
  "requestId": "0f8c…"
}
```

| Endpoint                              |        |                                           |
| ------------------------------------- | ------ | ----------------------------------------- |
| `GET /api/v1/health`                  | —      | liveness plus a real database round trip  |
| `GET /api/v1/accounts`                | public | accounts with current balances            |
| `POST /api/v1/accounts`               | bearer | open an account                           |
| `GET /api/v1/accounts/{id}/statement` | public | paginated, with a running balance         |
| `GET /api/v1/entries`                 | public | the journal, newest first                 |
| `POST /api/v1/entries`                | bearer | record a balanced entry                   |
| `POST /api/v1/transfers`              | bearer | sugar for a two-legged entry              |
| `GET /api/v1/reports/trial-balance`   | public | debits, credits and residual per currency |

## Documentation

- **[Design rationale](docs/design-rationale.md)** — the one idea everything
  follows from, what was considered and **rejected** (event sourcing, CQRS, a
  separate API service, `numeric` for money), where the seams are, and the three
  mistakes that are kept on the record because they are the useful part
- [Architecture](docs/architecture.md) — layering, where each rule is enforced,
  the error model, the testing strategy
- [Benchmarks](docs/benchmarks.md) — keyset vs `OFFSET`, with query plans
- [ADR 1](docs/adr/0001-invariants-in-the-database.md) — invariants in the database
- [ADR 2](docs/adr/0002-signed-postings.md) — signed, debit-positive postings
- [ADR 3](docs/adr/0003-database-driver.md) — why `node-postgres` over the HTTP driver
- [ADR 4](docs/adr/0004-money-as-minor-units.md) — money as integer minor units
- [ADR 5](docs/adr/0005-idempotency.md) — claim-first idempotency keys
- [ADR 6](docs/adr/0006-keyset-pagination.md) — keyset pagination
- [ADR 7](docs/adr/0007-tenant-isolation.md) — tenant isolation via row-level security

## Licence

MIT

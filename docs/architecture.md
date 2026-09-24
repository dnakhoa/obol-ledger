# Architecture

> For _why_ the system has this shape — including what was considered and
> rejected — see [design-rationale.md](design-rationale.md). This document
> describes the shape itself.

## The shape of it

```
┌──────────────────────────────────────────────────────────────────────┐
│  app/(app)/*            Server Components · render read models       │
│  app/api/v1/*           Route handlers  · the public HTTP API        │
│  transfer/actions.ts    Server Action   · the UI's one mutation      │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │                                  │
      server/queries.ts                     server/http/*
      (read models, shaping)          (validation · problems · auth
                │                       · rate limit · correlation)
                └──────────────┬───────────────────┘
                               ▼
                       server/services/*
          accounts · journal · reporting · idempotency · cursor
                               │
                               ▼
                       server/domain/*
              money · account classes · the balance rule
                               │
                               ▼
                       server/db/* → Postgres
        composite FKs · deferred constraint trigger · append-only
```

Two rules keep the layering honest.

**Everything funnels through the services.** A page and an API client reach the
same `createJournalService(...).postEntry(...)`. There is no second path where a
rule could be forgotten — the browser form and a `curl` get identical answers
because they run identical code.

**Server Components call services directly, never our own HTTP API.** Fetching
`/api/v1/accounts` from a Server Component would pay for serialisation, a socket
and possibly a cold function invocation to reach code already running in the
same process. The API exists for _external_ callers.

## Where each rule is enforced, and why

The balance rule is checked three times. That is deliberate, and each layer has
a different job:

| Layer                                   | What it adds                                                      | What it cannot do                                       |
| --------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Browser (`entry-composer.tsx`)          | Tells you the entry is out by a cent _while you can still fix it_ | Nothing: it has no authority and can be bypassed freely |
| Domain (`domain/transaction.ts`)        | A precise, typed error naming the residual and the currency       | Stop a writer that is not this application              |
| Postgres (`0001_ledger_invariants.sql`) | Makes a corrupt ledger unrepresentable, for every writer, forever | Explain itself — it can only say `check_violation`      |

Read the table downward for helpfulness and upward for authority. The database
is the floor; the layers above exist to turn its refusals into something a
caller can act on.

The floor is also the one layer a reader can test from the outside.
[`/break`](https://obol-ledger.vercel.app/break) skips the top two rows
entirely and fires raw SQL at the live tables, inside a transaction that is
always rolled back, so the bottom row's refusals can be watched rather than
taken on trust — nine of them, one per rule. See
[ADR 20](adr/0020-attacks-on-the-live-demo.md).

## Errors

Domain failures are values, not exceptions. `postEntry` returns
`Result<PostEntryResult, LedgerError>`, so "this does not balance" appears in the
type signature and a caller cannot forget it. Exceptions stay reserved for
genuinely exceptional things — a dropped connection, a bug — which the route
wrapper turns into a 500 with a correlation id.

There is one deliberate exception to that rule, documented at the throw site:
drizzle commits whatever a transaction callback _returns_, so a domain failure
inside a transaction travels as a thrown sentinel (`DomainAbort`) purely to
trigger the rollback, and is converted straight back into an `Err` outside it.

HTTP responses use RFC 9457 problem documents. A status code cannot distinguish
"no such account" from "that entry does not balance"; a stable `type` URI can,
and the specifics ride along as extension members so nothing has to be parsed out
of prose. The whole status mapping is one `Record<LedgerErrorCode, number>`, so a
new error variant without a status is a compile error.

## Testing

211 tests, no external services, ~14 seconds.

Integration tests run against **PGlite** — real Postgres compiled to
WebAssembly, embedded in the test process. The migrations under `drizzle/` are
applied to it verbatim, so the plpgsql triggers and the deferred constraint are
exercised exactly as they will be in production. Mocking the database would test
the mock; the schema _is_ the subject.

- `tests/integration/schema.test.ts` bypasses the service layer entirely and
  attacks the database directly, asserting it refuses an unbalanced entry, a
  cross-currency posting, an overdraft, and any attempt to edit history.
- `tests/integration/api.test.ts` calls the real route handlers with real
  `Request` objects, so validation, auth, problem documents and serialisation are
  covered end to end.
- Property tests (`fast-check`) cover the parts where an example-based test would
  only prove the examples: money round-tripping, the balance rule under arbitrary
  perturbation, sign round-trips for every account class, and axis scaling.
- `tests/concurrency/` runs against a **real** Postgres over a pool of real
  connections, because PGlite is a single connection and cannot express two
  transactions racing. It covers the three claims that need genuine
  concurrency: that lock ordering prevents deadlocks, that trigger-maintained
  balances lose no update under contention, and that a duplicate idempotency
  key serialises rather than racing. These skip without
  `CONCURRENCY_DATABASE_URL` so `pnpm test` stays green without Postgres; CI
  always provides one.

Each of those three has been checked by deliberately breaking the thing it
tests. Removing the `.sort` that orders posting inserts by account id makes the
first fail with `40P01 deadlock detected` — which is the only way to know a
test has teeth rather than merely passing.

## Frontend

Server Components by default. The client bundle contains four islands, each as
small as its job: the navigation (needs the current path), the theme control, the
activity chart (hover), and the entry composer (live balance).

Money never crosses to the browser as a number. Axis ticks, percentages and
grouped figures are computed on the server from the exact decimal strings the
domain produced, so the frontend has no opportunity to reintroduce the
floating-point error the backend exists to avoid.

Design tokens are semantic — `surface`, `ink`, `line`, `positive` — and resolve
per theme. Dark mode is a set of steps chosen against the dark surface, not an
inversion of the light palette.

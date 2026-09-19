# 3. Use node-postgres over TCP

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

The application runs on Vercel's Node runtime against a managed Postgres. Three
drivers were considered.

**Neon's HTTP driver** issues each query as an HTTP request. It has the lowest
cold-start cost and works in edge runtimes, but it **cannot open a transaction**.
That is disqualifying, and not marginally: writing an entry means inserting a
`transactions` row and its `postings` atomically, and the deferred constraint
that enforces the balance only fires at `COMMIT`. Without a transaction there is
no commit to defer to, and a half-written entry is a corrupt ledger.

**Neon's WebSocket driver** keeps a real session and supports transactions. It
is the provider's recommended path and works well — but it only speaks to Neon.
A developer cloning this repository would need a Neon account before the test
suite or the dev server would run.

**node-postgres (`pg`)** speaks the ordinary Postgres wire protocol over TCP. It
supports transactions, and it connects to anything: a local server, a container,
Neon, Supabase, RDS.

## Decision

Use `pg` with `drizzle-orm/node-postgres`.

TLS is enabled for any non-loopback host and the certificate chain is verified.
That is stated explicitly as `{ rejectUnauthorized: true }` rather than left to
`sslmode=require` in the connection string: `node-postgres` is in the middle of
changing what that mode means, from verifying the chain to merely encrypting,
for libpq compatibility. An unverified TLS connection is encrypted and still
open to interception, so the intent is pinned in code instead of inherited from
a default that is about to flip.

**Schema work uses the direct endpoint, not the pooler.** Providers publish
both. The application wants the pooled one — that is what lets many serverless
instances share a few backend connections. Migrations and seeds want the
opposite: PgBouncer runs in transaction mode, where consecutive statements can
land on different backends, so anything relying on session state (a `SET`, a
session-level advisory lock, the seed's multi-statement
`ALTER TABLE ... DISABLE TRIGGER` block) is not guaranteed to see its own
effects. A one-shot script gains nothing from pooling anyway. `scripts/` prefer
`DATABASE_URL_UNPOOLED` when it exists and fall back to `DATABASE_URL` for a
plain Postgres with a single endpoint.

The pool is small (`max: 3`) and cached on `globalThis`. A serverless instance
serves one request at a time, so a large pool only multiplies idle connections
across instances; fan-out is the pooled endpoint's job. The `globalThis` cache
stops Next.js' dev-server module reloading from leaking a pool per edit.

## Consequences

- `git clone && pnpm db:migrate` works against any Postgres. The test suite needs
  none at all — it runs on PGlite, embedded in the test process.
- The app is tied to the Node runtime. It could not be moved to an edge runtime
  without revisiting this, which is an acceptable trade for a service whose work
  is transactional by nature.
- Swapping providers means changing `DATABASE_URL`, not changing code.

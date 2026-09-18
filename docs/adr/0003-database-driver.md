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

TLS is enabled automatically for any non-loopback host, with certificate
verification left on — managed providers present certificates from public CAs,
so `rejectUnauthorized: false` would encrypt the connection while leaving it open
to interception, which is the worst of both worlds.

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

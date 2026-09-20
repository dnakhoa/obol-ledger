# Contributing

This is a personal project, so the realistic contribution is a bug report or a
question. Both are welcome. If you want to send a change, here is how it works.

## Running it

```bash
pnpm install
cp .env.example .env.local   # point DATABASE_URL at any Postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Tests need no database: they run against PGlite, a real Postgres compiled to
WebAssembly, so the migrations — triggers, deferred constraints and row-level
security included — execute exactly as they will in production.

```bash
pnpm verify      # format, lint, types, tests
```

The concurrency suite needs a real server, because PGlite is a single
connection and cannot express two transactions racing:

```bash
CONCURRENCY_DATABASE_URL=postgres://… pnpm vitest run tests/concurrency
```

## The bar for a change

**Migrations are written by hand.** `drizzle-kit generate` is deliberately not
wired up — it cannot see the triggers and policies that make the schema
correct, and it will emit a migration dropping them. See
[`drizzle/README.md`](drizzle/README.md).

**A rule the database can enforce belongs in the database.** The application
may also check it, for a better error message; it may not be the only thing
checking it.

**A comment should say why, not what.** The code already says what. If a line
looks odd, the comment explains the alternative that was tried and what went
wrong with it.

**A test that cannot fail is not a test.** For anything concurrency- or
constraint-related, delete the line that makes the claim true and confirm the
suite goes red. Several tests here carry a note saying exactly which line.

**Mechanical rules belong in tooling.** Prettier and ESLint own formatting and
lint; a convention that needs a human to enforce it will not be enforced.

## Commits

Present tense, explaining the decision rather than the diff. The diff is in the
diff. A commit that changes a trade-off should say what the other option was.

# Migrations

These are written by hand, and `drizzle-kit generate` is deliberately not
wired up as a script.

Most of what makes this schema correct is invisible to a schema differ. The
balance invariant is a deferred constraint trigger. Tenant isolation is a set
of `FORCE`d row-level security policies. Currency and org agreement are
composite foreign keys whose _purpose_ is to make a state unrepresentable.
A generator that diffs table definitions cannot produce any of it, and — worse
— it will cheerfully emit a migration that drops what it does not understand.

It also cannot know the one thing that has broken a deploy here twice: a
backfill has to run _before_ the append-only trigger it would otherwise trip,
and ordering like that is a judgement about existing data, not about types.

So `src/server/db/schema.ts` describes the shape for the query builder and the
type system, and the files in this directory are the source of truth for what
the database actually is. When they disagree, the SQL wins.

The snapshot files a generator would keep here were stale and have been
removed; `meta/_journal.json` stays, because the migrator uses it to decide
what is pending. A new migration adds its file and one journal entry.

## Editing an applied migration does nothing

The migrator records what it has run and skips those files without looking at
them again, so appending to a migration that has already been applied is a
**silent no-op** — no error, no warning, and `migrations applied` in the log.
The change lands on a fresh database (CI, a new environment) and never on one
that has already seen the file, which is the worst possible split.

If a migration is still unreleased and you want to keep it in one file, drop
and recreate the local database. Otherwise write the next migration.

## When migrations run, and what that obliges them to be

`pnpm build` is `tsx scripts/migrate-on-deploy.ts && next build`, so a
production deploy migrates before it builds. This is not a tidiness
preference: before it, merging a schema change shipped code that referenced
columns the database did not have, and the live site answered every request
with a 500 until somebody remembered to run `pnpm db:migrate` by hand. That
happened.

**Only production deploys migrate.** Vercel builds every pull request as a
preview, and this project's preview environment carries the _same_
`DATABASE_URL` as production — one Neon database, two environments pointed at
it. An unguarded migrate in the build command would apply a schema change to
production the moment somebody opened a pull request, days before the code
that needs it merges. The guard is `VERCEL_ENV === 'production'`.

A production build with no database configured **fails** rather than skipping,
because silently skipping would promote code that cannot reach a database —
the same failure by a different route.

### Migrations are expand-only

The build command runs _before_ the new deployment is promoted. There is
therefore a window — the length of a build — where the **old** code is serving
traffic against the **new** schema.

That is the safe direction for an additive change and the fatal one for a
destructive change. Adding a nullable column, a table or an index is invisible
to code that does not know about it. Dropping a column, renaming one, or
tightening a `NOT NULL` breaks the live site _immediately_, before the code
that would have coped is serving anything.

So a removal is two deploys, never one:

1. Ship the migration that adds, and the code that writes both.
2. Once nothing reads the old thing, ship a migration that removes it.

### Telling whether a database is behind

`pnpm db:status` compares what the checkout expects against what the database
has applied, and changes neither:

```
127.0.0.1/obol_ledger
  this checkout expects: 0019_japanese_books
  the database has:      0018_books_locale
  pending (1): 0019_japanese_books
```

`/api/v1/health` reports the same comparison and returns 503 while anything is
pending, for the same reason it reports tenant isolation rather than assuming
it: the failure is silent from inside the application and obvious from outside,
and a Postgres error naming a missing column tells an operator nothing about
_why_ it is missing.

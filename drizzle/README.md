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

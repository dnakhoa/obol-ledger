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

# 20. Let a stranger attack the live demo

- **Status**: Accepted
- **Date**: 2026-09-24

## Context

The central claim of this project is that the ledger's rules are enforced by
Postgres as well as by the application, so a writer that never sees the
application — psql, a migration, a second service — still cannot corrupt the
books. [ADR 1](0001-invariants-in-the-database.md) makes the decision and
`tests/integration/schema.test.ts` proves it.

Neither is something a visitor will read. A README that says "the database
refuses an unbalanced entry" sounds the same as one that is wrong, and a
screenshot of a green "The books balance" banner is what every ledger shows,
including the ones that do not balance. The claim that matters most is the
one a reader has least reason to believe.

## Decision

Publish the attacks. `/break` fires nine of them — an unbalanced entry, an
edit to a posting, a deleted entry, an overdraft, a posting in the wrong
currency, a second reversal, an entry back-dated into a closed month, a write
into another tenant and a read of one — as raw SQL at the tables the rest of
the site reads, and prints what Postgres said: SQLSTATE, condition name,
constraint.

Four properties make that safe to run for anyone, signed in or not:

1. **Every attack is one transaction that always rolls back.** Not "rolls back
   when refused": the callback ends by throwing, whether Postgres raised or
   not, so an attack that gets through leaves nothing either. That is the case
   the page exists to detect, and it must not become the corruption it
   reports. A test drops `postings_append_only`, fires the edit, asserts the
   page calls it a breach, and asserts every row and balance is unchanged.

2. **The deferred rule is checked without a COMMIT.** The balance trigger is
   `DEFERRABLE INITIALLY DEFERRED` and speaks only at `COMMIT`, which never
   comes. `SET CONSTRAINTS ALL IMMEDIATE` makes Postgres run the pending
   checks at that statement, exactly as `COMMIT` would. It is shown as a
   statement of its own, with a comment saying why.

3. **Nothing in the SQL comes from the request.** The action takes an attack id
   from a fixed list. Every value spliced into a statement was read from the
   tenant's own rows a moment earlier, re-checked against an identifier shape
   and quoted. Free text a tenant wrote — an entry's description — is carried
   beside the SQL for display and never inside it.

4. **It costs a bounded amount.** Each attack sets a 3 s statement timeout and a
   1 s lock timeout, so meeting a row a real writer holds ends in a second
   rather than a queue; and the action is rate-limited per client by the same
   Postgres-backed limiter the API uses, because "run all nine" from a script
   against a fleet of cold starts is exactly what an in-process counter waves
   through.

The statements are executed as text rather than as parameterised queries so
that the SQL on the page is the SQL that ran. A paraphrase of a query is not
evidence.

## Consequences

**The page reports what this connection can see, including its weaknesses.**
Against a role with `BYPASSRLS` the two tenancy attacks succeed. The page says
so above the attacks rather than after them, and names the role, because a
proof that only works where it has been arranged to is not one.

**It locks real rows for milliseconds.** An overdraft attempt updates the
account's cached balance before the check refuses it, so it holds that row's
lock until the rollback. On a read-only demo nothing else writes; on a
signed-in tenant's own ledger it is their own attack delaying their own write.

**The attacks are aimed, not fixed.** Each reads the tenant's newest entry,
largest cash account or earliest open month first, so they work on any ledger
with something in it — and on an empty one they say there is nothing to aim at
instead of failing.

**A new rule should arrive with an attack.** The table in the README and the
cards on the page are the most-read description of what the database enforces.
A guard added without one is true and invisible.

## Considered and rejected

- **A recorded video of the attacks.** Proves only that they failed once, on
  the author's machine.
- **A sandbox database per visitor.** Would prove the rules hold on a
  database the visitor has never seen; the point is that they hold on the one
  serving the demo.
- **Letting the visitor type SQL.** A general SQL console, even rolled back, is
  a denial-of-service and data-exfiltration surface whose safety rests on the
  role's grants being perfect forever. Nine fixed attacks make the same argument
  with none of that.

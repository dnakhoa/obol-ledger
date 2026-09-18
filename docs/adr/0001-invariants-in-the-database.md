# 1. Enforce the double-entry invariant in the database

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

A ledger has exactly one invariant that cannot ever be violated: the postings of
a journal entry must sum to zero. Everything else the system reports — balances,
the trial balance, a statement — is a lie the moment that stops being true.

The application already checks it. The question is whether that is enough.

It is not, for a reason that has nothing to do with the quality of the
application code. "The application is the only writer" is true on day one and
false soon after: a migration backfills rows, an operator fixes something in
psql, a second service is added, an ORM bug drops a statement from a batch. Each
of those bypasses the check, and a corrupt ledger is not self-announcing — it is
discovered months later by an auditor.

## Decision

Enforce the invariant in Postgres, in addition to the domain layer.

`drizzle/0001_ledger_invariants.sql` adds a `CONSTRAINT TRIGGER` on `postings`,
declared `DEFERRABLE INITIALLY DEFERRED`, which asserts at `COMMIT` that every
touched transaction has at least two postings and that they sum to zero.

Deferral is essential rather than incidental. An immediate trigger fires after
the first posting is inserted, at which point no entry has ever balanced, so it
would reject everything. Deferring it to commit time is what lets it see the
whole entry.

The same file adds three more rules in the same spirit:

- `postings` and `transactions` reject `UPDATE` and `DELETE`. A ledger is a
  historical record; a mistake is corrected with a reversing entry.
- `accounts.balance_minor` is maintained by an `AFTER INSERT` trigger, so the
  cached balance cannot drift from the postings that justify it.
- A `CHECK` constraint enforces the overdraft policy against that cached balance.

Composite foreign keys on `(account_id, currency)` and `(transaction_id,
currency)` make a cross-currency posting unrepresentable rather than merely
rejected.

## Consequences

- An unbalanced entry fails at `COMMIT`, not at `INSERT`. The error surfaces
  where the transaction closes, which is worth knowing when reading a stack
  trace.
- The application still checks the same rules first. That is not redundancy for
  its own sake: a constraint can only say `check_violation`, whereas the service
  can answer with the account, the residual and the currency. The database is
  the floor, not the user interface.
- Seeding has to disable the append-only triggers to truncate. That is the one
  place the rules are lifted, it is explicit, and it is in a script that only
  ever runs against a development database.
- The tests exercise these rules directly against a real Postgres
  (`tests/integration/schema.test.ts`), bypassing the service layer, because the
  claim being tested is about the database and not about the code above it.

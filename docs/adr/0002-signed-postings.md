# 2. Store postings as signed amounts, debit-positive

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

A posting has an amount and a side. There are two usual ways to store that:

1. Two columns, `debit_minor` and `credit_minor`, one of which is always zero.
2. One signed column, with a sign convention for the side.

Option 1 mirrors how a journal is printed, but it makes the balance rule
awkward to express (`SUM(debit) = SUM(credit)`), needs a constraint to stop both
columns being populated at once, and doubles the arithmetic in every aggregate.

## Decision

One signed `amount_minor` column. **Positive debits the account, negative
credits it.**

The balance rule becomes `SUM(amount_minor) = 0`, which a constraint trigger can
assert in a single query, and an account's balance becomes a plain `SUM` that
Postgres can maintain incrementally.

The cost is that the stored sign is not what an accountant expects to read: a
liability with money owed on it has a _negative_ signed balance. That conversion
happens in exactly one function, `presentedBalance` in
`src/server/domain/account.ts`, which flips the sign for credit-normal account
classes. No component, report or endpoint performs the flip itself.

The HTTP API does not expose the convention at all. Requests carry a
non-negative `amount` and an explicit `direction` of `"debit"` or `"credit"`,
which is how a person writes an entry; the mapping to signed storage happens
once, at the boundary.

## Consequences

- The trial balance is `SUM(balance_minor) = 0` over every account — one
  aggregate over one column, which is why the dashboard can afford to show it
  live on every page load.
- Reading the raw table requires knowing the convention. It is stated in the
  schema, in this ADR, and enforced in one function, which is the trade made for
  the simplicity above.
- `presentedBalance` is pure and round-trip tested against its inverse for every
  account class, because a sign error here would be invisible and catastrophic.

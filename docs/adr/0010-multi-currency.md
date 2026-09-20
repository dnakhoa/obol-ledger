# 10. An entry balances in the functional currency, not in each currency

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

Until now a multi-currency entry was _unrepresentable_, and deliberately so:
`postings` carries a composite foreign key to `(transaction_id, currency)`, so
every posting in an entry holds the entry's currency, and a second one to
`(account_id, currency)`, so it also holds its account's. Nothing could pay a
USD supplier from a VND bank account, because there was no row for such a
posting to point at.

That floor was right while the alternative was a half-built FX model. It is
wrong for the business this is now aimed at. An importer holds a USD account
and a VND account, invoices in EUR, and pays customs in VND — every interesting
entry they write crosses currencies, and a ledger that refuses them forces the
entry to be split into two unrelated halves whose relationship lives in a
spreadsheet.

## The question this turns on

A double-entry ledger's central claim is that every entry sums to zero. Across
currencies that claim needs a unit, and there are only two honest answers:

1. **Sum to zero in every currency independently.** Then a USD-for-VND payment
   is not one entry, and the model has not actually gained anything.
2. **Sum to zero in one nominated currency**, into which every posting is also
   measured.

Option 2 is what accounting does and what it calls the **functional currency**:
the unit the books are kept in. Every posting carries two amounts — what moved,
in the account's own currency, and what it was worth, in the functional
currency — and the invariant applies to the second.

## Decision

Each organisation has a functional currency. Each posting carries:

| Column              | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `amount_minor`      | What moved, in the account's currency. Unchanged.             |
| `base_amount_minor` | What it was worth, in the organisation's functional currency. |
| `fx_rate`           | The rate used, recorded for audit. Not used in any check.     |

The deferred constraint that has always enforced `sum(amount_minor) = 0` now
enforces `sum(base_amount_minor) = 0`. For a single-currency entry in the
functional currency the two are identical, which is why every existing entry
survives unchanged.

The `(transaction_id, currency)` foreign key is dropped, because it is exactly
the constraint that made this unrepresentable. The `(account_id, currency)` one
stays: a posting still cannot be denominated in a currency its account does not
hold, which was never the thing in the way.

### The ledger does not multiply

`base_amount_minor` is supplied, not computed. The ledger stores what the
caller decided and refuses anything that does not balance in the functional
currency.

This is the decision most likely to look lazy and is the opposite. Rate
multiplication is where FX models rot: a rate is a decimal, an amount is an
integer, and the product has to be rounded. Round each leg independently and a
two-legged entry stops summing to zero — not always, just often enough that the
failure arrives in production as a trial balance that is off by one cent and
nobody can say which entry did it.

Somebody has to decide where that cent goes, and that decision is a _policy_,
not arithmetic: some businesses plug it to FX gain/loss, some to a rounding
account, some re-derive one leg as the residual. A ledger that picks one and
hides it inside an integer division has made an accounting policy decision on
its user's behalf, silently.

So the core stays exact. Integers in, integers checked, no floating point
anywhere near the invariant. The convenience layer that _does_ multiply — take
a rate, compute the legs, plug the residual — sits above it in the service and
is visible, testable and replaceable. It is not the thing the constraint
trusts.

### Rates are data

`exchange_rates` stores `(base, quote, rate, as_of, source)`, with `rate` as
`numeric(20, 10)`. Numeric because a rate is a decimal and a float is not: at
1 USD = 25,470.5 VND, a double has already stopped being able to represent the
tenth of a dong exactly, and a rate that is wrong in the tenth place is wrong by
a dollar on a hundred thousand.

Rates are point-in-time facts, never updated. A rate that changes is a new row
with a later `as_of`, and a lookup asks for the most recent one at or before the
entry's date — so re-running last quarter's reports uses last quarter's rates,
which is the only way a restated figure can be explained.

## Consequences

**The trial balance is a statement about the functional currency.** Summing
`amount_minor` across currencies was always meaningless; it only looked correct
because every account was USD. It now sums `base_amount_minor`, and that sum is
zero for the same structural reason it always was.

`obol_ledger_residual_minor` follows: one gauge, in the functional currency,
still with exactly one acceptable value. The per-currency breakdown stays as a
_label_, but the alert is on the functional total.

**An account statement keeps both figures.** A VND bank account's statement is
in VND — that is the account's reality, and translating it would be answering a
question nobody asked. The functional amount travels alongside for anyone
reconciling to the consolidated accounts.

**Realized FX gain and loss follows immediately**, in migrations 0011 and 0012. When a foreign payable settles at a rate different from the one it was
booked at, the difference is real income or expense, and a designated account
absorbs it — but only when the entry already balances within every transaction
currency, which is the condition that makes an automatic adjustment incapable
of hiding a typo. Unrealized gain, revaluing open foreign balances at a
period-end rate, hangs off the period close and comes after that.

**Existing data migrates only if it is unambiguous.** The backfill sets
`base_amount_minor = amount_minor` and `fx_rate = 1` for every posting whose
account is already in the functional currency, and _raises_ if it finds one that
is not. A historical rate cannot be invented, and a migration that guesses one
produces a ledger that balances and lies.

## Alternatives considered

**Store only the functional amount.** Simpler, and destroys the information the
user cares most about: an importer's supplier invoice is 40,000 USD, not its
translation. A ledger that cannot show the amount on the invoice is not a
ledger that business can use.

**Store only the transaction amount and translate at read time.** Reports become
a function of today's rates, so last quarter's revenue changes every morning —
the exact property [ADR 9's](0009-webhooks.md) sibling, the period close,
exists to prevent.

**A separate "currency conversion" entry pairing two single-currency entries.**
This is what a ledger without the model forces on its users, and it is worth
naming because it is the status quo being replaced: two entries, a convention
linking them, and no constraint that the pair balances. Everything that makes
double entry trustworthy is lost precisely where the money is hardest to follow.

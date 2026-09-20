# 12. Unrealized FX is a remeasurement, gated before the close

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

[ADR 10](0010-multi-currency.md) made an entry able to cross currencies, and
realized gain and loss answers the question "the rate moved between booking and
paying". This is the other half: the rate moved and you have _not_ paid.

A 40,000 USD payable on a dong ledger is worth a different number of dong at
month end than it was when it was booked. That difference is real whether or
not anybody has settled anything, and a balance sheet that ignores it states a
liability at a rate that stopped being true weeks ago.

Three decisions, none of which is obvious.

## Decision 1: which balances move

IAS 21's distinction is **monetary** items: units of currency held, or assets
and liabilities to be received or paid in a fixed or determinable number of
units. Cash, bank balances, receivables, payables, loans. They are retranslated
at the closing rate each reporting date and the difference goes to profit or
loss.

Inventory and fixed assets are not. They are carried at the rate that applied
when they were bought, permanently.

The asymmetry is the most examined point in the standard and is worth stating
plainly, because it is the thing a model gets wrong: **one credit purchase of
stock in dollars produces two different treatments.** The inventory stays at
the purchase-date rate forever; the payable it created moves every month end.

This model's five account types cannot tell cash from inventory — both are
assets — so monetary-ness is a property of the _account_, recorded as a column.

It defaults to true for assets and liabilities, which is right for the
overwhelming majority of foreign accounts a trading company opens, and the
chart templates mark the known exceptions. The default direction is deliberate:
an account wrongly _included_ appears in the revaluation preview where a person
sees it, and one wrongly _excluded_ is silent.

A `CHECK` forbids the flag on revenue, expense and equity accounts, and a
trigger clears it there rather than letting an insert fail — a column default
cannot depend on another column, so without the trigger any statement that did
not mention `monetary` would be rejected on exactly the accounts where the flag
has no meaning.

## Decision 2: cumulative, not reversing

The retranslation entry stands. It is not unwound on the first of the next
month.

IAS 21 _remeasures_ the item — the carrying amount genuinely changes — and the
next period's revaluation computes the difference between what the balance is
now worth and what it is currently carried at. That needs no memory of the
previous adjustment beyond the balance itself, which is also why running the
revaluation twice posts nothing the second time.

The reversing alternative is common in systems that revalue only for reporting,
and it has one real advantage worth acknowledging: the ledger keeps historical
rates, so a trial balance taken mid-period is not polluted by an adjustment
nobody has realised. It was rejected because the balance sheet is then wrong
between the first of the month and the close, and a balance sheet that is only
right on one day a month is one people stop trusting.

### The entry shape this forced

A retranslation moves no foreign currency. The dollars in the bank are the same
dollars; only their worth in dong changed. So each leg carries `amount = 0` and
a non-zero functional amount — a shape two existing constraints forbade:

- `postings_base_sign_check` required `sign(base) = sign(amount)`, and
  `sign(0)` is `0`.
- The domain validator rejected any posting with a zero amount.

Both were relaxed rather than removed. When currency _does_ move, the two
amounts must still point the same way — a debit of 100 USD cannot be worth a
credit of 2,500,000 VND. And a new constraint says a posting must record
_something_: both amounts zero is a line that says nothing, and a pair of them
would balance perfectly.

The relaxation is not a loophole. A posting with no currency movement and a
changed functional value has a name, and the name is the feature.

## Decision 3: a gate before the close, not part of it

`periods.close()` **refuses** when a month holds foreign monetary balances that
have not been retranslated, naming the accounts.

Folding the revaluation into the close would be friendlier and would hide a
policy decision — which rate, which accounts — inside an operation nobody
reviews. A warning would be worse: warnings are things people learn to click
past. Refusing makes the omission impossible to miss, and it mirrors how a real
close checklist works: revalue, review, then seal.

The period carries a `revalued_at` timestamp, and "we retranslated and nothing
had moved" satisfies the gate while "nobody retranslated" does not. A single-
currency ledger never meets the gate at all, because there is nothing foreign
to retranslate.

The revaluation must also happen _before_ the close for an arithmetic reason,
not only a procedural one: the gain or loss it creates is part of the period's
profit, and the close is what sweeps that into retained earnings.

## Consequences

- **Rates are finally read.** The `exchange_rates` table has existed since ADR
  10 and nothing consumed it. The closing rate is the most recent recorded _at
  or before_ the last day of the month — not today's, which would make last
  quarter's reports change every morning.
- **A missing rate refuses the revaluation** rather than defaulting to one.
  There is no safe default for a rate; `rate_not_found` names the pair.
- **Re-recording a rate for the same pair, day and source is a correction.**
  Two rows claiming different rates for the same day would make every lookup
  arbitrary.
- **Unrealized differences go to the same account as realized ones.** Under
  TT200 there is an argument for 413 (chênh lệch tỷ giá hối đoái, an equity
  account) in particular circumstances rather than 515/635. The distinction is
  real and is not modelled; 413 is in the template and deliberately unused. See
  [ADR 11](0011-chart-of-accounts.md) for the other TT200 divergences.
- **Nothing is revalued for a period that is already closed.** The month is
  sealed, and a retranslation dated inside it would be rejected by the lock
  anyway.

# 11. Account codes, and the difference between a convention and a law

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

Accountants do not read a chart of accounts by name. They read it by code, in
code order, and an account without one is an account they cannot file. This
model had names only and sorted them alphabetically — which put Accounts
Payable above Cash above Sales, an ordering that tells a reader nothing about
which is an asset.

Adding a `code` column is trivial. The question worth an ADR is what a chart
_template_ is, because jurisdictions differ structurally here rather than
cosmetically, and a model that treats them alike gets one of them wrong.

**Conventional charts** — Australia, New Zealand, the US, most of the EU — have
no mandated numbering. Xero's own guidance is to _choose_ a numbering system
and to leave gaps so accounts can be inserted later; two mainstream Australian
products ship different defaults. Whatever regularity exists is habit,
substantially shaped by what the incumbent software happened to ship.

**Statutory charts** are law. Vietnam's Thông tư 200/2014/TT-BTC prescribes 76
level-one accounts, and the leading digit _is_ the account class. A business
does not get to invent a code, and one that files under the wrong class has
filed wrongly, not differently.

## Decision

A template is a starting point for a conventional chart and a constraint for a
statutory one, and the database knows which kind it has.

`organizations.chart_template` records the choice. It is carried onto every
account row and pinned there by a composite foreign key —
`(org_id, chart_template)` referencing `organizations (id, chart_template)` —
which is the same technique that already makes a cross-currency posting and a
cross-tenant posting unrepresentable.

That indirection exists for one reason: a `CHECK` cannot read another table,
and the rule is conditional on the tenant's template. Denormalising the
template onto the row turns "look up the organisation and then decide" into a
constraint Postgres can evaluate on the row in front of it. A trigger would
also have worked; a trigger that can be disabled is a weaker promise than a
key that has no row to point at.

A second trigger _fills_ the column from the organisation on insert, so the
application cannot forget to copy it. The two together mean the column cannot
be wrong: the trigger sets it, and the key keeps it in step if an organisation
ever changes template.

### Codes are optional, except when they are not

`code` is nullable. Every account that predates this has none, a sole trader
with eleven accounts reads them by name perfectly well, and requiring one would
mean inventing codes for history — the same class of mistake as inventing a
historical exchange rate.

Uniqueness is a _partial_ unique index over `(org_id, code) WHERE code IS NOT
NULL`. Postgres treats NULLs as distinct, so a plain unique constraint would
have worked too, but the partial index says the intent out loud: "no code" is
an absence rather than a value competing for uniqueness.

Under a statutory template the same `CHECK` that enforces the digit also
requires a code at all. There is no such thing as an unnumbered account under
TT200.

### The digit mapping, and where it does not fit

TT200's classes map onto this model's five account types like this:

| Digit | TT200 class                       | Here        |
| ----- | --------------------------------- | ----------- |
| 1     | Current assets                    | `asset`     |
| 2     | Non-current assets                | `asset`     |
| 3     | Liabilities                       | `liability` |
| 4     | Owners' equity                    | `equity`    |
| 5     | Revenue                           | `revenue`   |
| 6     | Production and business expenses  | `expense`   |
| 7     | Other income                      | `revenue`   |
| 8     | Other expenses                    | `expense`   |
| 9     | Determination of business results | **nothing** |

Digits 1/2, 5/7 and 6/8 collapsing in pairs is not a problem. Those are
_presentation_ distinctions — a balance sheet separates current from
non-current, an income statement separates operating from other — and
presentation is a reporting concern, not a posting rule. Nothing about how a
posting behaves depends on which of the pair it belongs to.

**Class 9 is a real divergence, and it is accepted rather than worked around.**

Account 911 (xác định kết quả kinh doanh) is a clearing account. At period end,
revenue and expense accounts are closed into it, and its resulting balance —
the period's profit or loss — is then closed into 421, undistributed profit
after tax. Outside that sequence it holds nothing.

This model's period close does the same job in one step: it zeroes revenue and
expense directly into the account carrying the `retained_earnings` role, which
on a TT200 chart is 421. The arithmetic is identical and the closing entry
balances the same way. What a Vietnamese accountant would not see is the 911
line, and the two-step trail through it.

Three options were considered:

1. **Add a sixth account type for clearing accounts.** Rejected. A type exists
   to determine a normal balance and a statement section; 911 has neither
   stably, and every other part of the system would grow a case for a type
   that appears in one jurisdiction's closing procedure.
2. **Model 911 as equity.** Rejected. It would sit on the balance sheet
   between closes holding zero, and any period where the close was interrupted
   would show a number in equity that is not equity.
3. **Omit it, and say so.** Accepted.

The honest statement is that this model's five types do not cover a
results-determination account, and that the close produces the same figures by
a shorter route. A tenant who must file a TT200-shaped trial balance showing
911 would need that account, and this is where the model stops matching how
they work — which is exactly the kind of gap worth writing down rather than
hiding.

### Where exchange differences go

TT200 puts realised exchange gains in 515 (doanh thu hoạt động tài chính) and
realised losses in 635 (chi phí tài chính) — two accounts, by class. This model
has one `fx_gain_loss` role, attached to 635, and a favourable month shows as a
credit balance there.

That is the second divergence. It is smaller than 911 — the net effect on
profit is identical and the role constraint already requires an account that
may hold either sign — but a tenant producing a statutory income statement
would need the gains presented in 515. Splitting the role in two is a
straightforward change; doing it before anyone has asked would be inventing a
requirement.

Account 413 (chênh lệch tỷ giá hối đoái) is in the template as equity and is
deliberately unused by the FX code. It is where _unrealised_ differences sit in
particular circumstances under the circular, and unrealised revaluation is not
built yet.

## Consequences

- **The chart sorts by code**, nulls last, then by name. An uncoded account
  sorts after the coded ones rather than above the whole chart, which is where
  Postgres puts NULLs by default.
- **A template is validated by being used.** The starter chart is opened
  through the ordinary account service, so a template with a code that
  contradicts its type is rejected at onboarding rather than shipped. There is
  also a test asserting it directly, which says _which_ code.
- **Codes were verified against two independently published transcriptions of
  the circular** rather than from memory. They agreed on 75 accounts; the
  second listed 344 (nhận ký quỹ, ký cược) which the first had dropped, and the
  discrepancy was resolved in favour of the circular.
- **The templates are subsets.** Shipping all 76 TT200 accounts as a default
  would hand a freight forwarder a construction-in-progress account and a
  science-and-technology development fund. The full list is law and available;
  what is opened is what a trading company uses.

## Addendum: Thông tư 133

Most Vietnamese importers, exporters and distributors are small and medium
enterprises, and keep their books under Thông tư 133/2016/TT-BTC rather than 200. It is offered as its own template (migration 0031) and enforced the same
way: the statutory-code CHECK covers both circulars, so a rule fixed for one
cannot drift from the other. The template differs where posting differs — no
521, so returns and discounts come straight off 511; no 641, with selling and
administrative expense as 6421 and 6422. The account list was drawn from the
circular's structure and should be checked by a Vietnamese accountant before a
customer relies on it; the setup screen offers it first to a Vietnamese reader.

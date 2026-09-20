# 13. Inventory is layers, and the costing method is a policy

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

Ask an importer what is hard and the answer is not the ledger. It is working
out what the stone that just left the yard actually cost, when it arrived in
four shipments at four prices, some of them in dollars at four different rates.

That calculation lives in a spreadsheet, and the spreadsheet is usually the
most complicated thing the business owns: columns of purchase lots, a running
balance per lot, and a macro that walks them in order when a sale is entered.
It works until somebody inserts a row, sorts a column, or leaves.

The ledger this project already has cannot help with any of that, because it
has no idea what a _quantity_ is. A purchase is an amount of money into an
inventory account and a sale is an amount of money out, and the amount out is
whatever the person typing decided it was. The books balance either way. That
is precisely the class of error double entry cannot catch, and precisely the
number the business cares most about.

## Decision

Inventory becomes **items** with **cost layers**. A purchase opens a layer at a
quantity and a unit cost; a shipment consumes layers and the consumption
produces the cost of goods sold. The ledger entry is generated from the layers
rather than typed, so the amount that leaves the inventory account is arithmetic
rather than an opinion.

The method for choosing which layers to consume is a **policy on the tenant**,
picked at onboarding beside the chart of accounts, because it is the same shape
of decision: partly convention, partly law.

| Method             | Meaning                            | Where                                           |
| ------------------ | ---------------------------------- | ----------------------------------------------- |
| `fifo`             | Oldest layer first                 | Permitted everywhere                            |
| `weighted_average` | One blended cost across all layers | Permitted everywhere                            |
| `specific`         | The layer is named on the movement | Required for items that are not interchangeable |
| `lifo`             | Newest layer first                 | **US only**                                     |

### LIFO is the second convention-versus-law case

LIFO is permitted under US GAAP and **prohibited** under IFRS — and under
Vietnamese accounting, where Thông tư 200 does not include it. A ledger that
offered it to every tenant would be offering some of them a way to produce
accounts their auditor must reject.

So the same technique that enforces the Thông tư 200 digit rule enforces this:
the costing method is carried on the tenant beside the chart template, and a
`CHECK` refuses `lifo` on any chart that is not the US one. It is not a warning
and not a dropdown that hides the option — it is unrepresentable, for the same
reason a cross-tenant posting is.

### Specific identification is not an edge case here

For a stone exporter it may be the _normal_ case. A granite block is not
interchangeable with another granite block: it has dimensions, a colour, a
grade and a quarry. IAS 2 and every national equivalent require specific
identification for items that are not ordinarily interchangeable, which is
exactly what a block is and exactly what a pallet of 400×400 pavers is not.

So a business will want both, on different items — and the method is therefore
allowed to be overridden **per item**, with the tenant's choice as the default.
That is one column and it removes the need to run two systems.

### Quantities are integers, in the item's own unit

The same decision as money, for the same reason. A quantity of stone is
measured in square metres to two places, tonnes to three, or pieces to none,
and a float loses the third decimal of a tonne in a way nobody notices until a
layer will not close. Each item declares its unit and its precision, and
quantities are stored as integers scaled by it.

### The cost of a layer is recorded in both currencies

A layer bought for 40,000 USD at 25,400 carries both — the foreign cost and
what it was worth in dong when it arrived. Inventory is _non-monetary_
([ADR 12](0012-fx-revaluation.md)), so the dong figure never moves again: the
cost of goods sold for that stone is the rate on the day it was bought,
forever, even when the payable that financed it is retranslated every month.
This is the asymmetry that ADR 12 describes, and layers are where it lands.

## Consequences

**The cost of goods sold entry is generated.** It is posted through the
ordinary journal service, like the closing entry and the revaluation, so it
obeys the balance rule and the period lock. What the layers decide is the
_amount_; nothing about it is exempt from the rules that make the rest
trustworthy.

**A shipment that exceeds what is on hand is refused.** A spreadsheet will
happily cost a sale against a negative balance and produce a plausible number.
Refusing is the whole value: it is the error the macro cannot see.

**Weighted average is recomputed, not stored.** Storing a blended cost means
storing a number that has to be updated on every purchase and is wrong if any
update is missed. The layers are the truth and the average is derived from
them.

**Layers are append-only in the same way postings are.** A layer's remaining
quantity changes as it is consumed, and that is the only mutation permitted; a
correction is a reversing movement, not an edit, so the trail survives.

### Getting the history in is half the problem

A costing engine is useless to somebody whose lots are in a workbook with four
hundred rows in it, and "type them in again" is not an answer. So deliveries
can be pasted in, and the care is all in the reading rather than in anything
clever:

- **What arrives is usually not a CSV file.** Somebody selects a block in Excel
  and presses copy, and what lands is *tab*-separated.
- **A comma is not the separator everywhere.** Excel writes CSV with the system
  list separator, which in Vietnamese, German and French locales is a
  **semicolon**, because the comma is the decimal mark.
- **Headers are in the user's language.** `Mã hàng` is a product code. Stripping
  everything but `a–z` turns it into `mhng`; the accents have to be
  *decomposed* and their marks removed instead — and `đ` is a letter in its own
  right, which NFD does not touch, so it is mapped by hand.
- **`10/01/2026` is the tenth of January**, in every market this ledger ships
  charts for. The preview prints the resolved date back beside the row, because
  an ambiguous date the importer got wrong is invisible unless it is echoed.

And it is **all or nothing**. A partially applied import is the worst outcome
available: the books have moved, nobody knows how far it got, and undoing it
means finding which rows landed. The preview runs exactly the checks the apply
runs — a cheaper preview is a preview that lies, usually about the last row.

## Alternatives considered

**Periodic costing** — count what is left at month end and derive the cost of
sales from the difference. Simpler, requires no layers, and is what many small
importers actually do. Rejected because it cannot answer "what did _that_
container cost", which is the question the business asks, and because it makes
the cost of sales a residual: any error in the count becomes an error in profit
with nothing to attribute it to.

**Storing cost of goods sold as typed input**, which is the status quo.
Rejected for the reason above: the books balance whatever number is typed, so
the one figure nobody can check is the one that decides whether the business is
profitable.

**A separate inventory system.** Honest, and what most businesses end up with.
It also means the inventory balance and the inventory account disagree the
first time somebody posts a manual adjustment to one and not the other —
which, in every business that has two systems, is the first week.

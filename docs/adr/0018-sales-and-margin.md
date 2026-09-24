# 18. A sale is the invoice and the stock that left, in one entry

- **Status**: Accepted
- **Date**: 2026-09-24

## Context

[ADR 13](0013-inventory-costing.md) made the cost of stock arithmetic rather
than an opinion, and [ADR 15](0015-landed-cost.md) made it include what the
goods cost to land. Both stopped at the warehouse door. Selling was still two
unrelated facts:

- an invoice, typed as a journal entry: receivable against revenue;
- a stock movement, which posted the cost of goods sold from the lots.

Both balanced. Neither knew the other existed. So the question a distributor
asks of every invoice — _what did we make on it?_ — had no answer anywhere in
the ledger. Revenue sat in 511, cost in 632, and the margin on INV-2607 was a
VLOOKUP between two exports, matched on a reference somebody may or may not
have typed into both.

That is the same spreadsheet ADR 13 was written against, moved one sheet over.

## Decision

A **sale** posts one entry:

```
Dr  Receivable (customer)   gross, in the invoice currency
  Cr  Revenue                 net, in the functional currency
  Cr  Output tax              when a tax code applies
Dr  Cost of goods sold      from the lots, by each item's own method
  Cr  Inventory
```

and writes a `sales` row whose **lines are its stock movements**. Each line is
an ordinary issue that also carries what it was sold for, so the cost and the
price of a line sit on one row and its margin is a subtraction. Margin by
invoice, by product and by customer is a `GROUP BY` over facts the ledger
already holds.

### The customer is an account

One receivable per customer is how Thông tư 200 keeps 131 — a detail ledger
per đối tượng — and it is what the aged report already groups by. A separate
customer table would be one more thing that can disagree with the accounts, so
margin by customer groups by the receivable the sale was posted to.

### Currencies

An exporter invoices in the buyer's money. The receivable leg is in the
customer account's own currency and carries its functional value at the rate
on the invoice date; revenue is recognised in the functional currency at that
rate, which is the IAS 21 answer and the only one under which later rate
movements land in FX gain and loss rather than quietly rewriting what was sold.
A customer account in a third currency is refused rather than bridged with a
cross rate nobody supplied.

**Each line is converted on its own**, and the header is their sum. Converting
the total and apportioning it back would make one line's revenue depend on its
neighbours, so adding a line would change the margin reported on the others.
The receivable's functional value is _derived_ — revenue plus the tax legs —
rather than converted a third time, which would leave the entry out by a dong.

### Two lines of one product

A sale of 600 m² and then 900 m² of the same paver must not have both lines
start from the oldest container. The lots are drawn down in memory, line by
line (`afterDraws`), with the open lots locked `FOR UPDATE` as an issue already
locks them, and written once.

### The header agrees with its lines — at COMMIT

A `DEFERRABLE INITIALLY DEFERRED` constraint trigger asserts that a sale's
revenue and cost equal the sums of its lines. Deferred for the reason the
balance rule is: the header is written first so the lines can reference it,
and at that instant it has none. What it protects is the property the margin
reports depend on — that "by product" and "by customer" are two views of the
same total, not two totals.

## The entries the stock records wrote

The journal's reverse button negates an entry's postings and touches nothing
else. Applied to a receipt, a sale or a landed-cost charge, it put the
inventory account back while the lots still claimed the stock, and every cost
drawn from them afterwards was posted against stock the account no longer
carried. Both entries balanced; nothing objected.

So those entries cannot be reversed from the journal: the service refuses with
`entry_owned_by_stock`, and a trigger refuses the same insert for every other
writer. Stock is corrected by moving stock.

### Write-offs

The `writeoff` movement kind reserved in 0017 is now used: breakage, expiry,
loss and stocktake shortfalls leave at cost, drawn by the item's method, into
an expense the business chooses — never cost of sales, where shrinkage hides.
The reason is a column the database requires, because a shortfall trend is only
visible if shortfalls can be told apart from breakage.

### Reconciliation

By construction the lots and the inventory accounts agree. What construction
cannot stop is a hand-typed journal line on 156. The stock page and month end
compare each inventory account with its open lots and list the entries on it
that no stock record wrote — which is where any difference came from.

## Consequences

**Revenue on a sale is fixed at the invoice rate.** A dollar invoice settled
later at a different rate produces an exchange difference, not a revision of
revenue. That is correct and it is what the receivable's stored rate is for.

**Late freight is a product's cost, not an invoice's.** A landed-cost charge
arriving after the goods have gone goes to cost of sales (ADR 15). The margin
report shows it against the product and says so; by customer it is absent, and
the two tables' costs differ by exactly that amount — stated on the page rather
than left for a reader to find.

**There is no credit note yet.** A sale is append-only and cannot be reversed
from the journal. A customer return is the next thing this needs: it reopens
stock at the cost it left at and credits the receivable, as its own record.

## Alternatives considered

**Linking an invoice entry to a stock movement after the fact**, by reference.
Cheaper, and exactly the matching-by-convention the spreadsheet does: nothing
stops the reference being mistyped, reused or omitted, and the margin is then
silently wrong.

**A price on the item, and revenue computed from it.** Distributors do not sell
at list: price varies by customer, by volume and by week. The invoice line is
the fact; a price list is at most a default for filling one in.

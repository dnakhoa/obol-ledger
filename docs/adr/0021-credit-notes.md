# 21. A sale is corrected by a credit note, never by an edit

- **Status**: Accepted
- **Date**: 2026-09-24

## Context

A sale is append-only ([ADR 18](0018-sales-and-margin.md)), which is right for
a record a customer has been sent. It left no way to correct one. A buyer who
returns two pallets of cracked pavers, or is given something off for a late
container, could only be handled by a hand-typed journal entry. That entry
balanced, and it was wrong in four ways nothing reported:

- revenue moved without the sale knowing, so margin by invoice, product and
  customer kept counting the pallets as sold;
- stock went back into the inventory account without going back into a lot,
  so the account and its lots disagreed from then on;
- the credit aged against whichever invoice was oldest, not the one it
  corrected;
- nothing stopped a refund larger than the sale.

## Decision

A **credit note** is a record of its own that names the invoice and the lines
it corrects. Each line may bring goods back, credit money, or both; a line
that brings nothing back is a price allowance. One entry posts it:

```
Dr  Revenue, or a contra account such as 521   net credited
Dr  Output tax                                  tax on it
  Cr  Receivable                                  gross, at the invoice's rate
Dr  Inventory                                   what the returned goods cost
  Cr  Cost of goods sold
```

1. **Goods go back into the lots they left from, at the cost they left at.**
   A returned paver is not a new purchase. The line's own draws say which
   lots it came from; a return refills the newest of them first and costs
   each unit at what its draw took. `layer_restorations` records it, the
   mirror of `layer_consumptions`, so "stock cannot come back that never left"
   is a sum the database can check.
2. **At the invoice's rate and under its tax code.** A credit note undoes part
   of that invoice; at today's rate it would book an exchange difference no
   money moved to create, and under today's code it would take back tax the
   invoice never charged.
3. **The final credit takes exactly what is left.** Revenue, tax and cost are
   each worked out as a share of what remains, and the credit that finishes a
   line or an invoice takes the remainder rather than a freshly rounded share
   — the rule the costing module already uses to empty a lot. An invoice
   credited in thirds ends at zero, not at one dong.
4. **The tax lands in the month the note is dated.** It is recorded as a
   negative output-tax row, so it appears on that month's return, which is
   when an adjustment is declared.
5. **It settles its own invoice.** The entry carries `appliesTo`, and the aged
   receivables apply it to that invoice before anything else.
6. **The limits live in the database.** Per invoice line, no more quantity
   back than shipped and no more revenue than earned; per invoice, no more net
   or tax than charged; each returned line's movement and restorations agree
   with it at COMMIT. The checks lock the invoice line or draw they sum over,
   so two credit notes racing each other queue rather than both passing.

The entry a credit note posted is refused by the journal's reversal, as the
stock records' entries are ([migration 0026](../../drizzle/0026_stock_owned_entries.sql)):
reversing it there would put the revenue back and leave the note claiming a
credit the books no longer hold.

## Consequences

**The invoice figures never change.** A sale shows what was invoiced and, beside
it, what credit notes took back and what it is worth now. The margin report
nets credits off in the month they were issued, so a September return reduces
September, and July's report still reproduces.

**Sales raised before this change have no invoice-currency line totals.** They
recorded only the functional-currency revenue. The invoice's net is apportioned
across their lines by revenue instead, which is exact for an invoice in the
books' own currency and the best available figure for a foreign one.

**A return does not check the goods are sellable.** They go back into stock. A
cracked slab that comes back cracked is returned and then written off, which
records both facts rather than hiding the second inside the first.

## Considered and rejected

- **Reopening returned goods as a new lot.** It would value them at a price no
  supplier charged and lose which container they belong to.
- **Letting the sale be edited within a grace period.** A document the customer
  has already received cannot change underneath them, and a margin report run
  yesterday would stop reproducing today.

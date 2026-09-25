# 23. Goods go back to a supplier from the delivery they came in

- **Status**: Accepted
- **Date**: 2026-09-25

## Context

Stock could leave in two ways: sold, or written off. Sending twelve square
metres of chipped marble back to the quarry was neither. It was booked as one
or the other with a hand-typed entry for the supplier's credit, and each way
was wrong:

- as a sale, the slabs showed up in cost of goods sold and in margin;
- as a write-off, they showed up as a loss that the supplier had in fact
  refunded;
- either way, the supplier's account went on saying the full invoice was
  owed until someone typed a journal entry, and that entry moved neither the
  lot nor the stock records.

The part people get wrong most often is landed cost. The lot carries the
slabs at the supplier's price plus a share of the freight, duty and broker's
fees ([ADR 15](0015-landed-cost.md)). The supplier refunds its own price. It
does not refund the shipping line's charges. The gap between the two is real
money, and it has to go somewhere.

## Decision

A **supplier return** is a record of its own. It names one delivery (a lot)
and the quantity going back, and posts one entry:

```
Dr  Payable (supplier), or bank     the refund, at the lot's own rate
Dr  Expense                         carrying cost the refund does not cover
  Cr  Inventory                       what the lot carried the goods at
  Cr  Input VAT                       tax on the refund, when it had some
```

1. **Out of the named lot, at what it carries them at.** The goods leave
   through an ordinary draw (a `layer_consumptions` row), so the lot, the
   inventory account and the stock records move together. The draw is
   specific to that lot whatever the product's costing method. A return is
   made against a delivery, and the delivery is what the supplier invoiced.
2. **The refund defaults to the supplier's own price.** That is the lot's
   supplier-currency cost for the goods, as a share of what is left, so a lot
   returned in instalments refunds exactly what it cost. An override covers
   restocking fees and negotiated credits. Across all returns, a lot never
   refunds more than was paid for it.
3. **At the rate the lot was bought at.** The refund undoes part of that
   purchase. At today's rate it would book an exchange difference that no
   money created, and the payable's revaluation
   ([ADR 12](0012-fx-revaluation.md)) starts from the booked rate anyway.
4. **The difference goes to an expense, never back into stock.** Carrying
   amount less refund is the landed cost spent on goods that have gone. It
   goes to the product's cost of sales unless the return names another
   expense. Left in inventory, it would be carried by stock that is no longer
   in the yard. For a lot with nothing landed on it, returned at the
   supplier's price, the difference is exactly zero. The rounding that
   converting afresh would introduce is avoided by construction.
5. **Input VAT comes back out only on a local purchase.** With a tax code,
   the tax on the refund is reversed and recorded as a negative purchase row,
   so it lands on the return for the month the goods went back. On a lot
   bought in a foreign currency this is refused. Import VAT is paid to
   customs and reclaimed from the state; the supplier abroad never charged
   it and gives none of it back.
6. **It settles the supplier's invoice.** When the receipt recorded an
   invoice number, the entry carries `appliesTo` and the aged payables apply
   the credit to that invoice first.
7. **The limits live in the database.** Migration 0033 does four things:
   - Composite keys tie a return to a lot of the same product in the lot's
     own currency.
   - A trigger, under a lock on the lot, refuses refunds beyond what was
     paid, or dated before the delivery.
   - At COMMIT, the return must agree with its movement and draw: the same
     quantity, the same carrying amount, from that lot and no other.
   - A movement of kind `supplier_return` with no return beside it is
     refused.

   The entry cannot be reversed from the journal, like every other entry
   the stock records own.

## Consequences

- The seed sends twelve square metres of the Carrara container back, so the
  sample ledger shows the case this was written for: a dollar refund, and
  landed cost in 811.
- A supplier return is not yet a printable debit note. It has a number and a
  reason, which is what the supplier's credit note will quote; producing the
  document is part of the e-invoicing work.
- Returning goods that arrived as an opening balance needs the supplier named
  explicitly, because the lot has no receipt entry to take it from.

## Considered and rejected

- **A negative receipt.** It would open or shrink a lot at a new price and
  lose which delivery the goods belonged to. The refund cap would then have
  nothing to be checked against.
- **Refunding at carrying cost.** This is the most common spreadsheet
  shortcut. It makes the supplier appear to owe back the forwarder's freight,
  and it leaves a payable balance nobody will ever pay.
- **Keeping the unrefunded landed cost in the remaining stock.** This inflates
  the cost of goods still on hand with charges for goods that are gone. The
  error would surface months later as margin on the next sale.

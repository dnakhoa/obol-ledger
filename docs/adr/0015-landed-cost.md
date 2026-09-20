# 15. A supplier invoice is not what the goods cost

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

[ADR 13](0013-inventory-costing.md) made a delivery a quantity at a price, which
is most of what an importer needs and not all of it. A container of granite
arrives and the supplier invoice says 40,000 USD. The stone did not cost 40,000
USD. It cost that, plus:

- ocean freight, billed by the shipping line weeks later;
- import duty, which is not recoverable;
- the customs broker's fee;
- inland haulage from the port;
- insurance.

[IAS 2](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ias2.html)
is explicit: the cost of purchase comprises the price, _import duties and other
taxes_, and transport, handling and other costs directly attributable to
acquisition. All of it belongs in the value of the stock in the yard.

Booking those as period expenses understates inventory, overstates this
month's costs, and makes every subsequent cost of goods sold wrong by the same
margin. On a container of stone that margin runs to a fifth of the invoice. It
is not a rounding — it is the difference between knowing your gross margin and
guessing it.

**Neither Xero nor QuickBooks Online does this.** Xero's landed-cost
allocation is an
[open request on its own ideas forum](https://productideas.xero.com/forums/967139-purchase-orders-bills-inventory/suggestions/48529637-inventory-landed-cost-allocation);
QuickBooks Online has
[no mechanism](https://invoicedataextraction.com/blog/quickbooks-online-landed-cost-allocation)
to attach a freight invoice and a duty assessment to a shipment and roll them
into per-item cost — only QuickBooks Enterprise does. Importers allocate it
outside the software and type the answer back in.

That is the same spreadsheet ADR 13 was written against, one column further
right.

## Decision

Lots that arrive together belong to a **shipment**. A **charge** attaches to
the shipment and is apportioned across its lots, raising what they are carried
at.

### The entry

```
Dr  Inventory        the part landing on stock still held
Dr  Cost of sales    the part attributable to stock already sold
  Cr  Payable / bank                                  the whole charge
```

The second debit is not an edge case. A freight invoice routinely arrives six
weeks after the container, by which time some of it has shipped. That cost
cannot be added to a lot nobody has, and the cost of goods sold it belongs to
was posted weeks ago and is append-only.

So it goes to cost of sales now, in the period the charge became known. That is
both the only available answer and the right one: the expense belongs to the
revenue it helped earn, and that revenue is already recognised.

### Apportionment is exact, twice

Two divisions happen, and both must reconcile:

1. the charge across the lots, by value, quantity or weight;
2. each lot's share between stock still held and stock already sold, in
   proportion to how much of the lot is left.

Both go through `lib/apportion`, which assigns the remainder by largest
fractional claim rather than rounding each share independently. Rounding
independently loses or invents units — three shares of ten round to 3, 3, 3 and
the tenth vanishes — and a freight invoice that does not reconcile to the sum
of what it was spread over is a freight invoice somebody spends an afternoon
on.

The second split needs no special cases: weighting by remaining against
consumed makes an untouched lot take the whole share into stock and a
sold-through lot take the whole share to cost of sales, by the same arithmetic.

`landed_cost_charges_reconciles_check` asserts the same thing in the database,
because the arithmetic is not the only thing that can write there.

### Recoverable tax is not a cost

IAS 2 excludes taxes "subsequently recoverable by the entity". Import VAT is
reclaimed from the revenue authority, so it never was a cost of the goods;
customs duty is not recoverable and is. Getting these two the wrong way round
is the commonest landed-cost mistake, and it is silent — the accounts balance
either way.

So `capitalise` is a **column**, not something inferred from whichever account
somebody picked, and a non-capitalising charge requires an account of its own.
It allocates nothing to the stock and is recorded against the shipment anyway,
so the shipment shows the whole customs declaration rather than most of it.

### Three bases, and two of them can refuse

Value is always available. Quantity is refused across lots measured in
different units, because spreading by quantity over tonnes and square metres is
adding one to the other — the numbers come out and mean nothing. Weight is
refused when any lot has none recorded, because treating an unweighed lot as
weightless silently pushes its whole share onto the others.

### What a charge does not touch

`cost_layers.cost_minor` — what was paid to the supplier, in the supplier's
currency. That is a fact about one invoice and stays one. Ocean freight is
billed in dollars against books kept in dong, and the two cannot be added.

The carrying amount that accumulates is the functional-currency one, which is
also the only one the ledger asserts anything about. See
[ADR 10](0010-multi-currency.md).

## Consequences

**Cost of goods sold changes for stock already on hand.** That is the point —
it becomes right. Stock already _issued_ keeps the cost it was posted at,
because postings are append-only and last month's margin is last month's.

**Charges are append-only and cannot be edited.** A wrong freight invoice is
corrected by a reversing charge, like everything else here.

**A shipment is optional.** Stock bought from a local quarry has no bill of
lading and needs none; `cost_layers.shipment_id` is nullable and every lot that
predates this has none.

## Alternatives considered

**Recomputing every lot's cost from its charges on read.** Attractive: the
carrying amount would always be derivable and never drift. Rejected because the
cost of goods sold _posted_ to the ledger would then disagree with a recomputed
carrying amount the moment a charge arrived late, and there is no way to
reconcile the two without either rewriting posted entries or maintaining the
difference anyway. Storing the adjustment, and posting the part that cannot be
stored, keeps one number.

**Allocating only to lots with stock left, and refusing late invoices
otherwise.** Simpler, and wrong often enough to be useless: late freight
invoices are the normal case, not the exception.

**A "landed cost" account that stock is transferred through.** How some systems
stage it. Rejected as an extra hop with no extra guarantee — the clearing
account's balance is only ever zero or an error, and this model makes the error
unrepresentable instead.

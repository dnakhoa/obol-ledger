# 16. Consumption tax is three mechanisms wearing one name

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

Every market this ledger ships a chart of accounts for taxes consumption, and
a naive reading makes them look alike: a percentage, an account, a return.
They are not alike, and modelling them as one rate with one account is wrong in
a way that only surfaces when somebody tries to file — by which point a quarter
of the entries are wrong and there is no way to tell which.

**Value added tax.** Vietnam's GTGT, Japan's 消費税, GST in Australia and New
Zealand, VAT across the EU. Tax charged on a sale is owed to the state; tax
paid on a purchase is reclaimable from it; what is remitted is the difference.
Two accounts, and the return is the net of them.

**Reverse charge.** The EU's answer to cross-border business-to-business
supply. The seller charges nothing and the _buyer_ accounts for both sides of
the same tax — output tax owed and input tax reclaimable, identical amounts,
netting to nothing. It is emphatically not "no tax": both entries appear on the
return, and a system that posts neither cannot produce one.

**Sales tax.** The United States. Collected from the customer and remitted; tax
paid on a purchase is **never reclaimable** and is simply part of what the thing
cost.

That last one is the dangerous case, and it is dangerous because double entry
cannot catch it. Give a US business an input-tax account and it accumulates a
receivable from a state that does not owe it. Every entry balances. The trial
balance is clean. The asset is fictional and nothing in the ledger will ever
say so.

## Decision

A **tax code** carries a rate in basis points, a treatment, and up to two
accounts. The treatment decides which side gets a posting at all.

| Treatment        | On a sale                           | On a purchase                     |
| ---------------- | ----------------------------------- | --------------------------------- |
| `vat`            | Credit output tax                   | Debit input tax                   |
| `reverse_charge` | Nothing — the buyer accounts for it | Debit input **and** credit output |
| `sales_tax`      | Credit output tax                   | Nothing — it is part of the cost  |

The caller supplies the net legs and the treatment adds the tax ones. Asking
the caller to work them out would put the decision in the place where it is
most often got wrong, and the resulting entry would balance either way.

### The asymmetry is a constraint, not a convention

```sql
WHEN 'sales_tax' THEN input_account_id IS NULL AND output_account_id IS NOT NULL
```

This is the same technique as Thông tư 200's digit rule and the LIFO
restriction: where a jurisdiction's law makes a state wrong, the state is made
unrepresentable rather than discouraged. Migration 0016 already ships the US
chart of accounts with a sales-tax payable and deliberately no input-tax asset;
this makes that structural rather than a property of the seed data.

### Rates are basis points

10% is `1000`, 8.25% is `825`. A percentage that has to survive a
multiplication against money has no business being a float, and 8.25% is a real
rate in a real US county rather than a contrived example.

### Tax-inclusive prices split exactly

Prices are quoted gross in Vietnam and Japan. The net is rounded and the tax
takes the remainder, so the two always add back to the price on the invoice.
Rounding both independently leaves a dong that reconciles to nothing — the same
discipline as [ADR 15](0015-landed-cost.md)'s apportionment and
[ADR 13](0013-inventory-costing.md)'s cost layers.

## Consequences

**A tax code cannot be edited into an illegal shape**, because the `CHECK`
applies to updates as well as inserts.

**Filing is not implemented.** The postings a return is built from now exist
and are correctly separated; turning them into a jurisdiction's form is a
different piece of work with a different shape for every jurisdiction, and
pretending otherwise would be the same mistake as one rate with one account.

**Partial exemption is not modelled.** A business making both taxable and
exempt supplies can reclaim only a proportion of its input tax, and the
proportion is computed annually by a method the revenue authority approves.
That is a real gap, recorded here rather than discovered.

## Alternatives considered

**A rate on the account.** Simpler, and unable to express reverse charge at all
— which needs two accounts moved by one supply.

**A boolean `reclaimable` instead of a treatment.** Covers VAT and sales tax
and still cannot express reverse charge, which is reclaimable _and_ payable
simultaneously. Three cases need three names.

**Computing tax at reporting time from account codes.** Rejected for the reason
the whole project exists: it makes the figure a derivation over data that was
never constrained, so an entry posted without its tax line is indistinguishable
from one that legitimately had none.

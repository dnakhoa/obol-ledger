# 17. A tax return is a journal entry

Date: 2026-09-21

## Status

Accepted. Extends [16, consumption tax](0016-consumption-tax.md).

## Context

ADR 16 made the three consumption-tax mechanisms postable — VAT, reverse
charge and US sales tax each produce the legs their mechanism calls for, and
the entry balances whichever one it was. That left the period end unbuilt.
Tax accrues into two accounts, and at some point somebody has to say what the
business owes and pay it.

The obvious shape is a report: total the tax accounts over a date range, print
the figure, let the accountant type it into HTKK or e-Tax. It is what most
small packages do, and it has three problems that only show up in the second
period.

**The accounts keep accruing.** The output-tax account does not reset when
March ends. On 1 April it holds March's unpaid tax plus whatever April has
charged so far, and its balance answers neither "what do I owe" nor "what have
I accrued". Every business that works this way keeps the answer somewhere else
— which in our users' case is the spreadsheet we are trying to replace.

**An unused credit lives on a form.** When input tax exceeds output tax, most
systems do not refund the difference; they carry it forward. Vietnam's 01/GTGT
calls it chỉ tiêu 22 on the way in and 43 on the way out, and Japan and the EU
have the same mechanism under other names. If the return is only a report,
that number exists nowhere in the books: the next period has to be told it,
and telling it wrong is undetectable.

**Nothing says which period a figure belonged to.** Two returns covering the
same month, or a quarter filed over a month already filed, are ordinary
mistakes with no natural defence.

## Decision

**Filing posts an entry.**

```
Dr  Output tax        the whole of it
  Cr  Input tax       at most the output, never more
  Cr  Tax payable     the difference
```

The middle line is the one that does the work. Crediting the input account by
_at most_ the output leaves any excess sitting in it — and that remainder is
the credit carried forward. It is not remembered, not re-keyed, not stored as
a number somebody has to trust: it is a balance on an asset account, because
that is what an unused input credit is. The next return finds it already
there.

The payable moves to an account with the `tax_payable` role, separate from the
two that accrue. So "what do I owe" is one balance in one place, and the
output-tax account is free to start accruing the next period from zero without
the two getting mixed.

**Some returns move nothing.** A period that only bought has no output tax, so
there is nothing to debit and crediting the input account would be claiming a
refund the tenant is not getting. That return has no entry at all — but it is
still a return. It claims its months and it sets the figure the next one opens
with. `tax_returns.transaction_id` is nullable for exactly this case; refusing
it would make the chain unfileable after any quiet quarter.

**A month belongs to one return.** Not a date-range overlap check, and not an
exclusion constraint — `btree_gist` is unavailable in PGlite, which is what the
tests run on, and a constraint that cannot be tested is a constraint nobody
knows is working. Instead `tax_return_months` holds one row per month covered,
with `UNIQUE (org_id, period_month)`. A second return over any of those months
has nowhere to exist. It is a plain btree index, it needs no extension, and it
makes monthly and quarterly filing the same table: a quarter is a return that
owns three months.

**Returns are filed in order.** Filing April while March is unfiled would
strand March's credit — April's opening figure would silently be zero when it
should not be. So the service refuses, and says which period is missing.

**What tax an entry attracted is recorded when it is posted.** `tax_entries`
carries `(transaction_id, tax_code_id, supply, base, tax)`. Without it a return
could only be derived from account balances, which cannot say which rate or
which mechanism produced them — and every form asks exactly that. The split is
derivable at posting time and unrecoverable afterwards, so it is written at
posting time.

Two details of that table earned themselves:

- **Grouped by tax code, not by rate.** A domestic 10% sale and a 10% reverse
  charge are both 10% and belong on different lines of the form.
- **A reverse charge writes two rows**, one per side. The buyer accounts for
  the tax as if it had made the sale itself, so the acquisition appears on
  both halves of the return and nets to nothing. One row would report the
  input credit and quietly drop the output tax that justifies it.

**A filed return is append-only.** `tax_returns` and `tax_entries` both carry
the rejection trigger. A return is evidence; correcting one is an amended
return, which is a new row and a new entry.

## Consequences

The chain is checkable on a single row, so the database enforces it:

```sql
CHECK (output = input + brought_forward - carried_forward + payable)
CHECK (payable = 0 OR carried_forward = 0)
```

The second says a return either pays something or carries something on, never
both — they are the two halves of one subtraction, and a row with both non-zero
is a row where the arithmetic ran twice.

Adding the `tax_payable` role meant adding a value to the `account_role` enum,
which collided with a Postgres rule worth recording: a transaction may not
_use_ an enum value it added, and the migrator runs every pending migration in
one transaction. Written as an enum literal, migration 0025 would have applied
cleanly to any database that already had the value and failed only on a fresh
clone. Comparing `role::text` in the CHECK avoids materialising the value.
The index could not use the same trick — an enum-to-text cast is `STABLE`, not
`IMMUTABLE`, and Postgres rejects it in an index predicate — so the two
per-role partial indexes were replaced by one `UNIQUE (org_id, role) WHERE role
IS NOT NULL`, which names no value at all and covers every role that will ever
be added.

### What this does not do

**Partial exemption.** A business making both taxable and exempt supplies may
reclaim only a proportion of its input tax. The apportionment primitive is
already here (`lib/apportion.ts`) and the proportion is a policy per
jurisdiction; the model has room for it but does not implement it.

**Jurisdiction-specific output.** No HTKK XML, no e-Tax file, no Form ST-1.
The figures are the same figures those forms want, and generating any of them
is a rendering problem rather than a modelling one — but each is a
jurisdiction's file format with its own release schedule, and shipping one
badly is worse than not shipping it.

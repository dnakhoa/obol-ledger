# 19. What is owed ages from when it falls due

- **Status**: Accepted
- **Date**: 2026-09-24

## Context

The aged report counted each open item's age from its invoice date and
bucketed it: up to 30 days, 31–60, 61–90, over 90. That quietly assumed every
customer was on thirty-day terms.

A distributor selling to builders typically is not. On sixty-day terms an
invoice forty days old is not late, yet the report filed it under "31–60 days"
beside the ones that were. A column that is mostly noise is a column the reader
learns to ignore — and it is the column that tells them who to call.

## Decision

Lateness counts from a **due date**, found in this order:

1. **The invoice's own**, from `metadata.dueDate`. Every sale records one
   ([ADR 18](0018-sales-and-margin.md)); a hand-typed entry may.
2. **The account's payment terms** — `accounts.payment_terms_days`, allowed only
   on an open-item account, from 0 (payment on receipt) to 365.
3. **Thirty days**, when neither says. That is what the report assumed before,
   so an undated invoice lands exactly where it used to, under a label that now
   says what it meant: 45 days old was "31–60", and is now "1–30 days late".

The buckets are _not yet due_, then 1–30, 31–60, 61–90 and over 90 days late.
An invoice is not late on the day it falls due.

A sale with no due date takes the customer's terms **and writes the date down**.
Changing a customer to sixty days must not make last year's invoices
retrospectively on time; the terms in force when the invoice was raised are
part of the invoice.

## Consequences

**The overdue share changes meaning slightly.** It was "past thirty days"; it
is now "past due". For an account with no terms set the two are the same.

**Settlement is still oldest-first.** Nothing records which invoice a payment
cleared, so a receipt still settles the oldest open item, and the report still
says so. Settling by due date instead was considered and rejected: with mixed
terms it would have a payment skip an older invoice for a newer one due sooner,
which no customer means.

**Opening a customer account became possible from the dashboard.** The form
had no way to mark an account as open items, so a receivable opened there never
appeared in this report at all. It does now, with its terms beside it.

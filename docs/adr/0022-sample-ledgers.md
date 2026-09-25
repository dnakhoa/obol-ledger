# 22. A prospect gets a writable copy of the sample books

- **Status**: Accepted
- **Date**: 2026-09-24

## Context

The published demo is read-only, which is right: it is one tenant everyone
shares, and a demo anyone can change is a demo that is wrong by lunchtime.
It also meant a prospect sent a link could look at invoices and credit notes
but not raise one. Trying anything needed an account; an account needed a
configured OAuth provider and a click-through; and the account then opened an
empty ledger, which shows nothing about a product whose value is what it does
with a quarter of real trading.

The people this is for — owners and accountants of importers and distributors
in Australia, New Zealand, Vietnam and Japan, shown the product on a call —
decide in the first few minutes whether it is worth their time. A sign-up wall
followed by an empty screen is where most of them stop.

## Decision

**"Try it with sample data" gives a visitor their own ledger, filled with the
sample company's quarter, in one click and with no sign-up.**

1. **An anonymous session.** better-auth's anonymous plugin signs the visitor
   in with no identity behind it. From there they are an ordinary member of an
   ordinary organisation: row-level security, the write guard and every rule in
   the database apply exactly as for a paying customer. There is no "sandbox
   mode" to keep in step with the real one.
2. **The same books as the demo.** `populateSampleLedger` is the seed's own
   body, moved into `src/server/services` and run through the services under
   the tenant's policies — as the application's restricted role, not the owner.
   One definition of the sample company, so what a prospect edits is what the
   README describes. It takes about a second locally and a few on a hosted
   database; the button says what it is doing.
3. **Kept if they sign in.** When an anonymous visitor then signs in with a
   provider, their sample ledger moves to that account — unless the account
   already has books, in which case those win. A real ledger is never replaced
   by a demo.
4. **Rate-limited per address**, three a minute through the shared Postgres
   limiter, because each click writes a quarter of books.

## Consequences

**Sample ledgers accumulate.** Nothing deletes an abandoned one yet, and
deleting a tenant means removing rows that are append-only by trigger — which
needs the owner role and a deliberate procedure, not an application path. At
the volume of a first round of prospects this is rows, not a problem; before
the link is public it needs a scheduled job that removes anonymous users older
than a set age together with their organisations.

**The sign-in page leads with trying, not signing in.** Signing in is for
someone who has decided; the page is mostly visited by people who have not.

**The demo stays read-only**, and its refusal now points at the sample ledger
instead of at a sign-in the deployment may not offer.

## Considered and rejected

- **Letting anyone write to the published demo.** Shared state that strangers
  edit is wrong within the hour, and resetting it on a timer means a prospect's
  work vanishes mid-demo.
- **An empty ledger with a guided tour.** Shows the forms, not what the ledger
  does with a quarter of trading — which is the whole argument.
- **Email magic links.** Better than OAuth for a business audience, and still a
  step before anything is visible; worth adding for keeping a ledger, not for
  trying one.

# 8. Model authorisation and settlement as two phases

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

Money is authorised before it settles. A card hold, an ACH in flight, an escrow
release pending a condition — in each case the funds are spoken for but have
not moved.

A ledger with a single balance cannot represent that, so the application
invents it somewhere else: a `reserved_funds` table, a Redis key, a status
column on an order. All of them share the same defect — nothing reconciles the
invented state against the balances, so they drift, and the drift is discovered
when a customer overdraws.

The specific failure is concrete. Two withdrawal authorisations arrive against
an account holding 1,000. Each checks the balance, sees 1,000, and succeeds.
Both later settle. The account is overdrawn by the amount of the smaller one,
and the overdraft constraint never fired because at the moment each was checked
the money really was there.

## Decision

An entry has a status — `pending`, `posted`, `archived` — and an account has
three balances rather than one.

| balance     | meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `posted`    | settled entries only. What is actually there.                  |
| `pending`   | settled plus in-flight. What it becomes if everything lands.   |
| `available` | settled minus in-flight **outflows**. What can still be spent. |

**The overdraft rule consults `available`.** That is the whole point: an
authorisation reserves its funds the moment it is made, so the second of two
concurrent withdrawals sees them already gone.

### Why pending is two columns, not one signed number

`pending_inflow_minor` and `pending_outflow_minor` are tracked separately,
in presented terms, because `available` subtracts only the outflows.

Netting them into one figure would let an unsettled _deposit_ fund an unsettled
_withdrawal_ — money that has not arrived paying for money that is leaving.
Two columns make that arithmetically impossible rather than merely discouraged.
The direction depends on the account class, so the trigger resolves it once via
`obol_presented_sign` and every consumer reads plain non-negative totals.

### Immutability gets exactly one carve-out

Migration 0001 made `transactions` reject every `UPDATE`. A status transition
is an update, so the rule needed a hole — and a hole in an immutability
guarantee is worth being precise about.

A **pending entry is not yet history**: it is a proposal, and proposals get
settled or cancelled. So `obol_guard_transaction_mutation` permits exactly one
change — the status of a pending row moving to `posted` or `archived` — and
refuses everything else, including any edit to the description, currency or
dates _while pending_. `postings` remain absolutely immutable: an entry's
amounts are fixed the moment it is written, whatever happens to its status.

### Settling re-checks the overdraft rule

Funds available at authorisation can be gone by settlement if something else
drained the account first. Trusting the earlier check would overdraw silently,
at the worst possible moment. A reservation is a claim on funds, not a
guarantee of them.

## Consequences

- **Statements list pending entries separately**, above the settled ledger, the
  way a bank does. Interleaving them would produce a running balance that
  reconciles with neither the posted nor the available figure shown beside it —
  a bug the UI surfaced immediately once the feature existed.
- **Reports count settled entries only.** A trial balance or a balance sheet
  that included in-flight money would show value that does not exist.
- **Archiving is not reversal.** Archiving cancels money that never moved, so
  nothing is mirrored; a reversal cancels money that _did_ move by posting an
  opposite entry. Conflating them would put phantom entries in the journal.
- `accounts.version` is incremented on every balance change, which gives
  callers optimistic concurrency: read a balance, decide on it, and submit with
  `expectedVersions` so the write is refused if the account moved underneath.
  The alternative is holding a lock across a network round trip.
- A timestamp-normalising trigger fills `posted_at`/`archived_at` from the
  status, so a plain `INSERT` still works. Requiring both would have been a
  trap for hand-written SQL and would have broken every statement written
  before this migration.

# What a real ledger API has, and what this has

Obol is a non-commercial project, not a product with customers. That makes it
easy to accidentally build a demo — something that looks right in a screenshot
and falls apart the moment anyone asks it a second question. The defence is to
measure it against the systems it is imitating and to be specific about where
it stops.

This document is written for someone who could tell. If you work in accounting
or finance systems, the useful thing you can do with twenty minutes here is
find the place where the model stops matching how you actually work — and the
list below is meant to make that quick rather than to flatter the project.

The comparison is against **Modern Treasury Ledgers** and **Increase** for the
ledger primitives, and against **Xero** and **MYOB** for what a practitioner
expects a set of books to have.

## Present, and to the same standard

| Capability                                 | Notes                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Double-entry with an enforced balance rule | A `DEFERRABLE INITIALLY DEFERRED` constraint trigger, so it holds against `psql` too, not only against the application                                                      |
| Signed, debit-positive postings            | One representation; presentation flips by account class                                                                                                                     |
| Money as integer minor units               | Strings on the wire — a JSON number has already lost the cent                                                                                                               |
| Pending / posted / archived entries        | Three balances, and the overdraft rule consults _available_                                                                                                                 |
| Immutable history, reversals               | `UPDATE`/`DELETE` rejected at the table; a partial unique index allows one reversal per entry                                                                               |
| **Multi-currency entries**                 | An entry balances in the organisation's functional currency; each posting keeps what moved _and_ what it was worth. [ADR 10](adr/0010-multi-currency.md)                    |
| **Realized FX gain and loss**              | Absorbed into a designated account, and only when each transaction currency already balances — so the adjustment cannot hide a typo                                         |
| **Unrealized FX revaluation**              | IAS 21 remeasurement of foreign monetary balances at the closing rate; inventory and fixed assets stay at historical rate                                                   |
| **Period close**                           | Locks the month and zeroes revenue and expense into retained earnings. The lock is a trigger, because back-dating arrives through import scripts that never see the service |
| **Account codes and chart templates**      | Generic, AU/NZ and Thông tư 200. Under a statutory chart the leading digit must agree with the account type, and the database enforces it                                   |
| Financial statements                       | Trial balance, balance sheet, income statement, from the same postings                                                                                                      |
| Metadata on accounts and entries           | `GIN (metadata jsonb_path_ops)`; the containment lookup is 33× the `->>` form most people write first, with plans in [benchmarks](benchmarks.md)                            |
| CSV export                                 | Streamed, RFC 4180, UTF-8 BOM, and cells beginning `=` neutralised against spreadsheet formula injection                                                                    |
| Idempotency keys                           | Claim-first, fingerprinted over the canonicalised body                                                                                                                      |
| Cursor pagination                          | Keyset, bidirectional. 25 rows and 6 buffers at page 5,000, against 125,025 rows and 3,015 buffers for `OFFSET`                                                             |
| Optimistic concurrency                     | `version` per account, checked on write                                                                                                                                     |
| Multi-tenancy                              | `FORCE`d row-level security, plus a runtime probe that the connection is actually subject to it                                                                             |
| **Accounts and sign-in**                   | OAuth only. Authorisation is a membership row the policies key off, not the auth library's own organisation model                                                           |
| Rate limiting across instances             | Sliding window counted in Postgres, with the in-process window kept as a pre-check that can only reject                                                                     |
| Webhooks                                   | Transactional outbox, Standard Webhooks signatures, backoff with jitter, circuit breaker, delivery log                                                                      |
| API key management                         | Digest-stored, scannable prefix, revocation that keeps the row                                                                                                              |
| RFC 9457 problem responses                 | One table maps every domain error to a status                                                                                                                               |
| OpenAPI document                           | Generated from the same Zod schemas the routes validate with, and a test reads the routes off disk to prove nothing is undocumented                                         |
| Metrics and alerting                       | Prometheus text format; `obol_ledger_residual_minor` has exactly one correct value                                                                                          |

## Present here, absent there

Neither Modern Treasury nor Increase renders financial statements — they are
infrastructure, and the balance sheet belongs to whoever consumes them. Obol
produces a trial balance, a balance sheet and an income statement from the same
postings, because the point of the project is to show that the model is
complete enough to close a book with.

## Deliberately absent

| Capability                           | Why not                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Balance locks / settlement objects   | Modern Treasury's answer to a problem this solves with `available` and an overdraft `CHECK`. The shapes differ; the guarantee does not |
| SDKs                                 | The OpenAPI document generates them; hand-writing five is volume, not evidence                                                         |
| SOC 2, audit logging to a WORM store | Organisational, not architectural                                                                                                      |

## Not yet, and next

Named rather than omitted, because a gap a reader finds for themselves reads
as an oversight and a gap you have already written down reads as a plan.

| Capability                                           | Status                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Account codes and chart-of-accounts templates~~    | **Shipped.** Generic, AU/NZ, and Vietnam's Thông tư 200. A conventional chart's numbering is a starting point the tenant edits; a statutory one's is enforced by the database. [ADR 11](adr/0011-chart-of-accounts.md) |
| ~~Unrealized FX revaluation~~                        | **Shipped.** Foreign monetary balances retranslated at the closing rate, cumulative rather than reversing, and the period close refuses without it. [ADR 12](adr/0012-fx-revaluation.md)                               |
| **Consumption tax**                                  | GST/VAT with input credits, EU reverse charge, and US sales tax are three different mechanisms, and modelling them as one is wrong in a way that only surfaces when you try to produce a return                        |
| **Documents**                                        | The invoice, customs declaration and bill of lading attached to the entry they justify                                                                                                                                 |
| **Audit trail by user**                              | Who entered this. Cheap now that sessions exist                                                                                                                                                                        |
| **Invites and roles**                                | An organisation has exactly one member today                                                                                                                                                                           |
| **Ledger account categories (hierarchical rollups)** | A closure table and recursive balance rollups. Real at scale, and a different week of work                                                                                                                             |
| **Test mode / sandbox**                              | Meaningful when customers have production data to protect. Here the deployment _is_ the sandbox                                                                                                                        |

## Honest limitations

Things a reviewer should know without having to find them:

- **The demo tenant is readable by anyone and writable by nobody.** Signing in
  gives you your own ledger; the demo stays a demo. There is no invite flow
  yet, so an organisation has exactly one member.
- **DNS rebinding is open** in the webhook SSRF check. Closing it means pinning
  the resolved address into the connection, which Node's `fetch` does not
  expose.
- **Webhook secrets are stored in the clear.** Unavoidable for a shared signing
  key; the mitigations are rotation and encryption at rest, neither of which is
  implemented here.
- **One region, one database.** No read replicas, no failover story.

## The measure that matters

A ledger's job is to be right. Every claim above that could be false is a test:
the balance rule against real Postgres, isolation against a non-superuser role,
lock ordering against real concurrent connections, and `SKIP LOCKED` against
four workers at once — each verified by deleting the line it protects and
watching the suite fail.

# What a real ledger API has, and what this has

Obol is a portfolio project, not a product with customers. That makes it easy
to accidentally build a demo — something that looks right in a screenshot and
falls apart the moment anyone asks it a second question. The defence is to
measure it against the systems it is imitating and to be specific about where
it stops.

The comparison is against **Modern Treasury Ledgers** and **Increase**, the two
most credible hosted double-entry ledgers, plus **Stripe** for API conventions.

## Present, and to the same standard

| Capability                                 | Obol | Notes                                                                                                                              |
| ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Double-entry with an enforced balance rule | ✅   | Enforced by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, so it holds against `psql` too, not just against the application |
| Signed, debit-positive postings            | ✅   | One representation; presentation flips by account class                                                                            |
| Money as integer minor units               | ✅   | Strings on the wire — a JSON number has already lost the cent                                                                      |
| Pending / posted / archived entries        | ✅   | Three balances, and the overdraft rule consults _available_                                                                        |
| Immutable history, reversals               | ✅   | `UPDATE`/`DELETE` rejected at the table; a partial unique index allows one reversal per entry                                      |
| Idempotency keys                           | ✅   | Claim-first, fingerprinted over the canonicalised body                                                                             |
| Cursor pagination                          | ✅   | Keyset, bidirectional. 25 rows and 6 buffers at page 5,000, against 125,025 rows and 3,015 buffers for `OFFSET`                    |
| Optimistic concurrency                     | ✅   | `version` per account, checked on write                                                                                            |
| Multi-tenancy                              | ✅   | `FORCE`d row-level security, plus a runtime probe that the connection is actually subject to it                                    |
| Webhooks                                   | ✅   | Transactional outbox, Standard Webhooks signatures, backoff with jitter, circuit breaker, delivery log                             |
| API key management                         | ✅   | Digest-stored, scannable prefix, revocation that keeps the row                                                                     |
| RFC 9457 problem responses                 | ✅   | One table maps every domain error to a status                                                                                      |
| OpenAPI document                           | ✅   | Generated from the same Zod schemas the routes validate with                                                                       |
| Metrics and alerting                       | ✅   | Prometheus text format; `obol_ledger_residual_minor` has exactly one correct value                                                 |

## Present here, absent there

Neither Modern Treasury nor Increase renders financial statements — they are
infrastructure, and the balance sheet belongs to whoever consumes them. Obol
produces a trial balance, a balance sheet and an income statement from the same
postings, because the point of the project is to show that the model is
complete enough to close a book with.

## Deliberately absent

| Capability                                       | Why not                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger account categories (hierarchical rollups) | Real need at scale; a closure table and recursive balance rollups are a week of work whose interesting decisions are all in the _first_ week — which this project already spent on the balance model             |
| Balance locks / settlement objects               | Modern Treasury's answer to a problem this solves with `available` and an overdraft `CHECK`. The shapes differ; the guarantee does not                                                                           |
| Multi-currency entries in one transaction        | Requires an FX rate model and a rounding policy with real consequences. The composite foreign key makes single-currency entries _unrepresentable_ otherwise, which is a deliberate floor rather than an omission |
| Test mode / sandbox                              | Meaningful when customers have production data to protect. Here the deployment _is_ the sandbox                                                                                                                  |
| SDKs                                             | The OpenAPI document generates them; hand-writing five is volume, not evidence                                                                                                                                   |
| SOC 2, audit logging to a WORM store             | Organisational, not architectural                                                                                                                                                                                |

## Honest limitations

Things a reviewer should know without having to find them:

- **The demo tenant accepts unauthenticated writes** through the dashboard's
  server actions. That is a deliberate choice so the deployment is explorable,
  not an authorisation model to copy.
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

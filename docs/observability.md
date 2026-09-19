# Observability

Three signals, each answering a different question. The distinction matters
because a system that emits all three but cannot answer any of them is
instrumented, not operable.

| Signal          | Answers                                                          | Where                                 |
| --------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Structured logs | _What happened to this one request?_                             | `src/server/observability/logger.ts`  |
| Traces          | _Where did the time go, and which invariant was being enforced?_ | `src/server/observability/tracing.ts` |
| Metrics         | _Is the ledger still internally consistent?_                     | `GET /api/v1/metrics`                 |

## Logs

Every request gets a correlation id — the inbound `x-request-id` if the caller
supplied one, a fresh UUID otherwise — and it is echoed on the response. A
caller who reports a problem can quote the id from their own logs, and it
resolves to a single request here without a timestamp-range search.

Logs are JSON, one object per line, because Vercel's log drain parses that and
does not parse prose. Field names are stable: `event`, `route`, `requestId`,
`status`, `durationMs`.

Nothing that identifies a person or authenticates a caller is ever logged.
Bearer tokens are stored and compared as SHA-256 digests and never appear in
a log line.

## Traces

`@vercel/otel` instruments HTTP and Postgres automatically, which tells you a
request was slow and which query it was waiting on. That is necessary and not
sufficient: in a ledger the interesting question is usually not _which query_
but _which rule_. `traced()` wraps the domain operations so a span carries the
business context — currency, posting count, whether the write was an
idempotent replay, and the outcome.

The deliberate choice is in `recordOutcome()`. A rejected entry — unbalanced,
overdrawn, a bad state transition — is a span with `status = OK` and an
`outcome` attribute of `rejected`. The system worked exactly as designed. If
refusals were recorded as span errors, every error budget and alert threshold
would be dominated by the ledger correctly doing its job, and the one real
failure in the noise would be invisible. Errors are reserved for the
unexpected.

## Metrics

`GET /api/v1/metrics` returns Prometheus text format (`text/plain; version=0.0.4`).
It is unauthenticated and exposes only aggregates for the demo tenant — no
amounts attributable to a counterparty, no identifiers.

| Metric                                         | Meaning                                                   |
| ---------------------------------------------- | --------------------------------------------------------- |
| `obol_ledger_residual_minor{currency}`         | Signed sum of every account balance                       |
| `obol_ledger_reserved_outflow_minor{currency}` | Funds held by pending entries                             |
| `obol_ledger_entries{status}`                  | Journal entries by lifecycle status                       |
| `obol_ledger_accounts`                         | Open accounts                                             |
| `obol_ledger_postings`                         | Postings written                                          |
| `obol_tenant_isolation_enforced`               | 1 if row-level security applies to the running connection |

### What to page on

Two alerts. Both are correctness, not performance — a ledger that is slow is
an inconvenience, and a ledger that is wrong is a liability.

```yaml
- alert: LedgerOutOfBalance
  expr: obol_ledger_residual_minor != 0
  for: 1m
  severity: page
  annotations:
    summary: 'Account balances no longer sum to zero in {{ $labels.currency }}'
    runbook: |
      Every posting nets to zero, so the cached balances must too. A non-zero
      residual means the cached balances have stopped agreeing with the
      postings that justify them — every figure the system reports is now
      suspect. Stop writes. Recompute from `postings` (the source of truth;
      `accounts.balance_minor` is a cache maintained by a trigger) and diff.

- alert: TenantIsolationNotEnforced
  expr: obol_tenant_isolation_enforced == 0
  for: 1m
  severity: page
  annotations:
    summary: 'RLS policies are not constraining the application connection'
    runbook: |
      The app is connected as a role with BYPASSRLS or SUPERUSER, so every
      tenant policy is silently inert and cross-tenant reads are possible.
      This is not hypothetical — Neon's `neondb_owner` has `rolbypassrls`,
      and this exact condition shipped to production once. Run
      `pnpm db:provision-role` and point `APP_DATABASE_URL` at `obol_app`.
```

A third alert is worth a ticket rather than a page:

```yaml
- alert: WebhookQueueNotDraining
  expr: min_over_time(obol_webhook_deliveries{status="pending"}[30m]) > 100
  for: 30m
  severity: ticket
  annotations:
    summary: 'The webhook outbox is growing and not draining'
    runbook: |
      Either the scheduled dispatcher has stopped, or every subscriber is
      failing at once. Check that the cron is firing, then hit
      POST /api/v1/webhooks/dispatch by hand and read what it returns —
      claimed with nothing succeeded points at the subscribers, claimed
      zero with a non-zero queue points at the schedule or at endpoints
      disabled by the circuit breaker.
```

`obol_ledger_residual_minor` is the metric worth the endpoint. Most gauges have
a band of acceptable values and a threshold someone guessed at. This one has
exactly one correct value, forever, in every currency: zero. It cannot produce
a false positive from a traffic spike or a slow dependency, which makes it the
rare alert that deserves to wake a person at 3am.

Liveness is separate: `GET /api/v1/health` checks database reachability,
migration state, and RLS enforcement, and is what a load balancer should poll.

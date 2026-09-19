# 9. Webhooks are written to a transactional outbox, not sent after commit

- **Status**: Accepted
- **Date**: 2026-09-20

## Context

A ledger nobody can subscribe to is a database with a web page in front of it.
Every real one — Stripe, Increase, Modern Treasury — pushes events, because the
alternative is every integrator polling, which is slower and more expensive for
both sides.

The hard part is not the HTTP request. It is that the announcement must agree
with the ledger, and the obvious implementation guarantees that it sometimes
will not:

```ts
await db.transaction(async (tx) => {
  await writeEntry(tx, input);
});
await notifySubscribers(entry); // ← everything after COMMIT is a gamble
```

If the process dies between the two lines, the entry is durable and the
announcement never happens. Worse, the failure is silent on both ends: this
side believes it published, and the subscriber cannot notice the absence of a
message it was never told to expect. Reconciliation catches it eventually,
which is a polite way of saying a person notices weeks later.

Swapping the order is not better. Announcing first and committing second means
a subscriber can act on an entry that then rolls back, which is worse — money
that never moved, reported as moved.

## Decision

Delivery rows are written **inside** the same transaction as the ledger change
that causes them. `enqueue` takes the transaction handle, not the database:

```ts
await enqueue(tx, orgId, { type: 'entry.posted', data: { entry } });
```

Either both are durable or neither is. That inverts the failure mode into one
the receiver can survive: deliveries become at-least-once rather than
at-most-once. A duplicate is possible; a silent omission is not. Every delivery
carries a stable `event_id` so the receiver can deduplicate, and that is
documented as part of the contract rather than left as a surprise.

A scheduled worker drains the queue. Three details are load-bearing:

**Rows are claimed, not read.** `FOR UPDATE SKIP LOCKED` inside a transaction
that flips the row to `delivering`. Two workers — or the same cron firing again
because the last run was slow — take disjoint sets instead of both sending the
same webhook.

Mutation testing pinned down which half of that clause does what, and the split
is not the obvious one. Deleting `FOR UPDATE ... SKIP LOCKED` entirely still
produces no duplicates: under READ COMMITTED the second worker's `UPDATE`
blocks on the row lock, re-evaluates its predicate against the new row version,
finds `status = 'delivering'` with a lease in the future, and skips the row.
Correctness comes from the predicate. What `SKIP LOCKED` buys is throughput —
without it the workers queue behind the same rows and one takes the entire
batch while the others come back empty. `tests/concurrency/webhook-claim.test.ts`
has one test for each half, and only the throughput one fails when the clause
is removed.

**The claim is a lease, not a flag.** A worker killed mid-flight would strand
rows in `delivering` forever if the flag were permanent. The claim also
reclaims rows whose lease has expired, so a crash costs one duplicate delivery
rather than a permanently stalled queue.

**The HTTP call happens outside the claim transaction.** Holding a database
transaction open across a request to a stranger's server lets a subscriber that
accepts connections and never responds pin a connection and a row lock for as
long as it likes.

## Consequences

**Fan-out happens at write time**, so the payload is stored once per endpoint
rather than once per event. That costs storage and buys three things: an
endpoint registered later never receives history it was not subscribed to, a
single endpoint can be retried or replayed without touching the others, and the
claim query needs no join to decide what is due. For a tenant with hundreds of
endpoints the trade would flip, and the fix is a payload table with deliveries
referencing it — a change to one INSERT.

**Delivery is decoupled from the write path**, so an entry commits in
single-digit milliseconds whether or not the subscriber is awake. The cost is
latency: an event is announced when the worker next runs.

**Retries use exponential backoff with full jitter**, not a fixed schedule.
Deliveries are created in bursts — one entry fans out to every endpoint at once
— so a deterministic delay would retry them in a synchronised wave and hit a
recovering subscriber with the same herd that knocked it over.

**4xx is not retried**, except 408, 425 and 429. A 404 endpoint will still be a
404 in six hours; retrying it for a day wastes both sides' budget and buries
the real failures.

**Endpoints are disabled after a sustained run of failures.** A subscriber that
has been gone for days should not hold a retry budget forever. A success resets
the counter, so an endpoint that fails twice a month is never disabled.

**Replay creates a new row rather than resetting the old one.** The log is
evidence — "we attempted five times and your server returned 502" answers a
dispute — and mutating it in place to try again destroys exactly the record
worth keeping.

## Security

**Signatures follow the Standard Webhooks specification** rather than a bespoke
scheme, so subscribers can use an existing library. The signed content is
`{id}.{timestamp}.{payload}`: signing the timestamp is what stops a captured
delivery being replayed forever, and signing the id binds the signature to one
delivery. Comparison is constant-time.

**The signing secret is stored in the clear**, unlike an API key. An API key is
a bearer credential — the server only needs to recognise one, so a digest
suffices. A webhook secret is a shared symmetric key this side must reproduce
on every delivery in order to sign; there is no digest that can be signed with.
The honest mitigations are rotation and encryption at rest, not a hash that
would make the feature impossible. The secret is returned once, at creation,
and never readable again.

**Targets are checked against the private network.** A webhook endpoint is a
URL a caller chooses and this server then fetches from inside the trust
boundary — unguarded, that is a general-purpose SSRF proxy, and
`http://169.254.169.254/latest/meta-data/` returns cloud credentials into the
delivery log. Both the literal host and its resolved addresses are checked,
because `evil.example.com` is free to have an A record of `127.0.0.1`. DNS
rebinding remains theoretically open: closing it needs the resolved address
pinned into the connection, which Node's `fetch` does not expose.

## Alternatives considered

**A message broker (SQS, Kafka, Queues).** The same gap, moved: publishing to a
broker after COMMIT has exactly the failure this decision exists to remove.
Doing it properly still means an outbox — with the broker as the thing the
worker drains into. A broker earns its place at a throughput this does not have.

**Polling instead of pushing.** No delivery problem at all, which is genuinely
appealing. But it pushes the cost onto every integrator, and a subscriber that
polls every minute is a subscriber that learns about a payment up to a minute
late while generating a constant query load for the 99% of minutes in which
nothing happened.

**Listen/notify.** `LISTEN` is not durable: a subscriber that is disconnected
when the notification fires never learns it existed, which is the same silent
omission in a different costume.

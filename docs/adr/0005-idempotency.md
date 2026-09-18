# 5. Make writes idempotent with a claim-first key

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

A client that times out mid-request has no way to know whether the entry was
written. Retrying risks posting it twice; not retrying risks losing it. For a
ledger, posting twice is the worse failure — it is silent, and it corrupts the
books rather than merely omitting from them.

## Decision

Writes accept an optional `Idempotency-Key` header. The key and a fingerprint of
the request body are stored in `idempotency_keys`, alongside the response that
was produced.

The order of operations is the decision:

1. **Claim the key first**, with `INSERT ... ON CONFLICT DO NOTHING`, _before_
   doing any work — inside the same database transaction as the entry itself.
2. If the insert returned a row, the key is new: do the work, then write the
   response back against the key.
3. If it did not, the key exists. Compare fingerprints: identical means replay
   the stored response with a `200`; different means the client has reused a key
   for a different request, which is a bug on their side and is answered `409`.

Claiming first is what makes concurrent duplicates safe. A second request with
the same key blocks on the primary-key index until the first transaction settles,
rather than racing it — so the two cannot both decide the key is new.

Because the claim is inside the same transaction as the entry, a rejected entry
rolls the claim back with it. The key is then free, which is right: a request
that failed should be retryable with the same key.

The fingerprint is a SHA-256 over a **canonicalised** body — object keys sorted
recursively — so a client that serialises `{a,b}` on the first attempt and
`{b,a}` on the retry is not told its key was reused.

## Consequences

- Retries are safe without any coordination between client and server beyond one
  header.
- A duplicate arriving while the first is still in flight _blocks_ rather than
  failing fast. For a write this is the right trade: the caller waits, and gets
  the correct answer.
- Keys carry an `expires_at`. Reaping them is left to a scheduled job; the
  column and its index exist so that job is a `DELETE`, not a migration.

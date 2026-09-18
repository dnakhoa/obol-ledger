# 6. Paginate on `(occurredAt, id)`, never with OFFSET

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

`LIMIT 20 OFFSET 10000` makes Postgres walk and discard ten thousand rows.
Page 500 costs five hundred times page 1, and the query plan gets worse exactly
as the data set becomes worth paginating.

The subtler problem is correctness. Offsets are positions in a result set that
is still being written to. An entry posted between two page loads shifts every
subsequent page by one, so a reader paging through the journal sees an entry
twice, or never sees it at all.

## Decision

Seek on the last row's sort key.

The sort key is `(occurredAt, id)`, not `id` alone. Ids are ULIDs, so ordering by
id is ordering by _recording_ time — which puts a back-dated invoice recorded
today at the top of the journal, where no reader expects it. Ordering by
`occurredAt` alone is not a total order, because two entries can share a
timestamp, and a cursor over a non-unique key can skip or repeat rows. The id
breaks the tie.

The predicate is a row-wise comparison:

```sql
WHERE (occurred_at, id) < ($1, $2)
ORDER BY occurred_at DESC, id DESC
```

Postgres satisfies this directly from the `(occurred_at, id)` index — one index
dive, no rewriting into an `OR` of two conditions.

Cursors are base64url of `<iso-timestamp>|<id>`: opaque enough that clients do
not start constructing them, readable enough to debug. A malformed cursor
decodes to `undefined` and yields the first page rather than throwing, because
cursors arrive from URLs and a stale bookmark should not be a 500.

An account statement uses the same key for its window function as for its sort.
If the running-balance window were ordered differently from the rows printed
beside it, the balance column would not reconcile — which is the one thing a
statement must never do.

## Consequences

- Page 500 costs what page 1 costs.
- Pages are stable while rows are being written.
- There is no "jump to page 17", because a keyset cursor only knows how to go
  forward or back one page. For a journal, that is the natural interaction
  anyway.

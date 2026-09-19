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

Paging backward is a **separate query**, not a reversal of the forward one: it
seeks with `>` in ascending order and the rows are flipped for display. A
forward cursor contains no information about what precedes it, so "previous"
cannot be derived from it — and a "Previous" link that quietly returns to page
one, which is the usual shortcut, is a lie about where it goes.

## Measured, not assumed

`pnpm benchmark` loads 200,000 entries and runs both queries at increasing
depth, writing the timings and the query plans to
[docs/benchmarks.md](../benchmarks.md). At page 5,000:

|          | rows read | buffers |     time |
| -------- | --------: | ------: | -------: |
| keyset   |        25 |       6 |  0.02 ms |
| `OFFSET` |   125,025 |   3,015 | 10.34 ms |

The timings are suggestive; the plans are the evidence. The keyset query shows
`Index Cond: (ROW(occurred_at, id) < ROW(...))` — Postgres descends the index
straight to the cursor. The `OFFSET` query fetches 125,025 rows to return 25,
which is the discarded work made visible.

A textbook claim is exactly the kind nobody checks, and an index that has
silently stopped being used turns the whole argument into decoration.

## Consequences

- Page 500 costs what page 1 costs.
- Pages are stable while rows are being written.
- The two directions are symmetric: walking forward to the end and back again
  visits exactly the same rows in reverse. That round trip is asserted against a
  real database, because an off-by-one in the backward cursor would silently
  skip or repeat an entry and no forward-only test would notice.
- The statement's running-balance window is ordered by the same key as the page,
  so a line shows the same balance however it was reached.
- There is no "jump to page 17". A keyset cursor knows only the row it names,
  which for a journal is the natural interaction anyway.

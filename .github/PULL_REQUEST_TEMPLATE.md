## What changes, and why

<!--
The decision, not the diff. If a trade-off was made, say what the other option
was and why it lost.
-->

## How it was verified

<!--
`pnpm verify` is the floor, not the answer. For anything concurrency- or
constraint-related: which line did you delete to confirm the test actually
fails without it?
-->

- [ ] `pnpm verify` passes
- [ ] A rule the database can enforce is enforced by the database
- [ ] Any new `/api/v1` route is in the OpenAPI document (a test checks this)
- [ ] Migrations are hand-written and ordered so a backfill runs before the
      trigger it would otherwise trip

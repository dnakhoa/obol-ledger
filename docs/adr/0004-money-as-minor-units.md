# 4. Represent money as integer minor units

- **Status**: Accepted
- **Date**: 2026-09-19

## Context

`0.1 + 0.2 !== 0.3` in IEEE-754. A ledger that loses a cent per thousand
postings is worthless, and the loss is silent — it shows up as a trial balance
that no longer nets to zero, long after the code that caused it shipped.

Floating point also fails at the boundary, not just in arithmetic: a JSON number
is a double, so `12.10` has already become `12.099999999999999` before a server
has the chance to be careful with it.

## Decision

Money is a `bigint` count of a currency's minor units, end to end: `bigint` in
TypeScript, `bigint` in Postgres, and a **string** on the wire.

Three details make this hold up:

- **A branded type.** `MinorUnits` is `bigint & { [brand]: 'MinorUnits' }`, so a
  row count or a length cannot be passed where money is expected. The brand costs
  nothing at runtime and is checked at compile time.
- **The exponent comes from a registry.** Not every currency has two decimal
  places — JPY has none, BHD has three. Hard-coding `* 100` is the second-most
  common money bug after floats, so parsing and formatting are driven by
  `CURRENCY_EXPONENTS` and `1.5 JPY` is rejected as having too much precision.
- **Amounts cross the API as decimal strings.** `"1234.56"` is exact; `1234.56`
  is not. Responses carry both `amount` (the decimal, readable) and `minorUnits`
  (the integer, lossless), so a client past 2^53 minor units is still correct.

The parser takes a string and never a `number`, because accepting a `number`
would mean the caller had already rounded and we would have no way to detect it.

## Consequences

- Every layer handles `bigint`, including the browser. The formatting helpers in
  `src/lib/format.ts` group digits as _text_ rather than converting, so the
  error cannot creep back in at the last step.
- Presentation is exact by construction: property tests assert that any storable
  amount round-trips through its string form unchanged, for every supported
  currency.
- Adding a currency is one line in the registry, and the zod enum that validates
  requests is derived from the same object — the two cannot drift apart.

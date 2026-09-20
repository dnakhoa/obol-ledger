-- Realized foreign exchange gain and loss.
--
-- You book a supplier invoice of 40,000 USD on 1 September at 25,400 dong to
-- the dollar, so the payable is worth 1,016,000,000 VND. On the 20th you pay
-- it, and the dollars now cost 25,700 — 1,028,000,000 VND. The liability that
-- left your books was worth twelve million dong less than the money you spent
-- clearing it.
--
-- That twelve million is not a rounding error and not a bookkeeping artefact.
-- It is a real loss, caused by holding an obligation in a currency that moved,
-- and it belongs on the income statement. An importer's margin lives or dies
-- on this number.
--
-- The settlement entry is an ordinary multi-currency entry whose base amounts
-- do not sum to zero — precisely because two different rates were applied to
-- the same dollar amount. A designated account absorbs the difference.
--
-- When that is safe is the whole question, and it has an exact answer: only
-- when the entry already balances *within every transaction currency*. If the
-- dollars net to zero and the dong net to zero, yet the functional amounts do
-- not, the only possible cause is a rate difference. A mistyped amount breaks
-- the per-currency balance and is still refused, so the plug cannot swallow a
-- typo. See `src/server/services/journal.ts`.

ALTER TYPE "public"."account_role" ADD VALUE 'fx_gain_loss';

-- The constraints that go with this value live in the next migration, and not
-- for tidiness. Postgres will not let a newly added enum value be *used* in
-- the transaction that added it — the migrator wraps each file in one, so a
-- CHECK referencing 'fx_gain_loss' here fails with "unsafe use of new value".

-- Constraints for the fx_gain_loss role, in their own migration because the
-- enum value added in 0011 cannot be used in the transaction that created it.
--
-- A separate file is not enough on its own, which is why the comparisons below
-- are made as text. The migrator applies every *pending* migration in one
-- transaction, so on a fresh database 0011 and this file share one — and
-- `role = 'fx_gain_loss'` materialises the enum value 0011 just added, which
-- Postgres refuses as "unsafe use of new value". It passed everywhere a
-- database already had 0011, and failed `pnpm db:migrate` on every new clone.
-- Comparing `role::text` never materialises the value; 0025 learned the same
-- lesson for `tax_payable`. Safe to change in place: the migrator selects what
-- to run by timestamp and never re-reads a file it has already applied.

-- One per tenant. A second account absorbing exchange differences means the
-- income statement reports the same cause in two places, and reconciling them
-- is a job nobody has.
--
-- Stated as one account per role, not per this role, because naming the value
-- in an index predicate cannot be done here at all: the literal is the unsafe
-- use described above, and the text cast is STABLE where an index predicate
-- must be IMMUTABLE. `IS NOT NULL` names no value. 0025 arrives at the same
-- index for the same reason and replaces this one by name.
CREATE UNIQUE INDEX accounts_one_fx_gain_loss
  ON accounts (org_id, role)
  WHERE role IS NOT NULL;

--> statement-breakpoint
-- An exchange difference is income or expense — it measures a period, not a
-- position — and it swings both ways, so a single account holds both. That is
-- standard practice and it is why the account must permit a balance on the
-- "wrong" side: a month of favourable moves leaves an expense account with a
-- credit balance, which is a gain, not a violation.
ALTER TABLE accounts DROP CONSTRAINT accounts_role_type_check;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_role_type_check CHECK (
  role IS NULL
  OR (role::text = 'retained_earnings' AND type = 'equity')
  OR (role::text = 'fx_gain_loss' AND type IN ('revenue', 'expense') AND overdraft_allowed)
);

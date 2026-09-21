-- The account a filed return leaves the debt in.
--
-- The output-tax account accrues as sales are posted; it is a running total of
-- a period in progress. What a filed return produces is different in kind: a
-- settled, dated obligation for a closed period, which somebody will pay in
-- one payment. Keeping both in one account means the balance answers neither
-- question — "what have I accrued this month" and "what do I owe" become the
-- same number, and they are never the same number.
--
-- Found by role rather than by name, for the same reason retained earnings is:
-- "Thue GTGT phai nop" is a string a tenant may rename or translate, and a
-- filing routine matching on it breaks silently the day somebody does.
ALTER TYPE account_role ADD VALUE IF NOT EXISTS 'tax_payable';

--> statement-breakpoint
-- Note the `::text` casts below, which are not redundant.
--
-- Postgres refuses to let a transaction use an enum value that the same
-- transaction added, and the migrator runs every pending migration in one
-- transaction. Written as an enum literal this migration would apply cleanly
-- to a database that already had the value and fail on a fresh one — passing
-- everywhere except on a new clone, which is the worst place to find out.
-- Comparing as text never materialises the new value.
ALTER TABLE accounts DROP CONSTRAINT accounts_role_type_check;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_role_type_check CHECK (
  role IS NULL
  OR (role::text = 'retained_earnings' AND type = 'equity')
  OR (role::text = 'fx_gain_loss' AND type IN ('revenue', 'expense') AND overdraft_allowed)
  -- Overdraft allowed because a period whose input tax exceeded its output tax
  -- leaves a debit balance here: the state owes the business, and a liability
  -- account with a debit balance is the honest way to say so.
  OR (role::text = 'tax_payable' AND type = 'liability' AND overdraft_allowed)
);

--> statement-breakpoint
-- One account per role per tenant, for every role there is or will be.
--
-- This replaces the two per-role partial indexes. They said the same thing
-- once each, which meant a third role could be added without anyone noticing
-- it had no index — and that is precisely the mistake this migration would
-- have made. Stated generally, the next role is covered before it exists.
--
-- It also cannot use `role::text`: an enum-to-text cast is STABLE rather than
-- IMMUTABLE, so Postgres refuses it in an index predicate. `IS NOT NULL`
-- names no value at all, which sidesteps both problems at once.
DROP INDEX accounts_one_retained_earnings;

--> statement-breakpoint
DROP INDEX accounts_one_fx_gain_loss;

--> statement-breakpoint
CREATE UNIQUE INDEX accounts_org_role_key
  ON accounts (org_id, role) WHERE role IS NOT NULL;

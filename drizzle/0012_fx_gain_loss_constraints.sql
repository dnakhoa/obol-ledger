-- Constraints for the fx_gain_loss role, in their own migration because the
-- enum value added in 0011 cannot be used in the transaction that created it.

-- One per tenant. A second account absorbing exchange differences means the
-- income statement reports the same cause in two places, and reconciling them
-- is a job nobody has.
CREATE UNIQUE INDEX accounts_one_fx_gain_loss
  ON accounts (org_id)
  WHERE role = 'fx_gain_loss';

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
  OR (role = 'retained_earnings' AND type = 'equity')
  OR (role = 'fx_gain_loss' AND type IN ('revenue', 'expense') AND overdraft_allowed)
);

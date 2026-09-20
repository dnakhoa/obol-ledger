-- Which accounts are managed as open items.
--
-- An aged report asks "how long has this been outstanding", and that question
-- only means something for an account whose balance is a *set of unsettled
-- documents* — invoices a customer has not paid, bills we have not paid.
--
-- A bank account is a monetary asset with a balance and a currency, exactly
-- like a receivable, and ageing it produces a confident, meaningless table:
-- the money is not outstanding, it is *there*. `monetary` cannot tell the two
-- apart because IAS 21 is asking a different question — will this be
-- retranslated — and both answers are yes.
--
-- This is the third property the five account types cannot express, after
-- `monetary` (IAS 21) and `role` (which account is retained earnings). The
-- pattern is the same each time: a distinction the standards make that
-- asset/liability/equity/revenue/expense does not, carried as a column rather
-- than guessed from a name or a code prefix. Guessing from the code would work
-- on Thông tư 200 and nowhere else.
--
-- Accountants call this open-item accounting, as against balance-forward.

ALTER TABLE accounts ADD COLUMN open_items boolean NOT NULL DEFAULT false;

--> statement-breakpoint
-- Only a claim on somebody can be outstanding. Equity does not age, and
-- neither does revenue.
ALTER TABLE accounts ADD CONSTRAINT accounts_open_items_check
  CHECK (NOT open_items OR type IN ('asset', 'liability'));

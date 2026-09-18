-- Invariants that must hold no matter which client is writing.
--
-- Everything below is reachable from psql, a migration, or a future service, so
-- it cannot live in application code alone. The application still checks the
-- same rules first, to return a useful error instead of a constraint violation;
-- these are the floor beneath that.

-- 1. Postings and journal entries are append-only.
--
-- A ledger is a historical record: mistakes are corrected with a reversing
-- entry, never by editing history. Blocking UPDATE and DELETE at the table
-- makes that policy real rather than aspirational.
CREATE OR REPLACE FUNCTION obol_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only; % is not permitted. Post a reversing entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

--> statement-breakpoint
CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER transactions_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- 2. accounts.balance_minor is a cache of SUM(postings.amount_minor).
--
-- Maintaining it here rather than in the service guarantees the cache can never
-- disagree with the postings that justify it, and gives the overdraft CHECK
-- below something to fire on. The UPDATE also takes the account's row lock, so
-- two concurrent transfers touching the same account serialise rather than
-- losing one another's writes.
CREATE OR REPLACE FUNCTION obol_apply_posting_to_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE accounts
     SET balance_minor = balance_minor + NEW.amount_minor,
         updated_at    = now()
   WHERE id = NEW.account_id;
  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER postings_maintain_balance
  AFTER INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION obol_apply_posting_to_balance();

--> statement-breakpoint
-- 3. Overdraft policy.
--
-- Stored balances are debit-positive, so the figure a reader expects is negated
-- for credit-normal account types. Expressing the flip inside the CHECK keeps
-- the policy enforceable without a trigger.
ALTER TABLE accounts ADD CONSTRAINT accounts_overdraft_check CHECK (
  overdraft_allowed
  OR (CASE WHEN type IN ('asset', 'expense') THEN balance_minor ELSE -balance_minor END) >= 0
);

--> statement-breakpoint
-- 4. Postings may only touch open accounts.
CREATE OR REPLACE FUNCTION obol_reject_posting_to_closed_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_status_value account_status;
BEGIN
  SELECT status INTO account_status_value FROM accounts WHERE id = NEW.account_id;
  IF account_status_value <> 'open' THEN
    RAISE EXCEPTION 'account % is closed and cannot be posted to', NEW.account_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER postings_require_open_account
  BEFORE INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION obol_reject_posting_to_closed_account();

--> statement-breakpoint
-- 5. The double-entry invariant, checked at COMMIT.
--
-- This is the whole point of the schema. A DEFERRABLE INITIALLY DEFERRED
-- constraint trigger runs after the last statement of the transaction, by which
-- time every posting of the entry has been inserted — an immediate trigger
-- would fire after the first line and reject every entry ever written.
--
-- Consequence worth knowing: an unbalanced entry fails at COMMIT, not at
-- INSERT, so the error surfaces where the transaction closes.
CREATE OR REPLACE FUNCTION obol_assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  residual   bigint;
  line_count integer;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*)
    INTO residual, line_count
    FROM postings
   WHERE transaction_id = NEW.transaction_id;

  -- The entry was rolled back or never completed; nothing to assert.
  IF line_count = 0 THEN
    RETURN NULL;
  END IF;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'transaction % has % posting(s); double-entry requires at least two',
      NEW.transaction_id, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF residual <> 0 THEN
    RAISE EXCEPTION
      'transaction % is unbalanced by % minor units',
      NEW.transaction_id, residual
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obol_assert_transaction_balanced();

-- Two-phase transactions: pending -> posted | archived.
--
-- Money is authorised before it settles. A card hold, an ACH in flight, an
-- escrow release pending a condition — in every case the funds are spoken for
-- but not yet moved, and a ledger that cannot represent that state forces the
-- application to invent it. Inventing it is where the bugs live: the balance
-- says one thing, an out-of-band "reserved" table says another, and nothing
-- reconciles them.
--
-- So an entry has a status, and an account has three balances rather than one:
--
--   posted     settled entries only. What is actually there.
--   pending    settled plus in-flight. What it will be if everything lands.
--   available  settled minus in-flight outflows. What can still be spent.
--
-- `available` is the one that matters. An authorisation must reserve funds the
-- moment it is made, or two concurrent withdrawals both see a healthy posted
-- balance and both succeed.

CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'posted', 'archived');

--> statement-breakpoint
-- Existing rows are settled history, so they default to posted.
ALTER TABLE transactions ADD COLUMN status transaction_status DEFAULT 'posted' NOT NULL;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN posted_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN archived_at timestamp with time zone;

--> statement-breakpoint
-- The append-only rule needs a carve-out it did not have before, and the
-- backfill below is itself an UPDATE the old trigger would refuse — so it
-- comes off here, before anything tries to write, and is replaced further
-- down by a guard that permits exactly one thing.
--
-- A pending entry is *not yet* history: it is a proposal, and proposals get
-- settled or cancelled. So a transaction may change status while pending, and
-- nothing else, ever. Postings stay absolutely immutable — an entry's amounts
-- are fixed the moment it is written, whatever happens to its status.
DROP TRIGGER transactions_append_only ON transactions;

--> statement-breakpoint
UPDATE transactions SET posted_at = created_at WHERE status = 'posted' AND posted_at IS NULL;

--> statement-breakpoint
-- The timestamps must agree with the status rather than drift from it.
ALTER TABLE transactions ADD CONSTRAINT transactions_status_timestamps CHECK (
  (status = 'pending'  AND posted_at IS NULL AND archived_at IS NULL) OR
  (status = 'posted'   AND posted_at IS NOT NULL AND archived_at IS NULL) OR
  (status = 'archived' AND archived_at IS NOT NULL)
);

--> statement-breakpoint
-- Fill the timestamps from the status rather than demanding both.
--
-- Without this, `INSERT INTO transactions (id, description, currency,
-- occurred_at)` fails — status defaults to 'posted' and the CHECK above wants
-- a posted_at. That is a trap for anyone writing SQL by hand, and it would
-- have broken every statement written before this migration existed.
--
-- The CHECK still guarantees the invariant. This just means the obvious
-- insert satisfies it.
CREATE OR REPLACE FUNCTION obol_normalize_status_timestamps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' AND NEW.posted_at IS NULL THEN
    NEW.posted_at := now();
  END IF;
  IF NEW.status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  END IF;
  IF NEW.status = 'pending' THEN
    NEW.posted_at := NULL;
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER transactions_normalize_timestamps
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_normalize_status_timestamps();

--> statement-breakpoint
CREATE INDEX transactions_org_status_idx ON transactions USING btree (org_id, status, occurred_at DESC);

--> statement-breakpoint
-- Pending totals are kept in *presented* terms — the sign a reader expects —
-- because whether a posting is an inflow or an outflow depends on the account
-- class, and resolving that once in the trigger keeps every consumer simple.
ALTER TABLE accounts ADD COLUMN pending_inflow_minor  bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN pending_outflow_minor bigint DEFAULT 0 NOT NULL;

--> statement-breakpoint
-- An optimistic-concurrency token. Incremented on every balance change, so a
-- caller can assert "apply this only if the account has not moved since I
-- read it" without holding a lock across a round trip.
ALTER TABLE accounts ADD COLUMN version integer DEFAULT 0 NOT NULL;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_pending_non_negative
  CHECK (pending_inflow_minor >= 0 AND pending_outflow_minor >= 0);

--> statement-breakpoint
-- Which side a posting falls on, in presented terms. +1 for debit-normal
-- classes, -1 for credit-normal ones — the same flip `presentedBalance` does
-- in the application, expressed once here so the triggers can use it.
CREATE OR REPLACE FUNCTION obol_presented_sign(account_type account_type) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN account_type IN ('asset', 'expense') THEN 1 ELSE -1 END;
$$;

--> statement-breakpoint
-- Replaces the trigger from 0001. A posting now lands in the pending columns
-- or the posted balance depending on its transaction's status.
CREATE OR REPLACE FUNCTION obol_apply_posting_to_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_status transaction_status;
  presented    bigint;
BEGIN
  SELECT status INTO entry_status FROM transactions WHERE id = NEW.transaction_id;

  IF entry_status = 'posted' THEN
    UPDATE accounts
       SET balance_minor = balance_minor + NEW.amount_minor,
           version       = version + 1,
           updated_at    = now()
     WHERE id = NEW.account_id;
    RETURN NULL;
  END IF;

  IF entry_status = 'pending' THEN
    SELECT obol_presented_sign(a.type) * NEW.amount_minor INTO presented
      FROM accounts a WHERE a.id = NEW.account_id;

    UPDATE accounts
       SET pending_inflow_minor  = pending_inflow_minor  + GREATEST(presented, 0),
           pending_outflow_minor = pending_outflow_minor + GREATEST(-presented, 0),
           version               = version + 1,
           updated_at            = now()
     WHERE id = NEW.account_id;
  END IF;

  -- An archived entry moves nothing.
  RETURN NULL;
END;
$$;

--> statement-breakpoint
-- Status transitions move the amounts between the pending columns and the
-- posted balance. Doing it here rather than in the service means the three
-- balances cannot disagree with the postings that justify them, however the
-- status was changed.
CREATE OR REPLACE FUNCTION obol_apply_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line RECORD;
  presented bigint;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NULL;
  END IF;

  FOR line IN
    SELECT p.account_id, p.amount_minor, obol_presented_sign(a.type) AS sign
      FROM postings p JOIN accounts a ON a.id = p.account_id
     WHERE p.transaction_id = NEW.id
  LOOP
    presented := line.sign * line.amount_minor;

    -- Leaving pending always releases the reservation.
    IF OLD.status = 'pending' THEN
      UPDATE accounts
         SET pending_inflow_minor  = pending_inflow_minor  - GREATEST(presented, 0),
             pending_outflow_minor = pending_outflow_minor - GREATEST(-presented, 0)
       WHERE id = line.account_id;
    END IF;

    -- Becoming posted settles it.
    IF NEW.status = 'posted' THEN
      UPDATE accounts
         SET balance_minor = balance_minor + line.amount_minor
       WHERE id = line.account_id;
    END IF;

    UPDATE accounts SET version = version + 1, updated_at = now() WHERE id = line.account_id;
  END LOOP;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER transactions_apply_status_change
  AFTER UPDATE OF status ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_apply_status_change();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION obol_guard_transaction_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions is append-only; DELETE is not permitted. Post a reversing entry instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'transaction % is % and immutable; only a pending entry may change. Post a reversing entry instead.',
      OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Field immutability is checked before the transition rule, so that someone
  -- editing a description is told *that* is not allowed rather than being
  -- given a confusing message about status transitions they never attempted.
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.currency <> OLD.currency
     OR NEW.description <> OLD.description OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.reverses_transaction_id IS DISTINCT FROM OLD.reverses_transaction_id THEN
    RAISE EXCEPTION 'only the status of a pending transaction may change'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'a pending transaction may only move to posted or archived'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER transactions_guard_mutation
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_guard_transaction_mutation();

--> statement-breakpoint
-- The overdraft rule now consults the *available* balance.
--
-- This is the point of the whole migration. Under the old CHECK, an authorised
-- but unsettled withdrawal reserved nothing, so two concurrent authorisations
-- both saw a healthy posted balance and both succeeded. Available subtracts
-- what is already spoken for.
ALTER TABLE accounts DROP CONSTRAINT accounts_overdraft_check;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_overdraft_check CHECK (
  overdraft_allowed
  OR (obol_presented_sign(type) * balance_minor) - pending_outflow_minor >= 0
);

-- Arbitrary key/value data on accounts and entries.
--
-- Every hosted ledger has this, and for one reason: the ledger is never the
-- system of record for *why* an entry exists. The invoice id, the order
-- number, the counterparty's own reference — those live in the caller's world,
-- and without somewhere to put them the caller is forced to keep a parallel
-- table mapping their ids to ours. That table is one more thing that can
-- disagree with the ledger.
--
-- Deliberately a bag of strings rather than a schema. The moment it has a
-- schema it is a domain model, and a domain model belongs to whoever owns the
-- domain — which is the caller, not the ledger.

ALTER TABLE accounts ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

--> statement-breakpoint
-- An object, not an array or a scalar. `metadata @> '{"invoice":"INV-1"}'`
-- is the query this exists for, and containment against a non-object is a
-- silent no-match rather than an error — so the shape is pinned here.
ALTER TABLE accounts ADD CONSTRAINT accounts_metadata_check
  CHECK (jsonb_typeof(metadata) = 'object');
--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_metadata_check
  CHECK (jsonb_typeof(metadata) = 'object');

--> statement-breakpoint
-- A bound, because an unbounded jsonb column is a place to put a 40MB blob
-- that then has to be read on every balance query. Four kilobytes is generous
-- for references and far short of a document store.
ALTER TABLE accounts ADD CONSTRAINT accounts_metadata_size_check
  CHECK (length(metadata::text) <= 4096);
--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_metadata_size_check
  CHECK (length(metadata::text) <= 4096);

--> statement-breakpoint
-- GIN with jsonb_path_ops, not the default jsonb_ops.
--
-- The default indexes every key *and* every value, which supports existence
-- queries (`metadata ? 'invoice'`) that nothing here issues. jsonb_path_ops
-- indexes only hashed key/value paths: a smaller index that is faster for the
-- containment query this is built for, at the cost of the operators we do not
-- use.
CREATE INDEX transactions_metadata_idx ON transactions USING gin (metadata jsonb_path_ops);
--> statement-breakpoint
CREATE INDEX accounts_metadata_idx ON accounts USING gin (metadata jsonb_path_ops);

--> statement-breakpoint
-- Metadata is caller-supplied annotation, not part of the accounting record,
-- so it becomes the second carve-out from immutability after the status
-- column — and unlike status, it may change at any point in an entry's life.
--
-- That is a real widening and worth being explicit about. An invoice reference
-- often arrives after the entry does, and refusing to record it would push the
-- caller back to the parallel mapping table this column exists to remove.
-- Nothing an accountant would recognise as the entry can move: not the
-- amounts, not the description, not when it happened, not what it reverses.
CREATE OR REPLACE FUNCTION obol_guard_transaction_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transactions is append-only; DELETE is not permitted. Post a reversing entry instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Field immutability is checked before the transition rule, so that someone
  -- editing a description is told *that* is not allowed rather than being
  -- given a confusing message about status transitions they never attempted.
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.currency <> OLD.currency
     OR NEW.description <> OLD.description OR NEW.occurred_at <> OLD.occurred_at
     OR NEW.reverses_transaction_id IS DISTINCT FROM OLD.reverses_transaction_id THEN
    RAISE EXCEPTION 'only the status and metadata of a transaction may change'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- A settled entry is frozen apart from its annotation. Checked only when the
  -- status actually differs, so annotating a posted entry is permitted while
  -- moving one is not.
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'transaction % is % and immutable; only a pending entry may change status. Post a reversing entry instead.',
        OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'pending' THEN
      RAISE EXCEPTION 'a pending transaction may only move to posted or archived'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    -- The lifecycle timestamps belong to the status, not to the caller. If
    -- they could move while the status stood still, an entry could claim to
    -- have settled at a time it never settled — a contradiction the reports
    -- would faithfully render. They may only change in the same statement
    -- that performs a legal transition.
    IF NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'posted_at and archived_at follow the status; only the status and metadata of a transaction may change'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

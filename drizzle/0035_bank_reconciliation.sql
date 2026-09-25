-- Bank reconciliation: the bank's record of the account, beside the books'.
--
-- The ledger says what the business believes happened to its money. The bank
-- statement says what did. Until they are compared line by line, the books
-- carry every mistake the bank would have caught — a supplier paid twice, a
-- customer's transfer never booked, a fee nobody entered — and month end is
-- a spreadsheet of two exports and a highlighter.
--
-- A statement line is kept exactly as the bank gave it, once: a file imported
-- twice, or a feed that resends a day, adds nothing the second time. A line
-- is matched to the posting in the books that records the same movement, and
-- the database refuses a match between different amounts or different
-- accounts, and a line or a posting matched twice.
--
-- See docs/adr/0025-bank-reconciliation.md.

-- Target for the composite key below: a match names a posting *on the
-- account the statement belongs to*, or it has no row to reference.
ALTER TABLE postings ADD CONSTRAINT postings_id_org_account_key UNIQUE (id, org_id, account_id);

--> statement-breakpoint
CREATE TABLE bank_imports (
  id           text PRIMARY KEY,
  org_id       text NOT NULL,
  account_id   text NOT NULL,
  -- A statement file someone uploaded, or lines a bank feed pushed.
  source       text NOT NULL,
  filename     text,
  lines_added  integer NOT NULL,
  lines_skipped integer NOT NULL,
  imported_by  text,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE bank_imports ADD CONSTRAINT bank_imports_account_fk
  FOREIGN KEY (account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_imports ADD CONSTRAINT bank_imports_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE bank_imports ADD CONSTRAINT bank_imports_shape_check CHECK (
  source IN ('file', 'feed') AND lines_added >= 0 AND lines_skipped >= 0
);

--> statement-breakpoint
CREATE TABLE bank_lines (
  id           text PRIMARY KEY,
  org_id       text NOT NULL,
  account_id   text NOT NULL,
  -- Always the account's own currency: a statement is in the currency the
  -- account is held in, and a line in another could never be matched.
  currency     char(3) NOT NULL,
  import_id    text NOT NULL,
  occurred_on  date NOT NULL,
  -- Signed, as the account sees it: money in is positive, money out negative.
  amount_minor bigint NOT NULL,
  description  text NOT NULL,
  reference    text,
  -- The bank's own running balance after this line, when the export has one.
  balance_minor bigint,
  -- What makes a line the same line twice: the bank's transaction id from a
  -- feed, or a hash of the line's content (and its position among identical
  -- lines that day) from a file.
  fingerprint  text NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_account_fk
  FOREIGN KEY (account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_account_currency_fk
  FOREIGN KEY (account_id, currency) REFERENCES accounts (id, currency) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_import_fk
  FOREIGN KEY (import_id, org_id) REFERENCES bank_imports (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_id_org_account_key UNIQUE (id, org_id, account_id);

--> statement-breakpoint
CREATE UNIQUE INDEX bank_lines_account_fingerprint_key ON bank_lines (account_id, fingerprint);

--> statement-breakpoint
CREATE INDEX bank_lines_org_account_idx ON bank_lines (org_id, account_id, occurred_on, id);

--> statement-breakpoint
ALTER TABLE bank_lines ADD CONSTRAINT bank_lines_shape_check CHECK (
  amount_minor <> 0
  AND length(description) BETWEEN 1 AND 500
  AND length(fingerprint) BETWEEN 1 AND 200
);

--> statement-breakpoint
CREATE TABLE bank_matches (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  account_id  text NOT NULL,
  line_id     text NOT NULL,
  posting_id  text NOT NULL,
  matched_by  text,
  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  -- A match made in error is undone, not erased.
  removed_at  timestamp with time zone,
  removed_by  text
);

--> statement-breakpoint
ALTER TABLE bank_matches ADD CONSTRAINT bank_matches_line_fk
  FOREIGN KEY (line_id, org_id, account_id) REFERENCES bank_lines (id, org_id, account_id)
  ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_matches ADD CONSTRAINT bank_matches_posting_fk
  FOREIGN KEY (posting_id, org_id, account_id) REFERENCES postings (id, org_id, account_id)
  ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE bank_matches ADD CONSTRAINT bank_matches_removal_check
  CHECK (removed_at IS NOT NULL OR removed_by IS NULL);

--> statement-breakpoint
-- A line is one movement of money, and so is a posting: each is matched to at
-- most one of the other at a time.
CREATE UNIQUE INDEX bank_matches_line_key ON bank_matches (line_id) WHERE removed_at IS NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX bank_matches_posting_key ON bank_matches (posting_id) WHERE removed_at IS NULL;

--> statement-breakpoint
CREATE INDEX bank_matches_org_account_idx ON bank_matches (org_id, account_id);

--> statement-breakpoint
CREATE TRIGGER bank_imports_append_only
  BEFORE UPDATE OR DELETE ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER bank_lines_append_only
  BEFORE UPDATE OR DELETE ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- A match says the bank and the books recorded the same movement, so the two
-- must be the same amount — to the unit, in the account's currency — and the
-- posting must be one that actually happened, not a pending hold.
CREATE OR REPLACE FUNCTION obol_check_bank_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line    bank_lines%ROWTYPE;
  posting record;
BEGIN
  SELECT * INTO line FROM bank_lines WHERE id = NEW.line_id AND org_id = NEW.org_id;
  SELECT p.amount_minor, t.status
    INTO posting
    FROM postings p JOIN transactions t ON t.id = p.transaction_id
   WHERE p.id = NEW.posting_id AND p.org_id = NEW.org_id;

  IF posting.amount_minor <> line.amount_minor THEN
    RAISE EXCEPTION 'bank line % is % but posting % is %; a match is the same movement',
      line.id, line.amount_minor, NEW.posting_id, posting.amount_minor
      USING ERRCODE = 'check_violation';
  END IF;

  IF posting.status <> 'posted' THEN
    RAISE EXCEPTION 'posting % belongs to a % entry; only posted entries can be matched',
      NEW.posting_id, posting.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER bank_matches_same_movement
  AFTER INSERT ON bank_matches
  FOR EACH ROW EXECUTE FUNCTION obol_check_bank_match();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION obol_bank_match_removal_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.removed_at IS NOT NULL
     OR NEW.removed_at IS NULL
     OR (NEW.id, NEW.org_id, NEW.account_id, NEW.line_id, NEW.posting_id, NEW.matched_by,
         NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.org_id, OLD.account_id, OLD.line_id, OLD.posting_id, OLD.matched_by,
         OLD.created_at) THEN
    RAISE EXCEPTION 'bank matches are append-only; the only change allowed is undoing one'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER bank_matches_removal_only
  BEFORE UPDATE OR DELETE ON bank_matches
  FOR EACH ROW EXECUTE FUNCTION obol_bank_match_removal_only();

--> statement-breakpoint
ALTER TABLE bank_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_imports FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_lines   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_lines   FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_matches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_matches FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY bank_imports_tenant_isolation ON bank_imports
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY bank_lines_tenant_isolation ON bank_lines
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY bank_matches_tenant_isolation ON bank_matches
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- The entries the stock records wrote cannot be reversed from the journal.
--
-- A receipt posts to the inventory account and opens a lot in one transaction;
-- a shipment posts the cost of goods sold and draws the lots down; a landed
-- cost charge raises what the lots are carried at and posts the same amount.
-- Each pair is one fact written twice, and the stock module's whole value is
-- that the two halves agree — it is what lets the inventory account be
-- reconciled to the lots behind it, item by item.
--
-- The journal's reversal negates an entry's postings and touches nothing
-- else. Applied to one of these, it puts the inventory account back while the
-- lot still claims 800 m² in the yard, and every cost of goods sold drawn from
-- that lot afterwards is posted against stock the account no longer carries.
-- Both entries balance, so nothing in the ledger ever objects; the first
-- person to notice is whoever counts the yard.
--
-- The service refuses with an explanation. This is the refusal for every
-- other writer — an import script, a psql session, a second service — because
-- a rule the database can enforce belongs in the database.

CREATE OR REPLACE FUNCTION obol_refuse_stock_entry_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM inventory_movements
     WHERE transaction_id = NEW.reverses_transaction_id AND org_id = NEW.org_id
  ) OR EXISTS (
    SELECT 1 FROM landed_cost_charges
     WHERE transaction_id = NEW.reverses_transaction_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION
      'entry % was written by the stock records and cannot be reversed from the journal',
      NEW.reverses_transaction_id
      USING ERRCODE = 'check_violation',
            HINT = 'Correct stock with a return, a write-off or a further charge, so the lots move with the account.';
  END IF;

  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER transactions_stock_entries_not_reversed
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION obol_refuse_stock_entry_reversal();

--> statement-breakpoint
-- "Which stock record wrote this entry" is the question the trigger asks, and
-- the journal asks it too when it offers the reverse button. Without these it
-- is a scan of every movement the tenant has ever made.
CREATE INDEX inventory_movements_transaction_idx
  ON inventory_movements (org_id, transaction_id);

--> statement-breakpoint
CREATE INDEX landed_cost_charges_transaction_idx
  ON landed_cost_charges (org_id, transaction_id);

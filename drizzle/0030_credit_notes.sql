-- Credit notes: correcting a sale by a further record, never by an edit.
--
-- A sale is append-only (0027), which was right and left a hole: a customer
-- who sends back two pallets of cracked pavers, or who is given 5% off for a
-- late delivery, had no way into the books except a hand-typed journal entry.
-- That entry balanced. It also moved revenue without telling the sale, put
-- stock back into an account without putting it back into a lot, and aged as
-- a payment against whichever invoice happened to be oldest. Every report
-- built on the sale — margin by invoice, by product, by customer — kept
-- showing the pallets as sold.
--
-- A credit note is the sale's own correction. It names the invoice and the
-- lines it corrects, credits what the customer was charged at the rate the
-- invoice was raised at, takes back the output tax, and — for the lines where
-- goods came back — puts them into the very lots they left from, at the cost
-- they left at. The database refuses a credit note that returns more than a
-- line shipped or credits more than the invoice charged, because a refund
-- larger than the sale is how money leaves a business in a line nobody reads.
--
-- See docs/adr/0021-credit-notes.md.

-- Targets for the composite keys below. A credit note in another currency
-- than its invoice, or a line pointing at another invoice's line, has no row
-- to reference and so cannot exist.
ALTER TABLE sales ADD CONSTRAINT sales_id_org_currency_key UNIQUE (id, org_id, currency);

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_id_org_sale_key
  UNIQUE (id, org_id, sale_id);

--> statement-breakpoint
ALTER TABLE layer_consumptions ADD CONSTRAINT layer_consumptions_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
-- The line's net total in the invoice currency, as the customer saw it.
--
-- 0027 stored only the functional-currency revenue, which is all a margin
-- needs. A credit note needs the other one: "credit 1,200 dollars of line 2"
-- has to be checked against the 3,000 dollars line 2 was invoiced at, not
-- against its dong value divided back by a rate. Nullable because sales raised
-- before this migration never recorded it; the service apportions the
-- invoice's net across their lines instead, which is exact for the ones in
-- the books' own currency and the best available answer for the rest.
ALTER TABLE inventory_movements ADD COLUMN amount_minor bigint;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_amount_check
  CHECK (amount_minor IS NULL OR (sale_id IS NOT NULL AND amount_minor >= 0));

--> statement-breakpoint
-- Goods coming back. Not a receipt: a receipt opens a new lot at a new price,
-- and a returned paver is not a new purchase — it is the same paver, from
-- the same container, at the same cost, going back where it came from.
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IN ('receipt', 'issue', 'writeoff', 'return'));

--> statement-breakpoint
CREATE TABLE credit_notes (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  -- The credit note's own number. Unique, like an invoice number, because a
  -- customer quotes it when they take the credit off their next payment.
  reference   text NOT NULL,
  sale_id     text NOT NULL,
  -- Always the invoice's own currency and rate: a credit note undoes part of
  -- a sale, and undoing it at today's rate would book an exchange difference
  -- that no money ever moved to create.
  currency    char(3) NOT NULL,
  fx_rate     numeric(20, 10) NOT NULL,
  -- Where the revenue comes back out: the sale's revenue account, or a
  -- contra-revenue account such as 521 under Thông tư 200, whose balance is
  -- reported as a deduction from revenue rather than netted invisibly.
  revenue_account_id text NOT NULL,
  -- Why, in the words the credit note will carry. Printed, so free text.
  reason      text,
  net_minor   bigint NOT NULL,
  tax_minor   bigint NOT NULL,
  gross_minor bigint NOT NULL,
  base_net_minor  bigint NOT NULL,
  base_tax_minor  bigint NOT NULL,
  -- What the returned goods cost, put back into stock. Zero for a credit
  -- that returned nothing, such as a discount for a late delivery.
  base_cost_minor bigint NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  transaction_id text NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_sale_fk
  FOREIGN KEY (sale_id, org_id, currency) REFERENCES sales (id, org_id, currency) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_revenue_account_fk
  FOREIGN KEY (revenue_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_id_org_sale_key UNIQUE (id, org_id, sale_id);

--> statement-breakpoint
CREATE UNIQUE INDEX credit_notes_org_reference_key ON credit_notes (org_id, reference);

--> statement-breakpoint
CREATE INDEX credit_notes_org_sale_idx ON credit_notes (org_id, sale_id, occurred_at);

--> statement-breakpoint
CREATE INDEX credit_notes_org_occurred_idx ON credit_notes (org_id, occurred_at DESC, id DESC);

--> statement-breakpoint
CREATE INDEX credit_notes_transaction_idx ON credit_notes (org_id, transaction_id);

--> statement-breakpoint
-- A credit note credits something or takes something back, and the three
-- figures a customer sees add up. A note of nothing is a document that
-- changes nothing and still takes a number.
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_amounts_check CHECK (
  net_minor >= 0
  AND tax_minor >= 0
  AND gross_minor = net_minor + tax_minor
  AND base_net_minor >= 0
  AND base_tax_minor >= 0
  AND base_cost_minor >= 0
  AND (net_minor > 0 OR base_cost_minor > 0)
);

--> statement-breakpoint
CREATE TABLE credit_note_lines (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  credit_note_id text NOT NULL,
  -- Carried so both composite keys can see it: the line and the sale line it
  -- corrects must belong to the same sale, and a key is how that is said.
  sale_id     text NOT NULL,
  line        integer NOT NULL,
  sale_movement_id text NOT NULL,
  -- How much came back, to the item's precision. Zero for a price allowance.
  quantity_minor     bigint NOT NULL,
  -- What is credited, net, in the invoice currency and in the books' own.
  amount_minor       bigint NOT NULL,
  revenue_base_minor bigint NOT NULL,
  -- What the returned goods cost when they left. Zero when nothing came back.
  base_cost_minor    bigint NOT NULL,
  -- The movement that put them back. Present exactly when something did.
  return_movement_id text,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE credit_note_lines ADD CONSTRAINT credit_note_lines_note_fk
  FOREIGN KEY (credit_note_id, org_id, sale_id) REFERENCES credit_notes (id, org_id, sale_id)
  ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_note_lines ADD CONSTRAINT credit_note_lines_sale_line_fk
  FOREIGN KEY (sale_movement_id, org_id, sale_id)
  REFERENCES inventory_movements (id, org_id, sale_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE credit_note_lines ADD CONSTRAINT credit_note_lines_return_fk
  FOREIGN KEY (return_movement_id, org_id) REFERENCES inventory_movements (id, org_id)
  ON DELETE restrict;

--> statement-breakpoint
CREATE UNIQUE INDEX credit_note_lines_line_key ON credit_note_lines (credit_note_id, line);

--> statement-breakpoint
-- One line per invoice line per note. Two lines crediting the same invoice
-- line on one note is one line whose arithmetic was done twice.
CREATE UNIQUE INDEX credit_note_lines_sale_line_key
  ON credit_note_lines (credit_note_id, sale_movement_id);

--> statement-breakpoint
CREATE UNIQUE INDEX credit_note_lines_return_key ON credit_note_lines (return_movement_id)
  WHERE return_movement_id IS NOT NULL;

--> statement-breakpoint
CREATE INDEX credit_note_lines_sale_movement_idx
  ON credit_note_lines (org_id, sale_movement_id);

--> statement-breakpoint
ALTER TABLE credit_note_lines ADD CONSTRAINT credit_note_lines_amounts_check CHECK (
  line >= 1
  AND quantity_minor >= 0
  AND amount_minor >= 0
  AND revenue_base_minor >= 0
  AND base_cost_minor >= 0
  AND (quantity_minor > 0 OR amount_minor > 0)
  AND (quantity_minor > 0) = (return_movement_id IS NOT NULL)
  AND (quantity_minor > 0 OR base_cost_minor = 0)
);

--> statement-breakpoint
-- Which consumptions a return undid, and by how much.
--
-- The mirror of layer_consumptions. It is what makes "put the goods back
-- where they came from" checkable: a return can only restore what a draw
-- took, and this table is where the database adds that up.
CREATE TABLE layer_restorations (
  id              text PRIMARY KEY,
  org_id          text NOT NULL,
  movement_id     text NOT NULL,
  consumption_id  text NOT NULL,
  layer_id        text NOT NULL,
  quantity_minor  bigint NOT NULL,
  cost_minor      bigint NOT NULL,
  base_cost_minor bigint NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE layer_restorations ADD CONSTRAINT layer_restorations_movement_fk
  FOREIGN KEY (movement_id, org_id) REFERENCES inventory_movements (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE layer_restorations ADD CONSTRAINT layer_restorations_consumption_fk
  FOREIGN KEY (consumption_id, org_id) REFERENCES layer_consumptions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE layer_restorations ADD CONSTRAINT layer_restorations_layer_fk
  FOREIGN KEY (layer_id, org_id) REFERENCES cost_layers (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE layer_restorations ADD CONSTRAINT layer_restorations_amounts_check
  CHECK (quantity_minor > 0 AND cost_minor >= 0 AND base_cost_minor >= 0);

--> statement-breakpoint
CREATE UNIQUE INDEX layer_restorations_movement_consumption_key
  ON layer_restorations (movement_id, consumption_id);

--> statement-breakpoint
CREATE INDEX layer_restorations_consumption_idx ON layer_restorations (org_id, consumption_id);

--> statement-breakpoint
CREATE TRIGGER credit_notes_append_only
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER credit_note_lines_append_only
  BEFORE UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER layer_restorations_append_only
  BEFORE UPDATE OR DELETE ON layer_restorations
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- A restoration gives back no more than its draw took.
--
-- Checked per row as it lands, under a lock on the draw, so two returns of the
-- same goods racing each other queue here and the second sees the first. A
-- sum over rows that another transaction is still writing is the textbook
-- way for two refunds of one pallet to both succeed.
CREATE OR REPLACE FUNCTION obol_check_restoration() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  drawn    layer_consumptions%ROWTYPE;
  restored record;
BEGIN
  SELECT * INTO drawn FROM layer_consumptions
   WHERE id = NEW.consumption_id AND org_id = NEW.org_id
   FOR UPDATE;

  IF drawn.layer_id <> NEW.layer_id THEN
    RAISE EXCEPTION 'restoration % names lot % but its draw came from lot %',
      NEW.id, NEW.layer_id, drawn.layer_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(quantity_minor), 0) AS quantity,
         coalesce(sum(cost_minor), 0) AS cost,
         coalesce(sum(base_cost_minor), 0) AS base_cost
    INTO restored
    FROM layer_restorations
   WHERE consumption_id = NEW.consumption_id AND org_id = NEW.org_id;

  IF restored.quantity > drawn.quantity_minor
     OR restored.cost > drawn.cost_minor
     OR restored.base_cost > drawn.base_cost_minor THEN
    RAISE EXCEPTION
      'draw % took % and returns would give back %; stock cannot come back that never left',
      drawn.id, drawn.quantity_minor, restored.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER layer_restorations_within_draw
  AFTER INSERT ON layer_restorations
  FOR EACH ROW EXECUTE FUNCTION obol_check_restoration();

--> statement-breakpoint
-- A line credits no more than its invoice line: in quantity, and in revenue.
--
-- Under a lock on the invoice line, for the same reason as above. The revenue
-- cap is in the books' own currency because that is the figure a margin
-- report subtracts, and a credit larger than the line's revenue is a negative
-- sale that no report was built to show.
CREATE OR REPLACE FUNCTION obol_check_credit_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sold     inventory_movements%ROWTYPE;
  credited record;
BEGIN
  SELECT * INTO sold FROM inventory_movements
   WHERE id = NEW.sale_movement_id AND org_id = NEW.org_id
   FOR UPDATE;

  SELECT coalesce(sum(quantity_minor), 0) AS quantity,
         coalesce(sum(revenue_base_minor), 0) AS revenue
    INTO credited
    FROM credit_note_lines
   WHERE sale_movement_id = NEW.sale_movement_id AND org_id = NEW.org_id;

  IF credited.quantity > sold.quantity_minor THEN
    RAISE EXCEPTION
      'invoice line % shipped % and credit notes would return %',
      sold.id, sold.quantity_minor, credited.quantity
      USING ERRCODE = 'check_violation';
  END IF;

  IF credited.revenue > sold.revenue_base_minor THEN
    RAISE EXCEPTION
      'invoice line % earned % and credit notes would take back %',
      sold.id, sold.revenue_base_minor, credited.revenue
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER credit_note_lines_within_sale_line
  AFTER INSERT ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION obol_check_credit_line();

--> statement-breakpoint
-- A credit note credits no more than its invoice charged, net and tax, in the
-- invoice's own currency — the figure the customer was asked to pay.
CREATE OR REPLACE FUNCTION obol_check_credit_note_within_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sold     sales%ROWTYPE;
  credited record;
BEGIN
  SELECT * INTO sold FROM sales WHERE id = NEW.sale_id AND org_id = NEW.org_id FOR UPDATE;

  IF NEW.occurred_at < sold.occurred_at THEN
    RAISE EXCEPTION 'credit note % is dated before invoice %', NEW.reference, sold.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(net_minor), 0) AS net,
         coalesce(sum(tax_minor), 0) AS tax,
         coalesce(sum(base_tax_minor), 0) AS base_tax
    INTO credited
    FROM credit_notes
   WHERE sale_id = NEW.sale_id AND org_id = NEW.org_id;

  IF credited.net > sold.net_minor
     OR credited.tax > sold.tax_minor
     OR credited.base_tax > sold.base_tax_minor THEN
    RAISE EXCEPTION
      'invoice % charged % net and % tax; credit notes would credit % and %',
      sold.reference, sold.net_minor, sold.tax_minor, credited.net, credited.tax
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER credit_notes_within_sale
  AFTER INSERT ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION obol_check_credit_note_within_sale();

--> statement-breakpoint
-- The header agrees with its lines, and each returned line with the goods
-- that actually went back into the lots — checked at COMMIT.
--
-- Deferred because the header is written first so the lines can reference it,
-- and the return movements before the lines so the lines can reference them.
-- At COMMIT everything is present, and the three figures that must agree are
-- checked against each other rather than against what the service intended.
CREATE OR REPLACE FUNCTION obol_check_credit_note_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  note       credit_notes%ROWTYPE;
  totals     record;
  mismatched record;
BEGIN
  SELECT * INTO note FROM credit_notes WHERE id = NEW.id;

  SELECT count(*) AS lines,
         coalesce(sum(amount_minor), 0) AS net,
         coalesce(sum(revenue_base_minor), 0) AS revenue,
         coalesce(sum(base_cost_minor), 0) AS cost
    INTO totals
    FROM credit_note_lines
   WHERE credit_note_id = NEW.id AND org_id = NEW.org_id;

  IF totals.lines = 0 THEN
    RAISE EXCEPTION 'credit note % has no lines', note.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF totals.net <> note.net_minor
     OR totals.revenue <> note.base_net_minor
     OR totals.cost <> note.base_cost_minor THEN
    RAISE EXCEPTION
      'credit note % does not agree with its lines: net % against %, revenue % against %, cost % against %',
      note.reference, note.net_minor, totals.net, note.base_net_minor, totals.revenue,
      note.base_cost_minor, totals.cost
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every return put back exactly what its line says, taken from the draws of
  -- the invoice line it corrects and no other.
  SELECT l.line, l.quantity_minor, l.base_cost_minor,
         m.quantity_minor AS moved_quantity, m.base_cost_minor AS moved_cost,
         coalesce(r.quantity, 0) AS restored_quantity,
         coalesce(r.base_cost, 0) AS restored_cost,
         coalesce(r.foreign_draws, 0) AS foreign_draws
    INTO mismatched
    FROM credit_note_lines l
    JOIN inventory_movements m ON m.id = l.return_movement_id AND m.org_id = l.org_id
    LEFT JOIN LATERAL (
      SELECT sum(x.quantity_minor) AS quantity,
             sum(x.base_cost_minor) AS base_cost,
             count(*) FILTER (WHERE c.movement_id <> l.sale_movement_id) AS foreign_draws
        FROM layer_restorations x
        JOIN layer_consumptions c ON c.id = x.consumption_id AND c.org_id = x.org_id
       WHERE x.movement_id = l.return_movement_id AND x.org_id = l.org_id
    ) r ON true
   WHERE l.credit_note_id = NEW.id AND l.org_id = NEW.org_id
     AND (m.kind <> 'return'
          OR m.quantity_minor <> l.quantity_minor
          OR m.base_cost_minor <> l.base_cost_minor
          OR coalesce(r.quantity, 0) <> l.quantity_minor
          OR coalesce(r.base_cost, 0) <> l.base_cost_minor
          OR coalesce(r.foreign_draws, 0) > 0)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'credit note % line % returns % costing %, but its movement and lots say % costing %',
      note.reference, mismatched.line, mismatched.quantity_minor, mismatched.base_cost_minor,
      mismatched.restored_quantity, mismatched.restored_cost
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER credit_notes_agree_with_lines
  AFTER INSERT ON credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obol_check_credit_note_lines();

--> statement-breakpoint
-- The entry a credit note posted cannot be reversed from the journal either.
--
-- Same reasoning as 0026 for the stock records: reversing it there would put
-- the revenue back and leave the credit note claiming it had been taken out,
-- and the next credit note against the invoice would be capped by a credit
-- that no longer exists in the books.
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
  ) OR EXISTS (
    SELECT 1 FROM credit_notes
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
ALTER TABLE credit_notes       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_notes       FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_note_lines  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_note_lines  FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE layer_restorations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE layer_restorations FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY credit_notes_tenant_isolation ON credit_notes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY credit_note_lines_tenant_isolation ON credit_note_lines
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY layer_restorations_tenant_isolation ON layer_restorations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

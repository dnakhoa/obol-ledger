-- Returns to a supplier: sending part of a delivery back, and the debit note
-- that comes with it.
--
-- Until now the only ways stock could leave were a sale and a write-off. A
-- pallet of cracked tiles sent back to the factory was booked as one or the
-- other, and both were wrong: a sale puts it in cost of goods sold, a
-- write-off in a loss, and in both cases the supplier's account went on
-- saying the business owed the full invoice. The payable and the stock only
-- came right with a hand-typed journal entry that moved neither lot.
--
-- A supplier return takes the goods out of the lot they arrived in, at what
-- that lot carries them at, and takes what the supplier gives back off what
-- is owed to them. The two figures are not the same, and the difference is
-- the part of the landed cost — freight, duty, the broker — that nobody
-- refunds. It goes to an expense, named on the return, rather than staying
-- in stock that has left the building.
--
-- See docs/adr/0023-supplier-returns.md.

-- Targets for the composite keys below: a return names a lot of the same item,
-- in the lot's own currency, and a movement of that item. A key is how the
-- database says so, rather than a check somebody has to remember to write.
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_id_org_item_currency_key
  UNIQUE (id, org_id, item_id, currency);

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_id_org_item_key
  UNIQUE (id, org_id, item_id);

--> statement-breakpoint
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IN ('receipt', 'issue', 'writeoff', 'return', 'supplier_return'));

--> statement-breakpoint
CREATE TABLE supplier_returns (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  -- The debit note's number, or the supplier's return authorisation. Unique,
  -- because it is what both sides quote when the credit is taken.
  reference   text NOT NULL,
  item_id     text NOT NULL,
  -- The delivery the goods go back from. One lot per return: a return is
  -- made against a delivery, and the delivery is what the supplier invoiced.
  layer_id    text NOT NULL,
  movement_id text NOT NULL,
  -- Who gives the money back: the supplier's payable, or a bank if they
  -- refund in cash.
  counterparty_account_id text NOT NULL,
  -- Where the carrying cost the refund does not cover goes. Required exactly
  -- when there is some.
  expense_account_id text,
  -- The purchase tax code the refund is reversed under, when it carried one.
  tax_code_id text,
  -- The lot's own currency and rate: the refund undoes part of that purchase,
  -- and at today's rate it would book an exchange difference no money moved
  -- to create.
  currency    char(3) NOT NULL,
  fx_rate     numeric(20, 10) NOT NULL,
  quantity_minor bigint NOT NULL,
  -- What the supplier gives back, net, in the lot's currency.
  refund_minor bigint NOT NULL,
  -- The input tax that comes back out with it.
  tax_minor    bigint NOT NULL DEFAULT 0,
  refund_base_minor bigint NOT NULL,
  tax_base_minor    bigint NOT NULL DEFAULT 0,
  -- What the goods were carried at in the lot, landed cost included.
  carrying_base_minor bigint NOT NULL,
  -- Carrying less refund: the landed cost nobody refunds. Negative when the
  -- supplier gives back more than the goods were carried at.
  unrecovered_base_minor bigint NOT NULL,
  reason      text,
  occurred_at timestamp with time zone NOT NULL,
  transaction_id text NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_layer_fk
  FOREIGN KEY (layer_id, org_id, item_id, currency)
  REFERENCES cost_layers (id, org_id, item_id, currency) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_movement_fk
  FOREIGN KEY (movement_id, org_id, item_id)
  REFERENCES inventory_movements (id, org_id, item_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_counterparty_fk
  FOREIGN KEY (counterparty_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_expense_fk
  FOREIGN KEY (expense_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_tax_code_fk
  FOREIGN KEY (tax_code_id, org_id) REFERENCES tax_codes (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE UNIQUE INDEX supplier_returns_org_reference_key ON supplier_returns (org_id, reference);

--> statement-breakpoint
CREATE UNIQUE INDEX supplier_returns_movement_key ON supplier_returns (movement_id);

--> statement-breakpoint
CREATE INDEX supplier_returns_org_layer_idx ON supplier_returns (org_id, layer_id, occurred_at);

--> statement-breakpoint
CREATE INDEX supplier_returns_org_occurred_idx
  ON supplier_returns (org_id, occurred_at DESC, id DESC);

--> statement-breakpoint
CREATE INDEX supplier_returns_transaction_idx ON supplier_returns (org_id, transaction_id);

--> statement-breakpoint
-- The figures agree with each other. The carrying amount is the refund plus
-- what nobody refunds, to the dong, and a return with something unrefunded
-- says where it went.
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_amounts_check CHECK (
  quantity_minor > 0
  AND refund_minor >= 0
  AND tax_minor >= 0
  AND refund_base_minor >= 0
  AND tax_base_minor >= 0
  AND carrying_base_minor >= 0
  AND carrying_base_minor = refund_base_minor + unrecovered_base_minor
  AND (unrecovered_base_minor = 0 OR expense_account_id IS NOT NULL)
  AND (tax_code_id IS NOT NULL OR (tax_minor = 0 AND tax_base_minor = 0))
);

--> statement-breakpoint
CREATE TRIGGER supplier_returns_append_only
  BEFORE UPDATE OR DELETE ON supplier_returns
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- A lot gives back no more money than was paid for it, and is not returned
-- before it arrived.
--
-- Under a lock on the lot, so two debit notes against one delivery queue here
-- and the second is capped by the first. Quantity needs no check of its own:
-- the draw takes it out of the lot's remainder, and 0017's CHECK refuses a
-- remainder below nothing.
CREATE OR REPLACE FUNCTION obol_check_supplier_return() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lot      cost_layers%ROWTYPE;
  refunded bigint;
BEGIN
  SELECT * INTO lot FROM cost_layers
   WHERE id = NEW.layer_id AND org_id = NEW.org_id
   FOR UPDATE;

  IF NEW.occurred_at < lot.acquired_at THEN
    RAISE EXCEPTION 'supplier return % is dated before the delivery it returns', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(refund_minor), 0) INTO refunded
    FROM supplier_returns
   WHERE layer_id = NEW.layer_id AND org_id = NEW.org_id;

  IF refunded > lot.cost_minor THEN
    RAISE EXCEPTION
      'lot % cost % and supplier returns would refund %; a refund cannot exceed what was paid',
      lot.id, lot.cost_minor, refunded
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER supplier_returns_within_lot
  AFTER INSERT ON supplier_returns
  FOR EACH ROW EXECUTE FUNCTION obol_check_supplier_return();

--> statement-breakpoint
-- The return agrees with the goods that actually left — checked at COMMIT.
--
-- Deferred because the movement and its draw are written before the return
-- that names them. At COMMIT all three are present, and the return's
-- quantity and carrying amount are checked against what the draw took out of
-- the lot, from that lot and no other, in the same entry.
CREATE OR REPLACE FUNCTION obol_check_supplier_return_movement() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  moved inventory_movements%ROWTYPE;
  drawn record;
BEGIN
  SELECT * INTO moved FROM inventory_movements
   WHERE id = NEW.movement_id AND org_id = NEW.org_id;

  SELECT coalesce(sum(quantity_minor), 0) AS quantity,
         coalesce(sum(base_cost_minor), 0) AS base_cost,
         count(*) FILTER (WHERE layer_id <> NEW.layer_id) AS other_lots
    INTO drawn
    FROM layer_consumptions
   WHERE movement_id = NEW.movement_id AND org_id = NEW.org_id;

  IF moved.kind <> 'supplier_return'
     OR moved.transaction_id <> NEW.transaction_id
     OR moved.quantity_minor <> NEW.quantity_minor
     OR moved.base_cost_minor <> NEW.carrying_base_minor
     OR drawn.quantity <> NEW.quantity_minor
     OR drawn.base_cost <> NEW.carrying_base_minor
     OR drawn.other_lots > 0 THEN
    RAISE EXCEPTION
      'supplier return % sends back % carried at %, but its movement and lot say % carried at %',
      NEW.reference, NEW.quantity_minor, NEW.carrying_base_minor, drawn.quantity, drawn.base_cost
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER supplier_returns_agree_with_movement
  AFTER INSERT ON supplier_returns
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obol_check_supplier_return_movement();

--> statement-breakpoint
-- And the other way: goods do not go back to a supplier without a return
-- saying so. A bare movement of that kind would move the lot and the account
-- with nothing recording who owes what for it.
CREATE OR REPLACE FUNCTION obol_check_supplier_return_recorded() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'supplier_return' AND NOT EXISTS (
    SELECT 1 FROM supplier_returns WHERE movement_id = NEW.id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'movement % sends stock back to a supplier with no return recorded', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_movements_supplier_return_recorded
  AFTER INSERT ON inventory_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obol_check_supplier_return_recorded();

--> statement-breakpoint
ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE supplier_returns FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY supplier_returns_tenant_isolation ON supplier_returns
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

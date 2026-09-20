-- Inventory: quantities, cost layers, and the method that chooses between them.
--
-- Until now the ledger had no idea what a *quantity* was. A purchase was money
-- into an inventory account and a shipment was money out, and the money out
-- was whatever the person typing decided it was. The books balanced either
-- way. That is precisely the class of error double entry cannot catch, and
-- precisely the number an importer cares most about — so it is the number that
-- has been living in a spreadsheet with a macro walking the purchase lots.
--
-- See docs/adr/0013-inventory-costing.md.

-- The costing method, on the tenant, beside the chart of accounts — because it
-- is the same shape of decision: partly convention, partly law.
ALTER TABLE organizations ADD COLUMN costing_method text NOT NULL DEFAULT 'fifo';

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_costing_method_check
  CHECK (costing_method IN ('fifo', 'weighted_average', 'specific', 'lifo'));

--> statement-breakpoint
-- The second convention-versus-law case, after Thông tư 200's digit rule.
--
-- LIFO is permitted under US GAAP and *prohibited* under IFRS — and under
-- Vietnamese accounting, where Thông tư 200 does not include it. Offering it
-- to every tenant would be offering some of them a way to produce accounts
-- their auditor must reject, and the difference is not small: on three
-- containers of the same paver bought at rising prices, FIFO and LIFO disagree
-- by 8,600 dollars of profit on a single 1,500-unit shipment.
--
-- So it is unrepresentable rather than discouraged, for the same reason a
-- cross-tenant posting is. A dropdown that merely hides the option is a
-- dropdown, and an INSERT is not obliged to use it.
ALTER TABLE organizations ADD CONSTRAINT organizations_lifo_is_us_only_check
  CHECK (costing_method <> 'lifo' OR chart_template = 'us_gaap');

--> statement-breakpoint
-- Target of the composite key that pins an item's method to a legal one.
ALTER TABLE organizations ADD CONSTRAINT organizations_id_costing_key
  UNIQUE (id, chart_template, costing_method);

--> statement-breakpoint
-- A thing that is bought, held and sold — as distinct from the account it
-- sits in. One inventory account holds many items, which is why the account
-- balance alone can never answer "what did that container cost".
CREATE TABLE inventory_items (
  id         text PRIMARY KEY,
  org_id     text NOT NULL,
  sku        text NOT NULL,
  name       text NOT NULL,
  -- Closed list, matching src/lib/quantity.ts. Free text would make "tonne",
  -- "Tonnes" and "MT" three incompatible units that look identical to the
  -- person typing, and you cannot issue square metres from a layer of tonnes.
  unit       text NOT NULL,
  -- How many decimal places this item's quantities carry. Scaled integers,
  -- for the same reason money is: accumulate a few hundred 24.687-tonne
  -- containers in a float and the on-hand figure drifts from the movements
  -- that produced it, with no way left to find which one caused it.
  quantity_precision integer NOT NULL DEFAULT 0,
  -- Where the stock sits, and where its cost goes when it leaves.
  inventory_account_id text NOT NULL,
  cogs_account_id      text NOT NULL,
  -- NULL means "whatever the organisation uses". Overridable per item because
  -- a business genuinely needs two at once: a granite block is not
  -- interchangeable with another granite block and IAS 2 requires specific
  -- identification for it, while a pallet of 400×400 pavers is interchangeable
  -- and FIFO is right. One column instead of two systems.
  costing_method text,
  -- Carried so the CHECK below can see it; see the identical trick on
  -- accounts.chart_template in 0014.
  chart_template text NOT NULL DEFAULT 'generic',
  status     text NOT NULL DEFAULT 'active',
  metadata   jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
-- The same pin as accounts: an item cannot claim a template or a method its
-- organisation does not have, because there is no row for it to reference.
-- Combined with the CHECK below, an item-level LIFO override on a Vietnamese
-- ledger has nowhere to exist.
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_lifo_is_us_only_check
  CHECK (costing_method IS NULL OR costing_method <> 'lifo' OR chart_template = 'us_gaap');

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_costing_method_check
  CHECK (costing_method IS NULL OR costing_method IN ('fifo', 'weighted_average', 'specific', 'lifo'));

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_status_check
  CHECK (status IN ('active', 'archived'));

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_precision_check
  CHECK (quantity_precision BETWEEN 0 AND 6);

--> statement-breakpoint
-- Tenancy by composite key rather than by WHERE clause, as everywhere else.
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_inventory_account_fk
  FOREIGN KEY (inventory_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_cogs_account_fk
  FOREIGN KEY (cogs_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
CREATE UNIQUE INDEX inventory_items_org_sku_key ON inventory_items (org_id, sku);

--> statement-breakpoint
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE INDEX inventory_items_org_name_idx ON inventory_items (org_id, name);

--> statement-breakpoint
-- A purchase lot: a quantity that arrived at a price, and what is left of it.
CREATE TABLE cost_layers (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  item_id     text NOT NULL,
  -- The ledger entry that brought it in. Nullable only for an opening
  -- balance, where there is no purchase to point at.
  transaction_id text,
  -- What the business calls this lot: a container number, a supplier invoice,
  -- a quarry batch. The thing they will search for.
  reference   text,
  acquired_at timestamp with time zone NOT NULL,
  -- What was actually paid, and in what.
  currency    char(3) NOT NULL,
  fx_rate     numeric(20, 10) NOT NULL DEFAULT 1,
  quantity_minor           bigint NOT NULL,
  remaining_quantity_minor bigint NOT NULL,
  cost_minor               bigint NOT NULL,
  remaining_cost_minor     bigint NOT NULL,
  -- The functional-currency cost, frozen at the rate on the day it arrived.
  -- Inventory is non-monetary (IAS 21), so this figure never moves again even
  -- while the payable that financed it is retranslated every month end. That
  -- asymmetry is described in docs/adr/0012-fx-revaluation.md; this column is
  -- where it lands.
  base_cost_minor          bigint NOT NULL,
  remaining_base_cost_minor bigint NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_item_fk
  FOREIGN KEY (item_id, org_id) REFERENCES inventory_items (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_positive_check
  CHECK (quantity_minor > 0 AND cost_minor >= 0 AND base_cost_minor >= 0);

--> statement-breakpoint
-- What is left is a part of what arrived. Not more, and not less than nothing.
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_remainder_check CHECK (
  remaining_quantity_minor  BETWEEN 0 AND quantity_minor
  AND remaining_cost_minor      BETWEEN 0 AND cost_minor
  AND remaining_base_cost_minor BETWEEN 0 AND base_cost_minor
);

--> statement-breakpoint
-- The spreadsheet's signature failure, made unrepresentable.
--
-- When a lot runs out, its money runs out with it. A sheet that costs issues
-- from a rounded unit price strands a few cents in every exhausted lot, and
-- the inventory account ends up holding stock nobody has — a balance that
-- cannot be counted, reconciled or written off, discovered months later with
-- no movement left to blame.
--
-- The costing module reaches this state by construction: the last draw from a
-- layer takes the whole remainder rather than a computed share. This CHECK is
-- the independent confirmation, because "by construction" is a claim about
-- code, and the code is not the only thing that can write here.
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_empty_is_worthless_check CHECK (
  remaining_quantity_minor > 0
  OR (remaining_cost_minor = 0 AND remaining_base_cost_minor = 0)
);

--> statement-breakpoint
-- The read every allocation makes: open layers for an item, oldest first.
CREATE INDEX cost_layers_open_idx ON cost_layers (org_id, item_id, acquired_at, id)
  WHERE remaining_quantity_minor > 0;

--> statement-breakpoint
CREATE INDEX cost_layers_item_idx ON cost_layers (org_id, item_id, acquired_at DESC);

--> statement-breakpoint
-- Something happened to the stock. Append-only, like postings.
CREATE TABLE inventory_movements (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  item_id     text NOT NULL,
  kind        text NOT NULL,
  quantity_minor  bigint NOT NULL,
  cost_minor      bigint NOT NULL,
  base_cost_minor bigint NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  -- The entry this movement generated. Every movement posts one: the point of
  -- the exercise is that the cost of goods sold goes through the ordinary
  -- journal, and so obeys the balance rule and the period lock like anything
  -- else. Nothing here is exempt from the rules that make the rest credible.
  transaction_id text NOT NULL,
  -- For a receipt, the layer it opened.
  layer_id    text,
  -- The method in force when this happened, recorded rather than looked up.
  -- A tenant that changes method must not have its history reinterpreted: what
  -- last year's shipments cost is a fact about last year.
  costing_method text NOT NULL,
  reference   text,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IN ('receipt', 'issue', 'writeoff'));

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_quantity_check
  CHECK (quantity_minor > 0);

--> statement-breakpoint
-- A receipt opens exactly one layer; an issue opens none and consumes many.
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_layer_check
  CHECK ((kind = 'receipt') = (layer_id IS NOT NULL));

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_item_fk
  FOREIGN KEY (item_id, org_id) REFERENCES inventory_items (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_layer_fk
  FOREIGN KEY (layer_id, org_id) REFERENCES cost_layers (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE INDEX inventory_movements_item_idx
  ON inventory_movements (org_id, item_id, occurred_at DESC, id DESC);

--> statement-breakpoint
-- Which lots a movement ate. This table is the answer to "which container did
-- this shipment come from", which is the question the spreadsheet existed to
-- answer and the one an accounting package normally cannot.
CREATE TABLE layer_consumptions (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  movement_id text NOT NULL,
  layer_id    text NOT NULL,
  quantity_minor  bigint NOT NULL,
  cost_minor      bigint NOT NULL,
  base_cost_minor bigint NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE layer_consumptions ADD CONSTRAINT layer_consumptions_movement_fk
  FOREIGN KEY (movement_id, org_id) REFERENCES inventory_movements (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE layer_consumptions ADD CONSTRAINT layer_consumptions_layer_fk
  FOREIGN KEY (layer_id, org_id) REFERENCES cost_layers (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE layer_consumptions ADD CONSTRAINT layer_consumptions_quantity_check
  CHECK (quantity_minor > 0);

--> statement-breakpoint
-- One row per layer per movement: a movement that drew from the same lot twice
-- is a movement whose arithmetic was done twice, which is how a double count
-- gets in.
CREATE UNIQUE INDEX layer_consumptions_movement_layer_key
  ON layer_consumptions (movement_id, layer_id);

--> statement-breakpoint
CREATE INDEX layer_consumptions_layer_idx ON layer_consumptions (org_id, layer_id);

--> statement-breakpoint
-- A movement is history, so it is append-only for the same reason a posting
-- is: correcting one is a reversing movement, not an edit. Cost layers are
-- deliberately *not* append-only — a layer's remainder is the one thing that
-- legitimately changes, and it is the only one.
CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER layer_consumptions_append_only
  BEFORE UPDATE OR DELETE ON layer_consumptions
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- The template is derived, not supplied — same argument as 0014's trigger on
-- accounts. An insert path that forgot to copy it would fail the composite
-- key with an error that says nothing about charts of accounts.
CREATE OR REPLACE FUNCTION obol_set_item_chart_template() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT chart_template INTO NEW.chart_template
    FROM organizations WHERE id = NEW.org_id;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER inventory_items_set_chart_template
  BEFORE INSERT OR UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION obol_set_item_chart_template();

--> statement-breakpoint
ALTER TABLE inventory_items     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inventory_items     FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cost_layers         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cost_layers         FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inventory_movements FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE layer_consumptions  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE layer_consumptions  FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY inventory_items_tenant_isolation ON inventory_items
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY cost_layers_tenant_isolation ON cost_layers
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY inventory_movements_tenant_isolation ON inventory_movements
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY layer_consumptions_tenant_isolation ON layer_consumptions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

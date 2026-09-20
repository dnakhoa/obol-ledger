-- What the stone actually cost to get here.
--
-- A supplier invoice is not the cost of imported goods. IAS 2 puts the cost of
-- purchase at the price *plus* import duties and other non-recoverable taxes,
-- plus transport, handling, and anything else directly attributable to getting
-- the goods where they are. Ocean freight, customs duty, the broker's fee and
-- inland haulage all belong in the value of the stock in the yard — not in
-- this month's expenses.
--
-- Booking them as expenses understates inventory, overstates the period's
-- costs, and makes every subsequent cost of goods sold wrong by the same
-- margin. On a container of stone that margin runs to a fifth of the invoice.
--
-- Neither Xero nor QuickBooks Online does this natively; importers do it in a
-- spreadsheet beside the accounts and type the answer back in. That is the
-- same spreadsheet migration 0017 was written against.
--
-- See docs/adr/0015-landed-cost.md.

-- A shipment: the lots that arrived together, and the charges that attach to
-- them. `reference` is what the business already calls it — a bill of lading,
-- a container number, a customs declaration.
CREATE TABLE shipments (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  reference   text NOT NULL,
  arrived_at  timestamp with time zone NOT NULL,
  notes       text,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE shipments ADD CONSTRAINT shipments_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE shipments ADD CONSTRAINT shipments_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE UNIQUE INDEX shipments_org_reference_key ON shipments (org_id, reference);

--> statement-breakpoint
CREATE INDEX shipments_org_arrived_idx ON shipments (org_id, arrived_at DESC);

--> statement-breakpoint
-- Nullable: every lot that exists today arrived without one, and a lot bought
-- from a local quarry legitimately has no shipment behind it.
ALTER TABLE cost_layers ADD COLUMN shipment_id text;

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_shipment_fk
  FOREIGN KEY (shipment_id, org_id) REFERENCES shipments (id, org_id) ON DELETE restrict;

--> statement-breakpoint
CREATE INDEX cost_layers_shipment_idx ON cost_layers (org_id, shipment_id)
  WHERE shipment_id IS NOT NULL;

--> statement-breakpoint
-- Grams, so a tonne is 1,000,000 and nothing is lost to a float. Nullable
-- because most stock is never weighed; a charge apportioned by weight refuses
-- rather than treating an unweighed lot as weightless.
ALTER TABLE cost_layers ADD COLUMN weight_grams bigint;

--> statement-breakpoint
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_weight_check
  CHECK (weight_grams IS NULL OR weight_grams >= 0);

--> statement-breakpoint
-- One charge on one shipment: a freight invoice, a duty assessment, a broker's
-- fee. Append-only, like every other record of something that happened.
CREATE TABLE landed_cost_charges (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  shipment_id   text NOT NULL,
  kind          text NOT NULL,
  description   text NOT NULL,
  -- What was billed, in the currency it was billed in. Ocean freight is often
  -- quoted in dollars against books kept in dong.
  amount_minor  bigint NOT NULL,
  currency      char(3) NOT NULL,
  fx_rate       numeric(20, 10) NOT NULL DEFAULT 1,
  -- The same charge in the books' own currency, which is what the lots carry
  -- and therefore the only unit the apportionment can work in.
  base_amount_minor bigint NOT NULL,
  basis         text NOT NULL,
  /*
   * Whether this charge belongs in the cost of the goods.
   *
   * Recoverable import VAT does not: it is reclaimed from the revenue
   * authority, so it never was a cost, and IAS 2 excludes taxes "subsequently
   * recoverable by the entity". Customs duty is not recoverable and does
   * capitalise. Getting these two the wrong way round is the single most
   * common landed-cost mistake, so the distinction is a column rather than
   * something inferred from the account somebody picked.
   */
  capitalise    boolean NOT NULL DEFAULT true,
  -- Where a non-capitalising charge is debited instead: the input-tax asset.
  debit_account_id text,
  -- What the apportionment actually did.
  to_inventory_minor bigint NOT NULL DEFAULT 0,
  to_cogs_minor      bigint NOT NULL DEFAULT 0,
  transaction_id text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_shipment_fk
  FOREIGN KEY (shipment_id, org_id) REFERENCES shipments (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_debit_account_fk
  FOREIGN KEY (debit_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_kind_check
  CHECK (kind IN ('freight', 'duty', 'insurance', 'handling', 'tax', 'other'));

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_basis_check
  CHECK (basis IN ('value', 'quantity', 'weight'));

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_positive_check
  CHECK (amount_minor > 0 AND base_amount_minor > 0);

--> statement-breakpoint
-- The reconciliation invariant, in the database.
--
-- A capitalising charge is split between stock still held and stock already
-- sold, and the two halves must add back up to the charge. A freight invoice
-- that does not reconcile to the sum of what it was spread over is a freight
-- invoice somebody spends an afternoon on — and the arithmetic that produces
-- it is not the only thing that can write here.
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_reconciles_check CHECK (
  CASE
    WHEN capitalise THEN to_inventory_minor + to_cogs_minor = base_amount_minor
                          AND debit_account_id IS NULL
    -- A charge that is not part of the cost of the goods allocates nothing to
    -- them, and needs somewhere of its own to be debited.
    ELSE to_inventory_minor = 0 AND to_cogs_minor = 0 AND debit_account_id IS NOT NULL
  END
);

--> statement-breakpoint
ALTER TABLE landed_cost_charges ADD CONSTRAINT landed_cost_charges_split_check
  CHECK (to_inventory_minor >= 0 AND to_cogs_minor >= 0);

--> statement-breakpoint
CREATE INDEX landed_cost_charges_shipment_idx
  ON landed_cost_charges (org_id, shipment_id, created_at);

--> statement-breakpoint
-- Which lots a charge landed on, and how much each took. The answer to "why is
-- this container carried at more than we paid for it", which is the question
-- the spreadsheet was keeping.
CREATE TABLE landed_cost_allocations (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  charge_id     text NOT NULL,
  layer_id      text NOT NULL,
  amount_minor       bigint NOT NULL,
  to_inventory_minor bigint NOT NULL,
  to_cogs_minor      bigint NOT NULL,
  created_at    timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE landed_cost_allocations ADD CONSTRAINT landed_cost_allocations_charge_fk
  FOREIGN KEY (charge_id, org_id) REFERENCES landed_cost_charges (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE landed_cost_allocations ADD CONSTRAINT landed_cost_allocations_layer_fk
  FOREIGN KEY (layer_id, org_id) REFERENCES cost_layers (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE landed_cost_allocations ADD CONSTRAINT landed_cost_allocations_splits_check
  CHECK (to_inventory_minor + to_cogs_minor = amount_minor);

--> statement-breakpoint
-- One row per lot per charge: a charge that landed on the same lot twice is a
-- charge whose arithmetic ran twice.
CREATE UNIQUE INDEX landed_cost_allocations_charge_layer_key
  ON landed_cost_allocations (charge_id, layer_id);

--> statement-breakpoint
CREATE INDEX landed_cost_allocations_layer_idx ON landed_cost_allocations (org_id, layer_id);

--> statement-breakpoint
CREATE TRIGGER landed_cost_charges_append_only
  BEFORE UPDATE OR DELETE ON landed_cost_charges
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
CREATE TRIGGER landed_cost_allocations_append_only
  BEFORE UPDATE OR DELETE ON landed_cost_allocations
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
ALTER TABLE shipments              ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shipments              FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE landed_cost_charges    ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE landed_cost_charges    FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE landed_cost_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE landed_cost_allocations FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY shipments_tenant_isolation ON shipments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY landed_cost_charges_tenant_isolation ON landed_cost_charges
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY landed_cost_allocations_tenant_isolation ON landed_cost_allocations
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

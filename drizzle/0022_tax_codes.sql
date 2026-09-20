-- Consumption tax, which is three different mechanisms wearing one name.
--
-- Modelling them as one rate with one account is wrong in a way that only
-- surfaces when somebody tries to file a return, and by then a quarter of the
-- entries are wrong.
--
--   * **Value added tax** — Vietnam's GTGT, Japan's 消費税, GST in Australia and
--     New Zealand, VAT across the EU. Tax on a sale is owed to the state, tax
--     on a purchase is reclaimable from it, and what is remitted is the
--     difference. Two accounts.
--
--   * **Reverse charge** — cross-border business-to-business supply in the EU.
--     The seller charges nothing and the *buyer* books both sides of the same
--     tax, netting to nothing. It is not "no tax": both entries appear on the
--     return, and a system that posts neither cannot produce one.
--
--   * **Sales tax** — the United States. Collected on a sale and remitted;
--     tax paid on a purchase is **never reclaimable** and is simply part of
--     what the thing cost.
--
-- That last asymmetry is already in the chart of accounts — migration 0016
-- ships the US chart with a sales-tax payable and deliberately no input-tax
-- asset — and the CHECK below makes it structural rather than a convention of
-- the seed data.
--
-- See docs/adr/0016-consumption-tax.md.

CREATE TABLE tax_codes (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  name        text NOT NULL,
  -- Basis points: 10% is 1000 and 8.25% is 825. A percentage that has to
  -- survive a multiplication has no business being a float.
  rate_basis_points integer NOT NULL,
  treatment   text NOT NULL,
  -- Reclaimable tax paid on purchases.
  input_account_id  text,
  -- Tax charged on sales and owed to the state.
  output_account_id text,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_input_account_fk
  FOREIGN KEY (input_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_output_account_fk
  FOREIGN KEY (output_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
CREATE UNIQUE INDEX tax_codes_org_name_key ON tax_codes (org_id, name);

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_treatment_check
  CHECK (treatment IN ('vat', 'reverse_charge', 'sales_tax'));

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_rate_check
  CHECK (rate_basis_points >= 0 AND rate_basis_points <= 10000);

--> statement-breakpoint
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_status_check
  CHECK (status IN ('active', 'archived'));

--> statement-breakpoint
-- What each mechanism needs, and what it must not have.
--
-- The sales-tax clause is the one that matters. A US business given an
-- input-tax account accumulates a receivable from a state that does not owe
-- it — and nothing else in the ledger ever objects, because the accounts
-- balance perfectly while the asset is fictional. It is exactly the kind of
-- error double entry cannot catch, so it is made unrepresentable instead.
ALTER TABLE tax_codes ADD CONSTRAINT tax_codes_accounts_check CHECK (
  CASE treatment
    -- Charged on sales, reclaimed on purchases: both sides exist.
    WHEN 'vat' THEN input_account_id IS NOT NULL AND output_account_id IS NOT NULL
    -- The buyer books both halves of the same tax, so it needs both.
    WHEN 'reverse_charge' THEN input_account_id IS NOT NULL AND output_account_id IS NOT NULL
    -- Never reclaimable. There is nothing for an input account to hold.
    WHEN 'sales_tax' THEN input_account_id IS NULL AND output_account_id IS NOT NULL
    ELSE false
  END
);

--> statement-breakpoint
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_codes FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY tax_codes_tenant_isolation ON tax_codes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

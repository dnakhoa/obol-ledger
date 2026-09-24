-- A sale: the invoice and the stock that left, as one record.
--
-- Until now the two halves of selling something were unrelated. The invoice
-- was a hand-typed journal entry — receivable against revenue — and the stock
-- leaving was a separate movement that posted the cost of goods sold. Both
-- balanced. Neither knew about the other, so the one question a distributor
-- asks of every invoice — what did we make on it? — had no answer anywhere in
-- the ledger. Revenue sat in one account, cost in another, and the margin on
-- INV-2607 was a VLOOKUP between two exports.
--
-- A sale is one entry with both halves in it, and a row that says which
-- movements it shipped and what each line was sold for. Margin by invoice, by
-- product and by customer becomes a GROUP BY over facts the ledger already
-- holds, rather than a reconciliation between two systems that were never
-- told they describe the same event.
--
-- See docs/adr/0018-sales-and-margin.md.

CREATE TABLE sales (
  id          text PRIMARY KEY,
  org_id      text NOT NULL,
  -- The invoice number. What the customer quotes when they pay, and what the
  -- aged receivables report shows beside each open item.
  reference   text NOT NULL,
  -- The customer's receivable account. One account per customer is how
  -- Thông tư 200 keeps 131 (a detail ledger per đối tượng), and it is what
  -- lets margin be reported per customer without a separate customer table
  -- that could disagree with the accounts.
  customer_account_id text NOT NULL,
  revenue_account_id  text NOT NULL,
  tax_code_id text,
  -- What was invoiced, in the currency it was invoiced in. An exporter
  -- invoices in the buyer's money.
  currency    char(3) NOT NULL,
  fx_rate     numeric(20, 10) NOT NULL DEFAULT 1,
  net_minor   bigint NOT NULL,
  tax_minor   bigint NOT NULL,
  gross_minor bigint NOT NULL,
  -- The same figures in the books' own currency, at the rate on the day, and
  -- the cost of what shipped — which is only ever in the books' currency,
  -- because it came off lots that were frozen at their own historical rate.
  base_net_minor  bigint NOT NULL,
  base_tax_minor  bigint NOT NULL,
  base_cost_minor bigint NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  -- When the customer has agreed to pay. Absent means "on receipt". The aged
  -- receivables report counts from here rather than from the invoice date,
  -- because on sixty-day terms an invoice that is forty days old is not late.
  due_on      date,
  transaction_id text NOT NULL,
  metadata    jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at  timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_customer_account_fk
  FOREIGN KEY (customer_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_revenue_account_fk
  FOREIGN KEY (revenue_account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_tax_code_fk
  FOREIGN KEY (tax_code_id, org_id) REFERENCES tax_codes (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
-- An invoice number is issued once. Two invoices with the same number are how
-- a customer pays one and the aged report shows the other as unpaid forever.
CREATE UNIQUE INDEX sales_org_reference_key ON sales (org_id, reference);

--> statement-breakpoint
CREATE INDEX sales_org_occurred_idx ON sales (org_id, occurred_at DESC, id DESC);

--> statement-breakpoint
CREATE INDEX sales_org_customer_idx ON sales (org_id, customer_account_id, occurred_at);

--> statement-breakpoint
CREATE INDEX sales_transaction_idx ON sales (org_id, transaction_id);

--> statement-breakpoint
ALTER TABLE sales ADD CONSTRAINT sales_amounts_check CHECK (
  net_minor > 0
  AND tax_minor >= 0
  AND gross_minor = net_minor + tax_minor
  AND base_net_minor >= 0
  AND base_tax_minor >= 0
  AND base_cost_minor >= 0
);

--> statement-breakpoint
-- Terms run forward. A due date before the invoice is a typo in the year, and
-- it would age a brand-new invoice as months overdue.
ALTER TABLE sales ADD CONSTRAINT sales_due_after_invoice_check
  CHECK (due_on IS NULL OR due_on >= (occurred_at AT TIME ZONE 'UTC')::date);

--> statement-breakpoint
-- The lines. A sale's lines *are* its stock movements: each is an issue that
-- also carries what it was sold for, so the cost and the price of one line sit
-- on one row and the margin on it is a subtraction.
ALTER TABLE inventory_movements ADD COLUMN sale_id text;

--> statement-breakpoint
-- The line's net price in the books' own currency. Stored rather than derived
-- from the sale's rate, because apportioning an invoice total across its
-- lines is a rounding decision and it is made exactly once.
ALTER TABLE inventory_movements ADD COLUMN revenue_base_minor bigint;

--> statement-breakpoint
-- Where the line sits on the invoice. An invoice is a printed document whose
-- lines a customer reconciles against a delivery note in order, and ids —
-- random within a millisecond — do not keep one.
ALTER TABLE inventory_movements ADD COLUMN sale_line integer;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_sale_fk
  FOREIGN KEY (sale_id, org_id) REFERENCES sales (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_sale_line_check CHECK (
  (sale_id IS NULL) = (revenue_base_minor IS NULL)
  AND (sale_id IS NULL) = (sale_line IS NULL)
  AND (sale_id IS NULL OR (kind = 'issue' AND revenue_base_minor >= 0 AND sale_line >= 1))
);

--> statement-breakpoint
CREATE UNIQUE INDEX inventory_movements_sale_line_key ON inventory_movements (org_id, sale_id, sale_line)
  WHERE sale_id IS NOT NULL;

--> statement-breakpoint
-- A sale is history. A wrong invoice is corrected by a credit note, which is
-- a further record, not an edit to this one.
CREATE TRIGGER sales_append_only
  BEFORE UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- The header agrees with its lines, checked at COMMIT.
--
-- Deferred for the same reason the balance rule is: the header is written
-- first so the lines can reference it, and at that moment it has no lines at
-- all. An immediate check would refuse every sale ever made.
--
-- What it asserts is the thing a margin report silently depends on. If the
-- invoice's net revenue and the sum of its lines disagree, then margin by
-- invoice and margin by product are computed from different totals, and the
-- two reports — both of which balance — stop adding up to each other.
CREATE OR REPLACE FUNCTION obol_check_sale_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  line_count   bigint;
  line_revenue bigint;
  line_cost    bigint;
  sale_row     sales%ROWTYPE;
BEGIN
  SELECT * INTO sale_row FROM sales WHERE id = NEW.id;

  SELECT count(*), coalesce(sum(revenue_base_minor), 0), coalesce(sum(base_cost_minor), 0)
    INTO line_count, line_revenue, line_cost
    FROM inventory_movements
   WHERE sale_id = NEW.id AND org_id = NEW.org_id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'sale % has no lines', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF line_revenue <> sale_row.base_net_minor OR line_cost <> sale_row.base_cost_minor THEN
    RAISE EXCEPTION
      'sale % does not agree with its lines: revenue % against %, cost % against %',
      NEW.reference, sale_row.base_net_minor, line_revenue, sale_row.base_cost_minor, line_cost
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint
CREATE CONSTRAINT TRIGGER sales_agree_with_lines
  AFTER INSERT ON sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION obol_check_sale_lines();

--> statement-breakpoint
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sales FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY sales_tenant_isolation ON sales
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- Filing a consumption tax return, which is a journal entry and not a report.
--
-- Migration 0022 made the three mechanisms postable. This is what happens at
-- the end of the period: the output-tax account has been accumulating a
-- liability and the input-tax account a receivable, and filing settles them
-- against each other and leaves whichever remains.
--
-- The remainder is the part worth modelling. When input tax exceeds output
-- tax the difference is not, in most systems, a refund — it is a credit
-- carried into the next period. That makes a run of returns a *chain*: this
-- period's opening credit is last period's closing credit, and a gap in the
-- chain is a figure nobody can reconcile.
--
-- See docs/adr/0017-tax-returns.md.

-- What tax a particular entry attracted.
--
-- Without this a return could only be derived from the balance of the tax
-- accounts, which cannot say *which rate* or *which mechanism* produced it —
-- and every form on earth asks for the split. Append-only, like every other
-- record of something that happened.
CREATE TABLE tax_entries (
  id             text PRIMARY KEY,
  org_id         text NOT NULL,
  transaction_id text NOT NULL,
  tax_code_id    text NOT NULL,
  supply         text NOT NULL,
  -- The amount before tax. Forms ask for it beside the tax, and it cannot be
  -- recovered from the tax alone once two rates are in play.
  base_minor     bigint NOT NULL,
  tax_minor      bigint NOT NULL,
  occurred_at    timestamp with time zone NOT NULL,
  created_at     timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE tax_entries ADD CONSTRAINT tax_entries_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_entries ADD CONSTRAINT tax_entries_code_fk
  FOREIGN KEY (tax_code_id, org_id) REFERENCES tax_codes (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_entries ADD CONSTRAINT tax_entries_supply_check
  CHECK (supply IN ('sale', 'purchase'));

--> statement-breakpoint
ALTER TABLE tax_entries ADD CONSTRAINT tax_entries_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
-- The read a return makes: everything in a date window, oldest first.
CREATE INDEX tax_entries_period_idx ON tax_entries (org_id, occurred_at, id);

--> statement-breakpoint
-- A filed return.
CREATE TABLE tax_returns (
  id             text PRIMARY KEY,
  org_id         text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  output_tax_minor       bigint NOT NULL,
  input_tax_minor        bigint NOT NULL,
  brought_forward_minor  bigint NOT NULL DEFAULT 0,
  payable_minor          bigint NOT NULL,
  carried_forward_minor  bigint NOT NULL DEFAULT 0,
  -- The entry that cleared the tax accounts, when there was one.
  --
  -- Nullable, because a period that bought and sold nothing taxable on the
  -- output side has nothing to clear: no output tax means no debit, and
  -- crediting the input account would be claiming a refund. The return is
  -- still a return — it claims the months and sets the credit the next one
  -- opens with — it just moves nothing between accounts.
  transaction_id text,
  filed_at       timestamp with time zone DEFAULT now() NOT NULL,
  -- What the return was filed against, kept because a return is evidence and
  -- the person who filed it is part of it.
  filed_by       text
);

--> statement-breakpoint
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_transaction_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_window_check
  CHECK (period_end >= period_start);

--> statement-breakpoint
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_signs_check
  CHECK (
    output_tax_minor >= 0
    AND input_tax_minor >= 0
    AND brought_forward_minor >= 0
    AND payable_minor >= 0
    AND carried_forward_minor >= 0
  );

--> statement-breakpoint
-- A return either pays something or carries something on, never both.
--
-- They are the two halves of one subtraction, so a row with both non-zero is
-- a row where the arithmetic was done twice — and, like a lot with money left
-- in it after the stock has gone, it would balance perfectly while being
-- wrong.
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_one_way_check
  CHECK (payable_minor = 0 OR carried_forward_minor = 0);

--> statement-breakpoint
-- The chain, as arithmetic the database can check on one row:
--   output  =  (input + brought forward)  -  carried forward  +  payable
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_reconciles_check CHECK (
  output_tax_minor
    = input_tax_minor + brought_forward_minor - carried_forward_minor + payable_minor
);

--> statement-breakpoint
CREATE INDEX tax_returns_org_period_idx ON tax_returns (org_id, period_start DESC);

--> statement-breakpoint
-- Which months a return covers.
--
-- A separate table rather than a date range, because the invariant worth
-- having is "a month is filed at most once" — and as a row that is a plain
-- unique index. An overlapping return is then not rejected by a check; it has
-- nowhere to exist.
--
-- It also handles monthly and quarterly filing without knowing which is which:
-- a quarter is a return that owns three months.
CREATE TABLE tax_return_months (
  id           text PRIMARY KEY,
  org_id       text NOT NULL,
  return_id    text NOT NULL,
  period_month date NOT NULL
);

--> statement-breakpoint
ALTER TABLE tax_return_months ADD CONSTRAINT tax_return_months_return_fk
  FOREIGN KEY (return_id, org_id) REFERENCES tax_returns (id, org_id) ON DELETE restrict;

--> statement-breakpoint
-- The invariant. One month, one return, for ever.
CREATE UNIQUE INDEX tax_return_months_org_month_key ON tax_return_months (org_id, period_month);

--> statement-breakpoint
ALTER TABLE tax_return_months ADD CONSTRAINT tax_return_months_first_of_month_check
  CHECK (date_trunc('month', period_month) = period_month);

--> statement-breakpoint
CREATE TRIGGER tax_entries_append_only
  BEFORE UPDATE OR DELETE ON tax_entries
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- A filed return is evidence. Correcting one is an amended return, which is a
-- new row and a new entry, never an edit of this one.
CREATE TRIGGER tax_returns_append_only
  BEFORE UPDATE OR DELETE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
ALTER TABLE tax_entries       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_entries       FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_returns       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_returns       FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_return_months ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_return_months FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY tax_entries_tenant_isolation ON tax_entries
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY tax_returns_tenant_isolation ON tax_returns
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY tax_return_months_tenant_isolation ON tax_return_months
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

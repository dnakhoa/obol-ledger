-- Vietnamese e-invoices: the legal invoice, as the XML the tax authority prescribes.
--
-- Since Nghị định 123/2020 a Vietnamese VAT invoice is an XML document: it
-- names the seller and buyer by tax code, carries a series and a number
-- that run without gaps, and is signed and — for a coded invoice — given a
-- code by the tax authority through a licensed provider. A sale in the books
-- is not yet an invoice in law.
--
-- This stores the document the ledger produces for each sale, and for each
-- credit note the adjustment invoice that corrects the original. Numbers are
-- issued one after another within a series, and the database refuses a gap
-- or a repeat: an invoice number that skips is one a tax inspector asks
-- about. The document is never changed once issued.
--
-- See docs/adr/0027-vietnam-e-invoices.md.

-- Who the seller is, as the invoice must name it.
ALTER TABLE organizations
  ADD COLUMN legal_name text,
  ADD COLUMN tax_id text,
  ADD COLUMN address text,
  -- Mẫu số: "1" for a VAT invoice.
  ADD COLUMN einvoice_template text,
  -- Ký hiệu, e.g. C26TBM: coded, 2026, enterprise, the letters chosen.
  ADD COLUMN einvoice_series text;

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_einvoice_check CHECK (
  (tax_id IS NULL OR tax_id ~ '^[0-9A-Za-z-]{1,20}$')
  AND (einvoice_template IS NULL OR einvoice_template ~ '^[1-6]$')
  AND (einvoice_series IS NULL OR einvoice_series ~ '^[CK][0-9]{2}[TDLMNBGH][A-Z]{2}$')
);

--> statement-breakpoint
-- And who the buyer is: a customer's legal name, tax code and address.
ALTER TABLE accounts
  ADD COLUMN legal_name text,
  ADD COLUMN tax_id text,
  ADD COLUMN address text;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_tax_id_check
  CHECK (tax_id IS NULL OR tax_id ~ '^[0-9A-Za-z-]{1,20}$');

--> statement-breakpoint
CREATE TABLE einvoices (
  id            text PRIMARY KEY,
  org_id        text NOT NULL,
  -- An invoice for a sale, or an adjustment invoice for a credit note.
  kind          text NOT NULL,
  sale_id       text NOT NULL,
  credit_note_id text,
  -- The invoice an adjustment corrects.
  adjusts_id    text,
  template      text NOT NULL,
  series        text NOT NULL,
  number        integer NOT NULL,
  issued_on     date NOT NULL,
  currency      char(3) NOT NULL,
  net_minor     bigint NOT NULL,
  tax_minor     bigint NOT NULL,
  -- The document itself, and its fingerprint, checked against each other.
  xml           text NOT NULL,
  sha256        char(64) NOT NULL,
  issued_by     text,
  created_at    timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE einvoices ADD CONSTRAINT einvoices_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE einvoices ADD CONSTRAINT einvoices_sale_fk
  FOREIGN KEY (sale_id, org_id, currency) REFERENCES sales (id, org_id, currency) ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE einvoices ADD CONSTRAINT einvoices_credit_note_fk
  FOREIGN KEY (credit_note_id, org_id, sale_id) REFERENCES credit_notes (id, org_id, sale_id)
  ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE einvoices ADD CONSTRAINT einvoices_id_org_sale_key UNIQUE (id, org_id, sale_id);

--> statement-breakpoint
-- An adjustment corrects an invoice of the same sale, and nothing else.
ALTER TABLE einvoices ADD CONSTRAINT einvoices_adjusts_fk
  FOREIGN KEY (adjusts_id, org_id, sale_id) REFERENCES einvoices (id, org_id, sale_id)
  ON DELETE restrict;

--> statement-breakpoint
ALTER TABLE einvoices ADD CONSTRAINT einvoices_shape_check CHECK (
  number >= 1
  AND template ~ '^[1-6]$'
  AND series ~ '^[CK][0-9]{2}[TDLMNBGH][A-Z]{2}$'
  -- The series names the year the invoice is issued in.
  AND substring(series from 2 for 2) = lpad((extract(year from issued_on)::int % 100)::text, 2, '0')
  AND sha256 = encode(sha256(convert_to(xml, 'UTF8')), 'hex')
  AND CASE kind
        WHEN 'original' THEN credit_note_id IS NULL AND adjusts_id IS NULL
        WHEN 'adjustment' THEN credit_note_id IS NOT NULL AND adjusts_id IS NOT NULL
        ELSE false
      END
);

--> statement-breakpoint
CREATE UNIQUE INDEX einvoices_number_key ON einvoices (org_id, template, series, number);

--> statement-breakpoint
-- One invoice per sale, one adjustment per credit note.
CREATE UNIQUE INDEX einvoices_sale_original_key ON einvoices (sale_id) WHERE kind = 'original';

--> statement-breakpoint
CREATE UNIQUE INDEX einvoices_credit_note_key ON einvoices (credit_note_id)
  WHERE credit_note_id IS NOT NULL;

--> statement-breakpoint
CREATE INDEX einvoices_org_issued_idx ON einvoices (org_id, issued_on DESC, number DESC);

--> statement-breakpoint
CREATE TRIGGER einvoices_append_only
  BEFORE UPDATE OR DELETE ON einvoices
  FOR EACH ROW EXECUTE FUNCTION obol_reject_mutation();

--> statement-breakpoint
-- Numbers run one after another within a series, from 1, with no gap.
--
-- Under a lock per series, so two invoices issued at the same moment queue
-- here and the second sees the first; the unique index alone would let the
-- second fail rather than take the next number, and a check without the
-- lock would let both read the same maximum.
CREATE OR REPLACE FUNCTION obol_check_einvoice_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('einvoice:' || NEW.org_id || ':' || NEW.template || ':' || NEW.series));
  SELECT max(number) INTO last FROM einvoices
   WHERE org_id = NEW.org_id AND template = NEW.template AND series = NEW.series
     AND id <> NEW.id;
  IF NEW.number <> coalesce(last, 0) + 1 THEN
    RAISE EXCEPTION 'e-invoice % of series % would leave a gap or repeat; the next number is %',
      NEW.number, NEW.series, coalesce(last, 0) + 1
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER einvoices_number_in_sequence
  BEFORE INSERT ON einvoices
  FOR EACH ROW EXECUTE FUNCTION obol_check_einvoice_number();

--> statement-breakpoint
ALTER TABLE einvoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE einvoices FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY einvoices_tenant_isolation ON einvoices
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

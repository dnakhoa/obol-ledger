-- Account codes, and the difference between a convention and a law.
--
-- Accountants do not read a chart of accounts by name. They read it by code,
-- in code order, and an account without one is an account they cannot file.
-- Until now this model had names only, and sorted them alphabetically — which
-- is nobody's chart.
--
-- The interesting part is that jurisdictions differ structurally here, not
-- cosmetically.
--
--   * A **conventional** chart — Australia, New Zealand, the US, most of the
--     EU — has no mandated numbering. Xero's own guidance is "choose a
--     numbering system" and leave gaps; two mainstream Australian products
--     ship different defaults. The template is a starting point the tenant
--     edits, and enforcing its shape would be enforcing one vendor's habit as
--     though it were a rule.
--
--   * A **statutory** chart — Vietnam's Thông tư 200/2014/TT-BTC — is law.
--     The codes are prescribed, the leading digit encodes the class, and a
--     business does not get to invent one. The template is a constraint.
--
-- So the constraint has to be conditional on the tenant's template, and a
-- CHECK cannot read another table. Rather than reach for a trigger, the
-- template is carried onto the account row and pinned there by a composite
-- foreign key — the same technique that already makes a cross-currency
-- posting and a cross-tenant posting unrepresentable. An account whose
-- template disagrees with its organisation's has no row to point at.
--
-- See docs/adr/0011-chart-of-accounts.md.

ALTER TABLE organizations ADD COLUMN chart_template text NOT NULL DEFAULT 'generic';

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_chart_template_check
  CHECK (chart_template IN ('generic', 'au_nz', 'vn_tt200'));

--> statement-breakpoint
-- The target of the composite key below.
ALTER TABLE organizations ADD CONSTRAINT organizations_id_template_key
  UNIQUE (id, chart_template);

--> statement-breakpoint
ALTER TABLE accounts ADD COLUMN code text;

--> statement-breakpoint
-- Nullable, deliberately.
--
-- Every account that exists today has no code, and a conventional-chart tenant
-- may genuinely not want one — a sole trader with eleven accounts reads them
-- by name perfectly well. Requiring a code would mean inventing one for
-- history, which is the same class of mistake as inventing a historical
-- exchange rate.
--
-- A statutory chart is different, and the CHECK further down says so.
ALTER TABLE accounts ADD COLUMN chart_template text NOT NULL DEFAULT 'generic';

--> statement-breakpoint
-- Existing accounts belong to organisations that are all on the default, so
-- this is a no-op today and correct tomorrow.
UPDATE accounts a
   SET chart_template = o.chart_template
  FROM organizations o
 WHERE o.id = a.org_id AND a.chart_template <> o.chart_template;

--> statement-breakpoint
-- The pin. An account cannot claim a template its organisation does not have,
-- because there is no row for it to reference.
ALTER TABLE accounts ADD CONSTRAINT accounts_org_template_fk
  FOREIGN KEY (org_id, chart_template) REFERENCES organizations (id, chart_template)
  ON UPDATE CASCADE;

--> statement-breakpoint
-- A code is digits, and short. Long enough for the five-digit schemes some
-- businesses grow into, bounded so it stays sortable and printable.
ALTER TABLE accounts ADD CONSTRAINT accounts_code_shape_check
  CHECK (code IS NULL OR code ~ '^[0-9]{1,10}$');

--> statement-breakpoint
-- Unique within a tenant, when present.
--
-- A partial index rather than a plain unique constraint, because NULLs are
-- distinct in Postgres but "no code" should not be a value competing for
-- uniqueness — and a tenant with twelve uncoded accounts is a normal state,
-- not eleven violations.
CREATE UNIQUE INDEX accounts_org_code_key ON accounts (org_id, code) WHERE code IS NOT NULL;

--> statement-breakpoint
-- The chart is read in code order, so it is indexed in code order.
CREATE INDEX accounts_org_code_idx ON accounts (org_id, code);

--> statement-breakpoint
-- The statutory rule.
--
-- Under Thông tư 200 the leading digit *is* the account class: 1 and 2 are
-- assets, 3 liabilities, 4 equity, 5 and 7 revenue, 6 and 8 expenses. A
-- statutory tenant must give every account a code, and the digit must agree
-- with the type.
--
-- Class 9 is deliberately absent. 911 (xác định kết quả kinh doanh) is a
-- clearing account that exists only for the duration of a period close and
-- holds nothing outside it; this model closes revenue and expense straight
-- into retained earnings and never materialises the intermediate. That is a
-- real divergence from the circular's mechanics, and it is written down in
-- the ADR rather than papered over by inventing a sixth account type.
ALTER TABLE accounts ADD CONSTRAINT accounts_statutory_code_check CHECK (
  chart_template <> 'vn_tt200'
  OR (
    code IS NOT NULL
    AND (
      (left(code, 1) IN ('1', '2') AND type = 'asset')
      OR (left(code, 1) = '3' AND type = 'liability')
      OR (left(code, 1) = '4' AND type = 'equity')
      OR (left(code, 1) IN ('5', '7') AND type = 'revenue')
      OR (left(code, 1) IN ('6', '8') AND type = 'expense')
    )
  )
);

--> statement-breakpoint
-- The template is derived, not supplied.
--
-- Leaving it to the application would mean every insert path had to remember
-- to copy it from the organisation, and the one that forgot would create an
-- account the composite key rejects with a foreign-key error that says
-- nothing about charts of accounts. Filling it here means the column cannot
-- be wrong, and the key below is what keeps it in step if an organisation
-- ever changes template.
CREATE OR REPLACE FUNCTION obol_set_account_chart_template() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT chart_template INTO NEW.chart_template
    FROM organizations WHERE id = NEW.org_id;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER accounts_set_chart_template
  BEFORE INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION obol_set_account_chart_template();

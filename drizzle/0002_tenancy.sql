-- Multi-tenancy, enforced by Postgres rather than by remembering a WHERE clause.
--
-- Tenant isolation is the rule an application is most likely to forget: one
-- missing predicate on one query and a tenant reads another tenant's ledger.
-- That is the same argument that put the balance rule in a constraint trigger,
-- so isolation goes to the same place — row-level security policies that apply
-- to every statement, including ones this application never wrote.

CREATE TABLE organizations (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- API keys are stored as a SHA-256 digest, never in the clear. A leaked
-- database backup then yields no usable credential, and the lookup is still a
-- single indexed probe because the digest is what we search by.
CREATE TABLE api_keys (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE restrict,
  name         text NOT NULL,
  token_digest text NOT NULL UNIQUE,
  created_at   timestamp with time zone DEFAULT now() NOT NULL,
  last_used_at timestamp with time zone,
  revoked_at   timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX api_keys_org_id_idx ON api_keys USING btree (org_id);

--> statement-breakpoint
-- Every existing row belongs to the demo tenant. Backfilling before the column
-- is made NOT NULL is what lets this migration run against a populated
-- database without a maintenance window.
INSERT INTO organizations (id, name, slug)
VALUES ('org_00000000000000000000000000', 'Demo Roastery', 'demo');

--> statement-breakpoint
ALTER TABLE accounts          ADD COLUMN org_id text;
--> statement-breakpoint
ALTER TABLE transactions      ADD COLUMN org_id text;
--> statement-breakpoint
ALTER TABLE postings          ADD COLUMN org_id text;
--> statement-breakpoint
ALTER TABLE idempotency_keys  ADD COLUMN org_id text;

--> statement-breakpoint
UPDATE accounts         SET org_id = 'org_00000000000000000000000000' WHERE org_id IS NULL;
--> statement-breakpoint
UPDATE transactions     SET org_id = 'org_00000000000000000000000000' WHERE org_id IS NULL;
--> statement-breakpoint
UPDATE postings         SET org_id = 'org_00000000000000000000000000' WHERE org_id IS NULL;
--> statement-breakpoint
UPDATE idempotency_keys SET org_id = 'org_00000000000000000000000000' WHERE org_id IS NULL;

--> statement-breakpoint
ALTER TABLE accounts         ALTER COLUMN org_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE transactions     ALTER COLUMN org_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE postings         ALTER COLUMN org_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE idempotency_keys ALTER COLUMN org_id SET NOT NULL;

--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE postings ADD CONSTRAINT postings_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_org_fk
  FOREIGN KEY (org_id) REFERENCES organizations (id) ON DELETE restrict;

--> statement-breakpoint
-- Uniqueness becomes per-tenant. Two businesses may both keep an account
-- called "Operating Cash"; a globally unique name would make the second
-- tenant's onboarding fail for a reason that is none of their business.
ALTER TABLE accounts DROP CONSTRAINT accounts_name_currency_key;
--> statement-breakpoint
ALTER TABLE accounts ADD CONSTRAINT accounts_org_name_currency_key
  UNIQUE (org_id, name, currency);

--> statement-breakpoint
-- The same applies to idempotency keys: two tenants choosing the same UUID
-- must not collide, and one must never replay the other's stored response.
ALTER TABLE idempotency_keys DROP CONSTRAINT idempotency_keys_pkey;
--> statement-breakpoint
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_pkey
  PRIMARY KEY (org_id, key);

--> statement-breakpoint
-- Indexes that serve tenant-scoped reads. Every query now carries an org
-- predicate from the RLS policy, so org_id belongs at the front of the key.
CREATE INDEX accounts_org_idx ON accounts USING btree (org_id, name);
--> statement-breakpoint
CREATE INDEX transactions_org_occurred_idx
  ON transactions USING btree (org_id, occurred_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX postings_org_account_idx ON postings USING btree (org_id, account_id, id);

--> statement-breakpoint
-- The isolation itself.
--
-- `current_setting('app.current_org', true)` returns NULL when the setting is
-- absent, and `org_id = NULL` is never true — so a connection that forgets to
-- identify its tenant sees an empty database rather than everyone's. Failing
-- closed is the only acceptable default here.
--
-- FORCE is the load-bearing word. Without it, RLS does not apply to the table's
-- owner, and on most managed Postgres the application connects as exactly that
-- owner — leaving policies that look right, tests that pass, and no isolation
-- whatsoever.
ALTER TABLE accounts         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE accounts         FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions     FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE postings         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE postings         FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
-- USING filters what a statement may read; WITH CHECK filters what it may
-- write. Both are needed: USING alone would let a tenant INSERT a row stamped
-- with someone else's org_id, which it could then never see again.
CREATE POLICY accounts_tenant_isolation ON accounts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY transactions_tenant_isolation ON transactions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY postings_tenant_isolation ON postings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant_isolation ON idempotency_keys
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
-- A posting must not be able to reference an account in another tenant. The
-- composite foreign key already pins currency to the account; extending it to
-- org_id makes a cross-tenant posting unrepresentable for the same reason a
-- cross-currency one is — there is no row for it to point at.
ALTER TABLE accounts ADD CONSTRAINT accounts_id_org_key UNIQUE (id, org_id);
--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_id_org_key UNIQUE (id, org_id);
--> statement-breakpoint
ALTER TABLE postings ADD CONSTRAINT postings_account_org_fk
  FOREIGN KEY (account_id, org_id) REFERENCES accounts (id, org_id) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE postings ADD CONSTRAINT postings_transaction_org_fk
  FOREIGN KEY (transaction_id, org_id) REFERENCES transactions (id, org_id) ON DELETE restrict;

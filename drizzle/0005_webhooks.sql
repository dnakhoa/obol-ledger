-- Webhooks: the transactional outbox, and the queue that drains it.
--
-- A ledger nobody can subscribe to is a database with a web page in front of
-- it. Every real one — Stripe, Increase, Modern Treasury — pushes events,
-- because the alternative is every integrator polling, and polling is both
-- slower and more expensive for everyone.
--
-- The hard part is not the HTTP request. It is that the announcement must
-- agree with the ledger. A webhook fired after COMMIT — from a queue client, a
-- background call, a setTimeout — is simply lost if the process dies in the
-- gap, and the subscriber has no way to discover the omission: it never heard
-- about an entry it does not know exists. So the delivery row is written
-- *inside* the same transaction as the entry that caused it. Either both are
-- durable or neither is, and the outbox cannot disagree with the books.
--
-- That inverts the failure mode into one the receiver can survive. Deliveries
-- are at-least-once rather than at-most-once: a duplicate is possible, a
-- silent omission is not. Every delivery carries a stable event id so the
-- receiver can deduplicate.

CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'succeeded', 'failed');

--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "url" text NOT NULL,
  "description" text,
  "secret" text NOT NULL,
  "event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_endpoints_org_url_key" UNIQUE("org_id","url")
);

--> statement-breakpoint
-- Deliveries are only ever sent over TLS. An unsigned request to plain HTTP
-- can be read and rewritten in flight, and a signature does not help a
-- subscriber who never receives the real one. Refusing at the schema level
-- means no code path can register a plaintext endpoint by accident.
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_https_check
  CHECK (url LIKE 'https://%');

--> statement-breakpoint
-- The subscription list is a JSON array of strings, not of anything.
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_event_types_check
  CHECK (jsonb_typeof(event_types) = 'array');

--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "endpoint_id" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_status_code" integer,
  "last_error" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_fk"
  FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade;

--> statement-breakpoint
-- An endpoint must not be able to receive another tenant's events. Same
-- technique as postings: extend the foreign key to carry org_id, so a
-- cross-tenant delivery has no row to point at.
ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_id_org_key UNIQUE (id, org_id);

--> statement-breakpoint
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_endpoint_org_fk
  FOREIGN KEY (endpoint_id, org_id) REFERENCES webhook_endpoints(id, org_id) ON DELETE cascade;

--> statement-breakpoint
-- One delivery per (event, endpoint). The dispatcher is not the only thing
-- that can enqueue — a manual replay does too — and "send it twice by
-- accident" should be impossible rather than merely unlikely.
CREATE UNIQUE INDEX webhook_deliveries_event_endpoint_key
  ON webhook_deliveries (event_id, endpoint_id);

--> statement-breakpoint
-- The claim query's index. A worker asks for `status = 'pending' AND
-- next_attempt_at <= now() ORDER BY next_attempt_at`, so leading with status
-- means it walks only the pending rows, in due order, and stops at the limit —
-- rather than scanning a table that is mostly succeeded history.
CREATE INDEX "webhook_deliveries_claim_idx" ON "webhook_deliveries" ("status","next_attempt_at");

--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("endpoint_id","created_at");

--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_idx" ON "webhook_deliveries" ("org_id","created_at");

--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" ("org_id","created_at");

--> statement-breakpoint
-- Same isolation as every other tenant table. A delivery log names who was
-- paid and how much; it is ledger data with a URL attached.
ALTER TABLE webhook_endpoints  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_endpoints  FORCE  ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE  ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY webhook_endpoints_tenant_isolation ON webhook_endpoints
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

--> statement-breakpoint
-- The endpoint's org_id is not the caller's to choose, and a delivery must
-- inherit the org of the endpoint it targets. Both are already guaranteed by
-- the policy above plus the composite key; this trigger exists for the one
-- case neither covers — a privileged role running maintenance SQL by hand.
CREATE OR REPLACE FUNCTION obol_guard_delivery_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  endpoint_org text;
BEGIN
  SELECT org_id INTO endpoint_org FROM webhook_endpoints WHERE id = NEW.endpoint_id;
  IF endpoint_org IS NOT NULL AND endpoint_org <> NEW.org_id THEN
    RAISE EXCEPTION 'delivery org_id % does not match endpoint org_id %',
      NEW.org_id, endpoint_org
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER webhook_deliveries_tenant_guard
  BEFORE INSERT OR UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION obol_guard_delivery_tenant();

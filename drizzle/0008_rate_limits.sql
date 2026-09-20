-- Rate limiting that survives more than one instance.
--
-- The counter has been in process memory, which is wrong in a specific way
-- worth naming: N serverless instances allow N times the quota, and a cold
-- start hands an attacker a fresh allowance. On a demo that blunts accidental
-- floods and nothing more.
--
-- Postgres is already here, so the shared counter goes here rather than
-- bringing in Redis for one integer. The cost is a round trip per request; the
-- mitigation is in the application, which still keeps a local counter and
-- rejects from it without asking — a local count can only be *lower* than the
-- shared one, so a local rejection is always sound. Under an actual flood the
-- database is touched at most `limit` times per client per window, which is
-- precisely when that bound matters.
--
-- Sliding window rather than fixed. A fixed window lets a client spend its
-- whole quota in the last second of one window and again in the first second
-- of the next — double the intended rate, at exactly the moment a limiter is
-- supposed to hold. This keeps the previous window's count and weights it by
-- how far into the current one we are.

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  previous_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
-- Swept by age, so the table does not accumulate a row per client forever.
CREATE INDEX rate_limits_updated_at_idx ON rate_limits (updated_at);

--> statement-breakpoint
-- Deliberately no row-level security.
--
-- This is infrastructure, not tenant data: the key is an IP and a route, and
-- the check runs *before* a tenant is resolved — the same reason `api_keys`
-- carries no policy. A policy keyed on `app.current_org` would be circular
-- here, and one that fails open when the setting is absent would be worse
-- than none.
COMMENT ON TABLE rate_limits IS
  'Shared sliding-window counters. Not tenant data: keyed by client and route, checked before a tenant is known.';

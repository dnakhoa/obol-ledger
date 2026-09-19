-- Credentials a tenant can manage, rather than ones the seed hands out.
--
-- Two columns, both to answer questions the digest cannot.
--
-- `token_prefix` is the first few characters of the token, stored in the
-- clear. That is not a weakening of the digest: it is what lets a person with
-- four keys tell them apart. Without it the management screen can only offer
-- the name someone typed months ago, and revoking the right key becomes a
-- guess — which in practice means nobody revokes anything.
--
-- `last_used_at` already existed and was never written. A key nobody can prove
-- is unused is a key nobody dares revoke, so the resolve path now stamps it.

ALTER TABLE api_keys ADD COLUMN token_prefix text;

--> statement-breakpoint
-- Existing rows predate the column and their tokens are unrecoverable by
-- design, so they get a marker rather than a fabricated prefix.
UPDATE api_keys SET token_prefix = 'legacy' WHERE token_prefix IS NULL;

--> statement-breakpoint
ALTER TABLE api_keys ALTER COLUMN token_prefix SET NOT NULL;

--> statement-breakpoint
-- Listing a tenant's keys is ordered by recency; the org index alone would
-- still sort.
CREATE INDEX api_keys_org_created_idx ON api_keys (org_id, created_at DESC);

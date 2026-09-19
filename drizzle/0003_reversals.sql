-- Reversing entries: the correction mechanism immutability requires.
--
-- `postings` and `transactions` reject UPDATE and DELETE, which is the right
-- policy for a historical record and useless on its own — a ledger that cannot
-- be corrected is not a ledger anyone can use. The accounting answer is a
-- reversing entry: a second entry that mirrors the first, leaving both on the
-- record and the net effect at zero.
--
-- Recording the link makes that auditable rather than implicit. Without it a
-- reversal is just another entry that happens to have opposite signs, and
-- nothing can tell you whether an entry still stands.

ALTER TABLE transactions ADD COLUMN reverses_transaction_id text;

--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_reverses_fk
  FOREIGN KEY (reverses_transaction_id) REFERENCES transactions (id) ON DELETE restrict;

--> statement-breakpoint
-- An entry may be reversed at most once.
--
-- A partial unique index rather than a plain one: the column is NULL for every
-- ordinary entry, and NULLs do not collide in a unique index — but being
-- explicit about the predicate documents the intent and keeps the index small.
--
-- This is the constraint that makes double-reversal impossible rather than
-- merely unlikely. Two concurrent requests to reverse the same entry both pass
-- an application-level check and one of them loses here, which is exactly
-- where that race should be resolved.
CREATE UNIQUE INDEX transactions_one_reversal_per_entry
  ON transactions (reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;

--> statement-breakpoint
-- A reversal must belong to the same tenant as the entry it reverses.
-- The composite key makes a cross-tenant reversal unrepresentable, the same way
-- the currency and org keys already do for postings.
ALTER TABLE transactions ADD CONSTRAINT transactions_reverses_org_fk
  FOREIGN KEY (reverses_transaction_id, org_id) REFERENCES transactions (id, org_id)
  ON DELETE restrict;

--> statement-breakpoint
-- An entry cannot reverse itself.
ALTER TABLE transactions ADD CONSTRAINT transactions_no_self_reversal
  CHECK (reverses_transaction_id IS NULL OR reverses_transaction_id <> id);

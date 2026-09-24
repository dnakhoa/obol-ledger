-- Why stock left without being sold.
--
-- Migration 0017 reserved `writeoff` as a movement kind and nothing used it.
-- A distributor needs it weekly: a pallet broken on the forklift, a carton
-- past its date, a stocktake that finds 37 m² fewer than the lots say. Each is
-- stock leaving at cost, drawn from lots by the same method as a sale, into an
-- expense rather than cost of sales — and each is a different conversation
-- with the auditor, which is why the reason is recorded rather than typed into
-- a description nobody can filter on.
--
-- A count shortfall is the one that matters most. It is the ledger admitting
-- its lots disagreed with the yard, and a business whose shortfalls grow
-- month on month has a theft or a receiving problem it can only see if the
-- shortfalls are distinguishable from breakage.
--
-- Under Thông tư 200 these are hàng hóa hao hụt, mất mát (632 for losses
-- within norms, 1381 for those awaiting a decision); under JGAAP 棚卸減耗損 and
-- 商品廃棄損. The ledger records the reason and lets the tenant pick the account.

ALTER TABLE inventory_movements ADD COLUMN reason text;

--> statement-breakpoint
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_reason_check CHECK (
  reason IS NULL OR reason IN ('damaged', 'expired', 'lost', 'count_shortfall', 'other')
);

--> statement-breakpoint
-- A write-off says why, and nothing else does. A receipt with a reason is a
-- receipt somebody meant to be something else.
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_writeoff_reason_check
  CHECK ((kind = 'writeoff') = (reason IS NOT NULL));

-- Japanese joins the languages a set of books can be kept in.
--
-- The charts for Japan shipped in 0016; this is the other half, and it is the
-- half that decides what the ledger writes down. A Japanese company's closing
-- entry is 月次決算振替仕訳 and its cost of sales is 売上原価 — that text becomes
-- part of the accounting record, so it follows the tenant rather than whoever
-- happens to be reading.
--
-- Worth recording while it is in front of us: Japan does not permit
-- 後入先出法 (LIFO) either. It was removed from Japanese GAAP in 2008 to
-- converge with IAS 2, and the National Tax Agency's list of permitted
-- valuation methods — 個別法, 先入先出法, 総平均法, 移動平均法, 最終仕入原価法,
-- 売価還元法 — does not include it. The constraint added in 0017 already gets
-- this right, because it permits LIFO only on the US chart.
--
-- See docs/adr/0014-two-locales.md.

ALTER TABLE organizations DROP CONSTRAINT organizations_locale_check;

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_locale_check
  CHECK (locale IN ('en', 'vi', 'ja'));

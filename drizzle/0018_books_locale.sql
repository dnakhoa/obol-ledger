-- The language the books are kept in, which is not the viewer's language.
--
-- Two different questions that look like one, and conflating them produces
-- exactly the artefact this migration exists to remove: entry descriptions
-- reading "Cost of goods sold: Đá lát granite 600×600", which is a sentence in
-- no language at all.
--
--   * A **viewer's** language is a preference. It picks the words on the
--     buttons, it can differ between two people looking at the same ledger,
--     and changing it changes nothing that is stored. It lives in a cookie.
--
--   * A **tenant's** language is a property of the accounting records. When
--     the ledger writes a description for itself — the closing entry, a
--     revaluation, the cost of goods sold behind a shipment — that text
--     becomes part of the books, is printed on reports and handed to auditors,
--     and cannot be retranslated later without rewriting history. A Vietnamese
--     company's books are in Vietnamese whoever is reading them.
--
-- So this column, and no more than this column: account names, item names and
-- hand-typed descriptions are data the tenant supplied, and nothing here ever
-- rewrites those.
--
-- See docs/adr/0014-two-locales.md.

ALTER TABLE organizations ADD COLUMN locale text NOT NULL DEFAULT 'en';

--> statement-breakpoint
ALTER TABLE organizations ADD CONSTRAINT organizations_locale_check
  CHECK (locale IN ('en', 'vi'));

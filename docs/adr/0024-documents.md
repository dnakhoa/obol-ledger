# 24. Documents are kept in the ledger, checked, and never deleted

- **Status**: Accepted
- **Date**: 2026-09-25

## Context

An auditor does not take a ledger's word for anything. For a purchase they
ask for the supplier's invoice; for an import, the customs declaration and
the bill of lading; for a refund, the credit note behind it. An importer
keeps these in an email thread or a shared drive. They find them again by
remembering which folder the container number went under. When a document
cannot be found, the entry it supported is an entry without evidence.

Vietnam adds a legal weight to this. A VAT invoice is an XML file, and that
XML, not a PDF of it, is the legal record ([ADR 11](0011-chart-of-accounts.md)
records the other half of Vietnamese compliance). Keeping the XML beside the
entry it was booked in is what a tax inspection asks for.

## Decision

**A document is stored in Postgres, once per tenant, identified by its
SHA-256, and linked to what it supports: an entry or a shipment.**

1. **In the database, under the same row-level security as everything else.**
   A separate object store would need a second access-control system that
   agrees with the first. `documents` has the same tenant policy as
   `postings`, and a document of another tenant is simply not found. Files
   are capped at 4 MiB. That is enough for a scanned invoice, and under the
   4.5 MB body limit of a serverless request. At the volume of a small
   importer this is gigabytes a year, well within Postgres.
2. **The content is the identity.** The same invoice uploaded twice is one
   document linked twice. Deduplication is by content, not by name, so two
   copies that could later differ never exist. The database recomputes
   `sha256(content)` and `octet_length(content)` in a CHECK, so the
   fingerprint cannot be written wrong by any writer.
3. **The type is read from the bytes, never from the browser.** PDF, PNG,
   JPEG, WebP and plain XML are accepted, and nothing else:
   - SVG is refused, because it is an image that can carry script;
   - HTML is refused however it is named;
   - XML with a DOCTYPE is refused, because that is how entity expansion
     gets in, and no e-invoice uses one.

   The type decided at upload is the only one ever served, with `nosniff`.

4. **Served so a file cannot become a page.**
   - PDFs and photos open inline; XML is always downloaded.
   - Anything rendered other than a PDF is sandboxed by CSP.
   - PDFs get `default-src 'none'`, because Chrome's viewer will not run
     inside a sandbox.
   - Nothing is cached by a shared cache.
   - Filenames are cleaned of paths and control characters, keep their
     Vietnamese and Japanese, and are sent as RFC 5987 `filename*`.
5. **Nothing is deleted.** `documents` is append-only. A link attached by
   mistake is marked removed, with who removed it and when, and a trigger
   allows that one change and nothing else. What an entry was once
   supported by stays on record, the same principle as reversing an entry
   rather than editing it.

## Consequences

- The sample ledger's Carrara container carries a generated commercial
  invoice, customs declaration and bill of lading. They are one-page PDFs
  built without a dependency and marked as samples on the page.
- Entries, invoices (through their entry) and shipments show a Documents
  card. The API attaches, lists and removes attachments on entries, and
  serves the file by id.
- Files are not virus-scanned. Only the five formats above are accepted and
  none is executed by the server, but a PDF can still carry an exploit for a
  vulnerable reader. Scanning belongs to the security pass, before the
  public link.
- Moving documents to an object store later is a storage change, not a model
  change. The hash, the links and the policy stay; only where the bytes live
  moves.

## Considered and rejected

- **An S3 bucket with signed URLs.** This is the usual answer, and it adds a
  second place tenancy has to be right, a credential to leak and a bucket
  policy to misconfigure, all for files that fit in the database.
- **Trusting the uploaded content type.** This is how a document store turns
  into stored XSS on the application's own origin.
- **Deleting a mistaken attachment.** It is convenient, and it means the
  record of what supported an entry depends on nobody ever having
  second thoughts.

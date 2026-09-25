# 27. The ledger issues the Vietnamese e-invoice document; a provider signs it

- **Status**: Accepted
- **Date**: 2026-09-25

## Context

Since Nghị định 123/2020 (amended by Nghị định 70/2025, and replaced from
1 July 2026 by the decree that implements the revised Law on Tax
Administration), every invoice a Vietnamese business issues is an XML
document in the format the General Department of Taxation prescribes
(Quyết định 1450/QĐ-TCT and its amendments). The invoice:

- names the seller and the buyer by tax code;
- carries a template (mẫu số), a series (ký hiệu) and a number that runs
  without gaps within the series;
- is signed with the seller's digital certificate;
- for a coded invoice, is given a code by the tax authority before the
  buyer receives it.

The XML is the legal invoice. A PDF is a courtesy copy.

Only a licensed e-invoice provider may transmit invoices to the tax
authority. MISA meInvoice, Viettel S-Invoice, VNPT, BKAV and others each
expose their own API, and a business has a contract with exactly one of
them. A sale in the books is not yet an invoice in law.

Correcting an issued invoice follows the same rules. Goods returned or a
price reduced are corrected by an **adjustment invoice** that names the
original and carries the change. The original is not reissued or edited.

## Decision

**The ledger produces the invoice document. Signing it and obtaining the
tax authority's code is left to the provider the business already uses.**

1. **One document per sale, one adjustment per credit note.** Unique
   indexes say so. An adjustment references an invoice of the same sale by
   composite key, and carries the credit note's lines and totals as
   negative amounts.
2. **Numbers without gaps.** A number is taken as the series' last plus one,
   under an advisory lock per series. A trigger refuses any number that
   leaves a gap or repeats, with the same lock, whoever writes the row.
3. **The series belongs to its year.** `C26TBM` is only accepted on an
   invoice dated 2026, checked by the service and by a CHECK. Registering
   next year's series is a reminder the ledger can give; issuing under last
   year's is a mistake it refuses.
4. **The seller must be complete before anything is issued.** Registered
   name, tax code (ten digits, or ten and a branch suffix), address and
   series are required. The buyer's details are kept on the customer
   account, typed once at the first invoice, with no tax code for a
   consumer.
5. **The document is exact and permanent.**
   - It records the VAT rate from the sale's tax code, or `KCT` when the
     sale carried none.
   - The total in Vietnamese words is written by a speller that follows
     the reading rules: lẻ, mốt, lăm, tư, full groups after the first.
   - The unit price is computed in integers.
   - The XML is stored with its SHA-256, checked by the database against
     the text, and the row is append-only.
6. **The provider is a seam, not a dependency.** The unsigned XML downloads
   from the sale, the e-invoices page and the API. A provider integration
   posts the same document and records the authority's code. It is written
   per provider once a customer names theirs.

## Consequences

- The sample company issues the invoice for its export INV-2612 and the
  adjustment invoice for the credit note against it, under a sample tax code
  that belongs to no one.
- **The element names follow the published format and must be checked
  against the chosen provider's current schema before go-live.** The format
  has been amended more than once, and each provider validates against its
  own version. Tests pin the structure, so a correction is a small,
  visible diff.
- **Replacement invoices** (hóa đơn thay thế, for an invoice with wrong
  details rather than a changed amount) and cancellation notices (Mẫu
  04/SS-HĐĐT) are not produced yet. The model has room for both as further
  kinds.
- The adjustment invoice is always issued by the seller. The 2025 rules
  allow the buyer to issue a return invoice instead, by written agreement.
  That is the buyer's system's job, not this one's.

## Considered and rejected

- **Integrating one provider now.** It would be the wrong one for most
  customers, and it would make a provider contract a condition of trying
  the product.
- **Numbering invoices by the sale reference.** An internal reference such
  as `INV-2612` is the business's own, may have gaps, and is not the legal
  number. The two are kept separate and both are shown.
- **Correcting an invoice by reissuing it.** This is the one thing the rules
  forbid, and the reason a sale in this ledger was append-only from the start.

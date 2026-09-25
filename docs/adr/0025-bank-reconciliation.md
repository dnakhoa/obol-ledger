# 25. The bank's statement is kept beside the books and matched line by line

- **Status**: Accepted
- **Date**: 2026-09-25

## Context

The ledger records what the business believes happened to its money. The
bank statement records what happened. Until the two are compared line by
line, the books carry every mistake the bank would have caught:

- a supplier paid twice;
- a customer's transfer never booked;
- a fee nobody entered.

At month end, an importer's bookkeeper exports two spreadsheets, sorts both by
amount and works through them with a highlighter. The ledger could not help,
because it had nowhere to put a statement.

## Decision

**Statement lines are stored as the bank gave them, once, and matched one to
one with the postings that record the same movement.**

1. **A line is kept exactly, and only once.** A line from a feed is
   identified by the bank's own transaction id. A line from a file is
   identified by a hash of its day, amount, description and reference,
   plus its position among identical lines that day. That way two
   identical coffees are two lines, and importing the same statement again
   adds neither. Overlapping months and a feed that resends a day are
   therefore harmless. Lines are append-only.
2. **Files are read the way banks write them.**
   - Column names are recognised in English, Vietnamese and Japanese.
   - An amount may be one signed column, or separate money-in and money-out
     columns.
   - Dates may be day-first (`25/09/2026`) or year-first (`2026/09/25`).
   - `1,250,000`, `1.250.000,00`, `(1,250.00)` and `1,250.00-` are all
     read. A comma or point followed by exactly three digits is a thousands
     separator in a currency with no cents.
   - A row that cannot be read stops the import and is named. Nothing is
     imported from a file that would lose a line.
3. **A match is one line and one posting, the same amount to the unit, on
   the same account.** Composite keys make a match to another account's
   posting unrepresentable. A trigger refuses a different amount, or a
   posting in an entry that is not posted. Partial unique indexes allow
   each line and each posting in at most one live match. A match made in
   error is undone, not deleted.
4. **Suggestions only where there is no doubt.** A posting is proposed for a
   line when it has the same amount, is within two weeks, and each is the
   other's nearest. Two identical transfers on one day are left for a person
   to pair. "Match all suggested" applies only those suggestions, and
   nothing is matched automatically on import.
5. **A line the books have nothing for becomes an entry, from the line.**
   Examples are the monthly fee, interest, or a transfer nobody booked. The
   entry is dated the day the bank moved the money, posts the line's own
   amount, and is matched in the same transaction, so the two cannot
   disagree.
6. **The reconciliation is the controller's statement.** It shows:
   - the balance per the books and per the bank;
   - what is on the statement but not in the books;
   - what is in the books but not yet on the statement, counted from the
     first statement line, since anything earlier is the opening balance.

   The difference is the bank's balance less (books − books only + bank
   only). It is zero when every gap is explained. The account is reconciled
   when that holds and nothing on the statement is left unmatched.

## Consequences

- The sample ledger carries a month of the operating account's statement.
  Most of it is matched, and three lines the books never heard of (a fee, a
  SWIFT charge, interest) are left for whoever is trying it.
- **Bank feeds are an API, not a connection.** A feed provider or a small
  job pushes lines to `POST /bank-accounts/{id}/lines`. Connecting to
  specific banks goes through an aggregator: Basiq or Yodlee in Australia,
  bank APIs in Vietnam, Moneytree in Japan. That is a commercial decision
  per market, and the integration point is ready for it.
- One line to one posting covers the ordinary case. A single deposit that
  pays several invoices is one receipt entry in the books, so it is still
  one posting. Splitting one bank line across several entries is not
  supported yet.

## Considered and rejected

- **Matching automatically on import.** It is convenient, and wrong in
  exactly the cases that matter: two identical amounts in a week are
  paired by a guess, and the reconciliation comes out right for the wrong
  reason.
- **Storing the statement as a document only.** An attached PDF is evidence,
  but it cannot be matched. The lines have to be data to be compared.
- **Tolerating small amount differences in a match.** A two-cent difference
  is a bank fee or a typo. Either way, it is a line of its own and not
  something a match should absorb.

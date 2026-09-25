# 26. Vietnam's statutory statements are forms, defined as data

- **Status**: Accepted
- **Date**: 2026-09-25

## Context

A Vietnamese enterprise files its financial statements on prescribed forms.
The two a trading business needs every year are the balance sheet and the
income statement, and each circular has its own versions of them:

| Books kept under             | Balance sheet | Income statement |
| ---------------------------- | ------------- | ---------------- |
| Thông tư 200 (enterprises)   | Mẫu B01-DN    | Mẫu B02-DN       |
| Thông tư 133 (small, medium) | Mẫu B01a-DNN  | Mẫu B02-DNN      |

A form is not a list of accounts. Each line (chỉ tiêu) has a fixed code (mã
số) and is filled from particular accounts:

- A customer ledger is split by the side of each customer's balance. Money
  owed goes on line 131; money received in advance goes on 312, on the
  other side of the statement.
- Accumulated depreciation prints as a negative beside the asset it reduces.
- The year's profit, not yet closed, appears under retained earnings.

The ledger's own balance sheet ([ADR 11](0011-chart-of-accounts.md)) groups
by account type, which is right for a manager and not what the tax office
takes.

## Decision

**Each form is a table of lines, each with its code, its Vietnamese and
English captions, and either the account prefixes that feed it or the lines
it sums. One function fills any of them.**

1. **Data, not code.** Two circulars, four forms, one filler. An
   accountant's correction to a line is a change to one row of a table,
   and so is a future amendment of a form.
2. **Accounts are claimed by prefix and by the side of their balance.** The
   most specific prefix wins: `2141` goes to accumulated depreciation even
   though a `214` rule exists. A balance can be taken on its debit side
   only, its credit side only, whole, or as a contra.
3. **Nothing is silently left out.** An account with a balance that no line
   claims is listed under the statement, and the balance sheet then does
   not balance. A statement that adds up while omitting an account is the
   failure to design against, not an imbalance.
4. **From the ledger's own truth.**
   - Only posted entries count, in the functional currency.
   - Foreign balances are included at the rate the revaluation left them
     at ([ADR 12](0012-fx-revaluation.md)).
   - The balance sheet is drawn at the end of a day. The year's unclosed
     result is added to retained earnings, so a mid-year statement balances
     without a closing entry.
   - The income statement covers a period and leaves out the month-end
     close, which moves a result rather than earning one.
5. **With the comparative the form asks for.** The balance sheet shows
   the start of the year; the income statement shows the same period a
   year earlier.
6. **Out as a spreadsheet.** CSV with the form's captions and codes and
   plain decimals, to paste into the template the tax office's software
   takes.

## Consequences

- The sample company's B01-DN balances on its own totals, places every
  account, and agrees with the ledger's balance sheet. Its B02-DN ends at
  the same profit as the income statement. Tests hold both to that.
- The forms follow the circulars' appendices as the author understands
  them. **They have not yet been checked line by line against the official
  templates by a Vietnamese accountant.** That is the review to do before
  a statement is signed, and the page says so.
- Some lines need facts a chart of accounts does not carry. Short- versus
  long-term borrowings and prepaid expenses are examples: the forms place
  them short-term and say so. The cash-flow statement (B03) and the notes
  (B09) are not produced.

## Considered and rejected

- **A report per form, written by hand.** Four programs to keep in step
  with four forms and every amendment to them. The fifth form would be the
  one with the bug.
- **Mapping accounts to lines by type.** A customer who has paid in advance
  is still a `131` asset account. It belongs on the liabilities side, and
  only its balance says so.

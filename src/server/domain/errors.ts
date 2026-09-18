import type { CurrencyCode } from '@/lib/money';

/**
 * The closed set of things the ledger can refuse to do.
 *
 * Every variant is a *business* outcome the caller can act on, so each carries
 * the specific data needed to fix the request rather than a prose message
 * assembled at the throw site. The HTTP layer is the only place that decides
 * how these become status codes (see `src/server/http/problem.ts`), which keeps
 * the domain free of transport concerns and makes the mapping reviewable in one
 * table instead of scattered across handlers.
 */
export type LedgerError =
  | { readonly code: 'account_not_found'; readonly accountId: string }
  | { readonly code: 'account_closed'; readonly accountId: string }
  | {
      readonly code: 'currency_mismatch';
      readonly expected: CurrencyCode;
      readonly received: CurrencyCode;
      readonly accountId?: string;
    }
  | {
      readonly code: 'unbalanced_transaction';
      /** Signed sum of all postings; zero is the only legal value. */
      readonly residual: string;
      readonly currency: CurrencyCode;
    }
  | { readonly code: 'too_few_postings'; readonly count: number }
  | { readonly code: 'zero_amount_posting'; readonly index: number }
  | { readonly code: 'duplicate_account_in_transaction'; readonly accountId: string }
  | {
      readonly code: 'insufficient_funds';
      readonly accountId: string;
      readonly available: string;
      readonly requested: string;
      readonly currency: CurrencyCode;
    }
  | { readonly code: 'idempotency_key_reused'; readonly key: string };

export type LedgerErrorCode = LedgerError['code'];

/**
 * Human-readable summaries, kept beside the type so adding a variant without a
 * message is a compile error rather than an `undefined` in an API response.
 */
const TITLES: Record<LedgerErrorCode, string> = {
  account_not_found: 'Account not found',
  account_closed: 'Account is closed',
  currency_mismatch: 'Currency mismatch',
  unbalanced_transaction: 'Transaction does not balance',
  too_few_postings: 'Transaction needs at least two postings',
  zero_amount_posting: 'Posting amount must not be zero',
  duplicate_account_in_transaction: 'Account appears more than once in the transaction',
  insufficient_funds: 'Insufficient funds',
  idempotency_key_reused: 'Idempotency key reused with a different request',
};

export function titleOf(error: LedgerError): string {
  return TITLES[error.code];
}

export function describe(error: LedgerError): string {
  switch (error.code) {
    case 'account_not_found':
      return `No account with id ${error.accountId}.`;
    case 'account_closed':
      return `Account ${error.accountId} is closed and cannot be posted to.`;
    case 'currency_mismatch':
      return error.accountId
        ? `Account ${error.accountId} is denominated in ${error.expected}, not ${error.received}.`
        : `Expected ${error.expected} but received ${error.received}.`;
    case 'unbalanced_transaction':
      return `Postings sum to ${error.residual} ${error.currency}; a balanced transaction sums to zero.`;
    case 'too_few_postings':
      return `A double-entry transaction needs at least two postings, got ${error.count}.`;
    case 'zero_amount_posting':
      return `Posting at index ${error.index} has a zero amount, which records nothing.`;
    case 'duplicate_account_in_transaction':
      return `Account ${error.accountId} appears more than once; net the postings into one line.`;
    case 'insufficient_funds':
      return `Account ${error.accountId} holds ${error.available} ${error.currency} but ${error.requested} ${error.currency} was requested and overdraft is not allowed.`;
    case 'idempotency_key_reused':
      return `Idempotency key ${error.key} was already used for a request with a different body.`;
  }
}

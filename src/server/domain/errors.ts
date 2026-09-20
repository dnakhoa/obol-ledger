import type { CurrencyCode } from '@/lib/money';
import type { TransactionStatus } from './transaction-status';

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
  | { readonly code: 'idempotency_key_reused'; readonly key: string }
  | { readonly code: 'entry_not_found'; readonly transactionId: string }
  | {
      readonly code: 'already_reversed';
      readonly transactionId: string;
      readonly reversedBy: string;
    }
  | {
      readonly code: 'invalid_status_transition';
      readonly transactionId: string;
      readonly from: TransactionStatus;
      readonly to: TransactionStatus;
    }
  | {
      readonly code: 'stale_account_version';
      readonly accountId: string;
      readonly expected: number;
      readonly actual: number;
    }
  | { readonly code: 'endpoint_not_found'; readonly endpointId: string }
  | { readonly code: 'endpoint_url_taken'; readonly url: string }
  | { readonly code: 'delivery_not_found'; readonly deliveryId: string }
  | { readonly code: 'period_already_closed'; readonly periodMonth: string }
  | { readonly code: 'period_not_closed'; readonly periodMonth: string }
  | { readonly code: 'period_not_finished'; readonly periodMonth: string }
  | { readonly code: 'earlier_period_open'; readonly periodMonth: string; readonly open: string }
  | { readonly code: 'retained_earnings_missing' }
  | {
      readonly code: 'fx_rate_required';
      readonly accountId: string;
      readonly currency: CurrencyCode;
      readonly functional: CurrencyCode;
    }
  | { readonly code: 'invalid_fx_rate'; readonly accountId: string; readonly rate: string }
  | { readonly code: 'rate_not_found'; readonly base: CurrencyCode; readonly quote: CurrencyCode }
  | { readonly code: 'fx_account_missing' }
  | {
      readonly code: 'revaluation_required';
      readonly periodMonth: string;
      readonly accounts: readonly string[];
    }
  | {
      readonly code: 'amount_not_representable';
      readonly accountId: string;
      readonly amount: string;
      readonly currency: CurrencyCode;
    }
  | {
      readonly code: 'currency_imbalance';
      readonly currency: CurrencyCode;
      readonly residual: string;
    };

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
  entry_not_found: 'Journal entry not found',
  already_reversed: 'Entry has already been reversed',
  invalid_status_transition: 'Entry cannot move to that status',
  stale_account_version: 'Account changed since it was read',
  endpoint_not_found: 'Webhook endpoint not found',
  endpoint_url_taken: 'Webhook endpoint already registered',
  delivery_not_found: 'Webhook delivery not found',
  period_already_closed: 'Period is already closed',
  period_not_closed: 'Period is not closed',
  period_not_finished: 'Period has not finished',
  earlier_period_open: 'An earlier period is still open',
  retained_earnings_missing: 'No retained earnings account',
  fx_rate_required: 'Exchange rate required',
  invalid_fx_rate: 'Exchange rate is not a positive decimal',
  rate_not_found: 'No exchange rate on file',
  fx_account_missing: 'No foreign exchange gain/loss account',
  revaluation_required: 'Foreign balances have not been retranslated',
  amount_not_representable: 'Amount could not be interpreted',
  currency_imbalance: 'Entry does not balance within a currency',
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
    case 'entry_not_found':
      return `No journal entry with id ${error.transactionId}.`;
    case 'already_reversed':
      return `Entry ${error.transactionId} was already reversed by ${error.reversedBy}; reversing it twice would double the correction.`;
    case 'invalid_status_transition':
      return error.from === 'pending'
        ? `Entry ${error.transactionId} cannot move from ${error.from} to ${error.to}; a pending entry may only be posted or archived.`
        : `Entry ${error.transactionId} is already ${error.from} and cannot change. Post a reversing entry instead.`;
    case 'stale_account_version':
      return `Account ${error.accountId} was at version ${error.actual}, not ${error.expected}; it changed since you read it. Re-read and retry.`;
    case 'endpoint_not_found':
      return `No webhook endpoint with id ${error.endpointId}.`;
    case 'endpoint_url_taken':
      return `${error.url} is already registered. Update that endpoint's subscription instead of adding a second one, or every event would be delivered twice.`;
    case 'delivery_not_found':
      return `No webhook delivery with id ${error.deliveryId}.`;
    case 'period_already_closed':
      return `${error.periodMonth} is already closed. Reopen it before closing it again.`;
    case 'period_not_closed':
      return `${error.periodMonth} is not closed, so there is nothing to reopen.`;
    case 'period_not_finished':
      return `${error.periodMonth} has not finished. Closing it would lock out entries that have not happened yet.`;
    case 'earlier_period_open':
      return `${error.open} is still open. Closing ${error.periodMonth} first would carry an unclosed month's profit into the next one, so periods close in order.`;
    case 'fx_rate_required':
      return `Account ${error.accountId} holds ${error.currency}, and the books are kept in ${error.functional}. Supply an fxRate or a baseAmount for that posting — a rate cannot be guessed without producing a ledger that balances and lies.`;
    case 'invalid_fx_rate':
      return `"${error.rate}" is not a positive decimal with at most ten places, so it cannot be an exchange rate for the posting to ${error.accountId}.`;
    case 'rate_not_found':
      return `No ${error.base}/${error.quote} rate is on file at or before that date. Record one, or supply the rate with the entry.`;
    case 'amount_not_representable':
      return `An amount of "${error.amount}" is not representable in ${error.currency}, which is what account ${error.accountId} holds.`;
    case 'revaluation_required':
      return `${error.periodMonth} holds foreign currency balances (${error.accounts.join(', ')}) that have not been retranslated at the closing rate. Closing now would seal a balance sheet stated at out-of-date rates. Revalue the period first.`;
    case 'fx_account_missing':
      return 'No account is designated as foreign exchange gain/loss, so an exchange difference has nowhere to go. Mark one revenue or expense account with the fx_gain_loss role.';
    case 'currency_imbalance':
      return `The ${error.currency} postings sum to ${error.residual} rather than zero. An exchange difference can only be absorbed when each currency already balances on its own — otherwise the adjustment would hide a mistyped amount.`;
    case 'retained_earnings_missing':
      return 'No account is designated as retained earnings, so a period\u2019s profit has nowhere to go. Mark one equity account with the retained_earnings role.';
  }
}

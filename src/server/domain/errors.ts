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
    }
  | { readonly code: 'item_not_found'; readonly itemId: string }
  | { readonly code: 'item_archived'; readonly itemId: string }
  | { readonly code: 'sku_taken'; readonly sku: string }
  | {
      readonly code: 'insufficient_stock';
      readonly itemId: string;
      /** Scaled by the item's precision, like every other quantity. */
      readonly requested: string;
      readonly available: string;
      readonly precision: number;
      readonly unit: string;
    }
  | { readonly code: 'cost_layer_not_found'; readonly layerId: string }
  | { readonly code: 'cost_layer_required'; readonly itemId: string }
  | {
      readonly code: 'costing_method_not_permitted';
      readonly method: string;
      readonly chartTemplate: string;
    }
  | {
      readonly code: 'inventory_account_not_functional';
      readonly accountId: string;
      readonly currency: CurrencyCode;
      readonly functional: CurrencyCode;
    }
  | {
      readonly code: 'account_wrong_type';
      readonly accountId: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly code: 'shipment_reference_taken'; readonly reference: string }
  | { readonly code: 'shipment_not_found'; readonly shipmentId: string }
  | { readonly code: 'shipment_has_no_stock'; readonly shipmentId: string }
  | { readonly code: 'mixed_units'; readonly units: readonly string[] }
  | { readonly code: 'weight_missing'; readonly layerIds: readonly string[] }
  | { readonly code: 'debit_account_required' }
  | { readonly code: 'tax_code_name_taken'; readonly name: string }
  | { readonly code: 'tax_code_not_found'; readonly taxCodeId: string }
  | { readonly code: 'sales_tax_is_not_reclaimable' }
  | {
      readonly code: 'tax_account_missing';
      readonly treatment: string;
      readonly side: 'input' | 'output';
    }
  | { readonly code: 'period_already_filed'; readonly periodMonth: string }
  | { readonly code: 'tax_payable_account_missing' }
  | { readonly code: 'nothing_to_file'; readonly periodStart: string; readonly periodEnd: string }
  | {
      readonly code: 'earlier_return_unfiled';
      readonly periodMonth: string;
      readonly unfiled: string;
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
  item_not_found: 'Item not found',
  item_archived: 'Item is archived',
  sku_taken: 'That item code is already in use',
  insufficient_stock: 'Not enough stock on hand',
  cost_layer_not_found: 'Cost layer not found',
  cost_layer_required: 'A specific lot must be named',
  costing_method_not_permitted: 'That costing method is not permitted here',
  inventory_account_not_functional: 'Inventory must be held in the functional currency',
  account_wrong_type: 'Account is of the wrong type for this use',
  shipment_reference_taken: 'That shipment reference is already in use',
  shipment_not_found: 'Shipment not found',
  shipment_has_no_stock: 'Shipment has no stock to charge against',
  mixed_units: 'Those lots are not measured in the same unit',
  weight_missing: 'Some lots have no weight recorded',
  debit_account_required: 'A charge that is not part of the cost of goods needs an account',
  tax_code_name_taken: 'That tax code name is already in use',
  tax_code_not_found: 'Tax code not found',
  sales_tax_is_not_reclaimable: 'Sales tax cannot have a reclaimable account',
  tax_account_missing: 'The tax code has no account for that side',
  period_already_filed: 'That month is already covered by a filed return',
  tax_payable_account_missing: 'No tax payable account',
  nothing_to_file: 'No tax was charged or paid in that period',
  earlier_return_unfiled: 'An earlier period has not been filed',
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
    case 'item_not_found':
      return `No inventory item with id ${error.itemId}.`;
    case 'item_archived':
      return `Item ${error.itemId} is archived, so stock cannot move in or out of it. Reopen it first.`;
    case 'sku_taken':
      return `Another item already uses the code ${error.sku}. Item codes are how a stock movement names what moved, so they have to be unique.`;
    case 'insufficient_stock':
      return `Only ${quantityText(error.available, error.precision)} ${error.unit} on hand, and ${quantityText(error.requested, error.precision)} was requested. Nothing has been posted \u2014 record the receipt that is missing, or correct the quantity.`;
    case 'cost_layer_not_found':
      return `No cost layer with id ${error.layerId}. It may already be exhausted.`;
    case 'cost_layer_required':
      return `Item ${error.itemId} is costed by specific identification, so the lot being shipped has to be named. That is the point of the method: these units are not interchangeable with the ones beside them.`;
    case 'costing_method_not_permitted':
      return `${error.method} is not permitted on a ${error.chartTemplate} chart. LIFO is allowed under US GAAP and prohibited under IFRS and Vietnamese accounting, so it is only available to a US ledger.`;
    case 'inventory_account_not_functional':
      return `Account ${error.accountId} is held in ${error.currency}, and inventory must be held in ${error.functional}. Stock is a non-monetary item: its carrying amount is fixed at the rate on the day it arrived, so denominating the account itself in a foreign currency would mean retranslating a figure that must never move.`;
    case 'account_wrong_type':
      return `Account ${error.accountId} is ${error.actual}, and this needs ${error.expected}.`;
    case 'shipment_reference_taken':
      return `Another shipment already uses the reference ${error.reference}. References are how a freight invoice finds the container it belongs to, so they have to be unique.`;
    case 'shipment_not_found':
      return `No shipment with id ${error.shipmentId}.`;
    case 'shipment_has_no_stock':
      return `Shipment ${error.shipmentId} has no deliveries booked against it, so there is nothing for this charge to land on. Book the deliveries in first.`;
    case 'mixed_units':
      return `These lots are measured in ${error.units.join(' and ')}, so a charge cannot be spread by quantity across them — that would be adding one to the other. Spread it by value or by weight instead.`;
    case 'weight_missing':
      return `${error.layerIds.length} of the lots on this shipment have no weight recorded, and treating them as weightless would push the whole charge onto the rest. Record the weights, or spread the charge by value.`;
    case 'debit_account_required':
      return 'A charge that is not part of the cost of the goods — recoverable import VAT, for instance — needs an account of its own to be debited to.';
    case 'tax_code_name_taken':
      return `Another tax code is already called ${error.name}.`;
    case 'tax_code_not_found':
      return `No active tax code with id ${error.taxCodeId}.`;
    case 'sales_tax_is_not_reclaimable':
      return 'United States sales tax is never reclaimable on a purchase, so a sales-tax code has no input account. A business given one accumulates a receivable from a state that does not owe it, and the accounts balance perfectly while the asset is fictional.';
    case 'tax_account_missing':
      return `This ${error.treatment} code has no ${error.side} tax account, so it cannot post that side of the entry.`;
    case 'period_already_filed':
      return `${error.periodMonth} is already covered by a filed return. A return is evidence and is never edited — to change it, file an amended return for the same period.`;
    case 'tax_payable_account_missing':
      return 'Filing moves what is owed out of the tax accounts and into one liability the business actually settles, so a tax payable account has to exist first.';
    case 'nothing_to_file':
      return `No tax was charged or paid between ${error.periodStart} and ${error.periodEnd}, so there is nothing to file.`;
    case 'earlier_return_unfiled':
      return `${error.unfiled} has not been filed yet, and filing ${error.periodMonth} first would strand its credit — an unused credit is carried into the next return, so the returns have to be filed in order.`;
  }
}

/** `24687` at precision 3 → `24.687`. Kept local; errors carry raw scaled values. */
function quantityText(scaled: string, precision: number): string {
  if (precision === 0) return scaled;
  const negative = scaled.startsWith('-');
  const digits = (negative ? scaled.slice(1) : scaled).padStart(precision + 1, '0');
  const cut = digits.length - precision;
  return `${negative ? '-' : ''}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

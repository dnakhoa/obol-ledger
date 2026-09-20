import type { LedgerError } from '@/server/domain/errors';
import { describe, titleOf } from '@/server/domain/errors';

/**
 * Error responses shaped as RFC 9457 Problem Details.
 *
 * A status code alone cannot distinguish "that account does not exist" from
 * "that entry does not balance"; both are things a client must handle
 * differently. `type` gives a stable, linkable identifier to branch on, `title`
 * and `detail` give a human something to read, and the extension members carry
 * the specific figures so a client never has to parse prose.
 */
export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly [extension: string]: unknown;
};

const PROBLEM_BASE = 'https://obol-ledger.dev/problems';

/**
 * The single place where a domain outcome becomes a status code.
 *
 * Keeping the whole mapping in one table is what makes it reviewable: a reader
 * can check every code at once rather than hunting through handlers, and
 * `Record<LedgerError['code'], number>` makes a new variant without a status a
 * compile error.
 */
const STATUS_BY_CODE: Record<LedgerError['code'], number> = {
  account_not_found: 404,
  account_closed: 409,
  currency_mismatch: 422,
  unbalanced_transaction: 422,
  too_few_postings: 422,
  zero_amount_posting: 422,
  duplicate_account_in_transaction: 422,
  insufficient_funds: 422,
  idempotency_key_reused: 409,
  entry_not_found: 404,
  already_reversed: 409,
  invalid_status_transition: 409,
  stale_account_version: 409,
  endpoint_not_found: 404,
  endpoint_url_taken: 409,
  delivery_not_found: 404,
  period_already_closed: 409,
  period_not_closed: 409,
  period_not_finished: 422,
  earlier_period_open: 409,
  retained_earnings_missing: 409,
  fx_rate_required: 422,
  invalid_fx_rate: 422,
  rate_not_found: 422,
  fx_account_missing: 409,
  revaluation_required: 409,
  amount_not_representable: 422,
  currency_imbalance: 422,
  item_not_found: 404,
  item_archived: 409,
  sku_taken: 409,
  // 409 rather than 422: the request is well formed and would have been
  // accepted an hour ago. What changed is the state of the yard.
  insufficient_stock: 409,
  cost_layer_not_found: 404,
  cost_layer_required: 422,
  costing_method_not_permitted: 422,
  inventory_account_not_functional: 422,
  account_wrong_type: 422,
  shipment_reference_taken: 409,
  shipment_not_found: 404,
  shipment_has_no_stock: 409,
  mixed_units: 422,
  weight_missing: 422,
  debit_account_required: 422,
  tax_code_name_taken: 409,
  tax_code_not_found: 404,
  sales_tax_is_not_reclaimable: 422,
  tax_account_missing: 422,
};

export function statusFor(error: LedgerError): number {
  return STATUS_BY_CODE[error.code];
}

export function problemFor(error: LedgerError, requestId: string): Problem {
  const { code, ...extensions } = error;
  return {
    type: `${PROBLEM_BASE}/${code.replaceAll('_', '-')}`,
    title: titleOf(error),
    status: statusFor(error),
    detail: describe(error),
    code,
    requestId,
    ...extensions,
  };
}

export function problem(
  status: number,
  slug: string,
  title: string,
  detail: string,
  extensions: Record<string, unknown> = {},
): Problem {
  return { type: `${PROBLEM_BASE}/${slug}`, title, status, detail, ...extensions };
}

export function problemResponse(value: Problem, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: value.status,
    headers: { 'content-type': 'application/problem+json; charset=utf-8', ...headers },
  });
}

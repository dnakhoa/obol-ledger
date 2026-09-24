import type { LedgerError } from '@/server/domain/errors';

/**
 * One representative of every variant. Adding a `LedgerError` without adding it
 * here is a type error, which is the point: a new failure mode must arrive with
 * a title, a description and a status, not with `undefined` in an API response.
 *
 * Shared rather than kept in `errors.test.ts` because the dashboard renders the
 * same variants in three languages, and a second sample map would be a second
 * list for the next variant to be forgotten from.
 */
export const EVERY_VARIANT: Record<LedgerError['code'], LedgerError> = {
  account_not_found: { code: 'account_not_found', accountId: 'acct_x' },
  account_closed: { code: 'account_closed', accountId: 'acct_x' },
  currency_mismatch: { code: 'currency_mismatch', expected: 'EUR', received: 'USD' },
  unbalanced_transaction: {
    code: 'unbalanced_transaction',
    residual: '0.01',
    currency: 'USD',
  },
  too_few_postings: { code: 'too_few_postings', count: 1 },
  zero_amount_posting: { code: 'zero_amount_posting', index: 2 },
  duplicate_account_in_transaction: {
    code: 'duplicate_account_in_transaction',
    accountId: 'acct_x',
  },
  insufficient_funds: {
    code: 'insufficient_funds',
    accountId: 'acct_x',
    available: '10.00',
    requested: '25.00',
    currency: 'USD',
  },
  idempotency_key_reused: { code: 'idempotency_key_reused', key: 'k' },
  entry_not_found: { code: 'entry_not_found', transactionId: 'txn_x' },
  already_reversed: {
    code: 'already_reversed',
    transactionId: 'txn_x',
    reversedBy: 'txn_y',
  },
  invalid_status_transition: {
    code: 'invalid_status_transition',
    transactionId: 'txn_x',
    from: 'posted',
    to: 'archived',
  },
  stale_account_version: {
    code: 'stale_account_version',
    accountId: 'acct_x',
    expected: 3,
    actual: 5,
  },
  endpoint_not_found: { code: 'endpoint_not_found', endpointId: 'whe_x' },
  endpoint_url_taken: { code: 'endpoint_url_taken', url: 'https://hooks.example.com/ledger' },
  delivery_not_found: { code: 'delivery_not_found', deliveryId: 'whd_x' },
  period_already_closed: { code: 'period_already_closed', periodMonth: '2026-08-01' },
  period_not_closed: { code: 'period_not_closed', periodMonth: '2026-08-01' },
  period_not_finished: { code: 'period_not_finished', periodMonth: '2026-09-01' },
  earlier_period_open: {
    code: 'earlier_period_open',
    periodMonth: '2026-08-01',
    open: '2026-07-01',
  },
  retained_earnings_missing: { code: 'retained_earnings_missing' },
  fx_rate_required: {
    code: 'fx_rate_required',
    accountId: 'acct_x',
    currency: 'USD',
    functional: 'VND',
  },
  invalid_fx_rate: { code: 'invalid_fx_rate', accountId: 'acct_x', rate: 'abc' },
  rate_not_found: { code: 'rate_not_found', base: 'USD', quote: 'VND' },
  fx_account_missing: { code: 'fx_account_missing' },
  revaluation_required: {
    code: 'revaluation_required',
    periodMonth: '2026-08-01',
    accounts: ['Vietcombank USD'],
  },
  amount_not_representable: {
    code: 'amount_not_representable',
    accountId: 'acct_x',
    amount: '10.005',
    currency: 'USD',
  },
  currency_imbalance: { code: 'currency_imbalance', currency: 'USD', residual: '1.00' },
  item_not_found: { code: 'item_not_found', itemId: 'item_x' },
  item_archived: { code: 'item_archived', itemId: 'item_x' },
  sku_taken: { code: 'sku_taken', sku: 'GRN-60x60' },
  insufficient_stock: {
    code: 'insufficient_stock',
    itemId: 'item_x',
    requested: '24687',
    available: '12000',
    precision: 3,
    unit: 't',
  },
  cost_layer_not_found: { code: 'cost_layer_not_found', layerId: 'layer_x' },
  cost_layer_required: { code: 'cost_layer_required', itemId: 'item_x' },
  costing_method_not_permitted: {
    code: 'costing_method_not_permitted',
    method: 'lifo',
    chartTemplate: 'vn_tt200',
  },
  inventory_account_not_functional: {
    code: 'inventory_account_not_functional',
    accountId: 'acct_x',
    currency: 'USD',
    functional: 'VND',
  },
  account_wrong_type: {
    code: 'account_wrong_type',
    accountId: 'acct_x',
    expected: 'asset',
    actual: 'revenue',
  },
  shipment_reference_taken: { code: 'shipment_reference_taken', reference: 'CONT-4417' },
  shipment_not_found: { code: 'shipment_not_found', shipmentId: 'ship_x' },
  shipment_has_no_stock: { code: 'shipment_has_no_stock', shipmentId: 'ship_x' },
  mixed_units: { code: 'mixed_units', units: ['m2', 'tonne'] },
  weight_missing: { code: 'weight_missing', layerIds: ['layer_a'] },
  debit_account_required: { code: 'debit_account_required' },
  tax_code_name_taken: { code: 'tax_code_name_taken', name: 'GTGT 10%' },
  tax_code_not_found: { code: 'tax_code_not_found', taxCodeId: 'tax_x' },
  sales_tax_is_not_reclaimable: { code: 'sales_tax_is_not_reclaimable' },
  tax_account_missing: { code: 'tax_account_missing', treatment: 'vat', side: 'input' },
  period_already_filed: { code: 'period_already_filed', periodMonth: '2026-03-01' },
  tax_payable_account_missing: { code: 'tax_payable_account_missing' },
  nothing_to_file: { code: 'nothing_to_file', periodStart: '2026-03-01', periodEnd: '2026-03-31' },
  earlier_return_unfiled: {
    code: 'earlier_return_unfiled',
    periodMonth: '2026-03-01',
    unfiled: '2026-02-01',
  },
};

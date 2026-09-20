import { describe, expect, it } from 'vitest';
import { describe as describeError, titleOf, type LedgerError } from '@/server/domain/errors';
import { statusFor } from '@/server/http/problem';

/**
 * One representative of every variant. Adding a `LedgerError` without adding it
 * here is a type error, which is the point: a new failure mode must arrive with
 * a title, a description and a status, not with `undefined` in an API response.
 */
const EVERY_VARIANT: Record<LedgerError['code'], LedgerError> = {
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
  amount_not_representable: {
    code: 'amount_not_representable',
    accountId: 'acct_x',
    amount: '10.005',
    currency: 'USD',
  },
  currency_imbalance: { code: 'currency_imbalance', currency: 'USD', residual: '1.00' },
};

const variants = Object.values(EVERY_VARIANT);

describe('ledger errors', () => {
  it.each(variants)('describes $code with something actionable', (error) => {
    const title = titleOf(error);
    const detail = describeError(error);

    expect(title).toBeTruthy();
    expect(title).not.toContain('undefined');
    expect(detail.length).toBeGreaterThan(20);
    expect(detail).not.toContain('undefined');
    expect(detail.endsWith('.')).toBe(true);
  });

  it.each(variants)('maps $code to a 4xx status', (error) => {
    const status = statusFor(error);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('names the account when a currency mismatch has one', () => {
    const withAccount = describeError({
      code: 'currency_mismatch',
      expected: 'EUR',
      received: 'USD',
      accountId: 'acct_euro',
    });
    expect(withAccount).toContain('acct_euro');

    const withoutAccount = describeError({
      code: 'currency_mismatch',
      expected: 'EUR',
      received: 'USD',
    });
    expect(withoutAccount).not.toContain('acct_');
  });

  it('quotes the figures a caller needs to correct the request', () => {
    expect(describeError(EVERY_VARIANT.insufficient_funds)).toContain('10.00');
    expect(describeError(EVERY_VARIANT.insufficient_funds)).toContain('25.00');
    expect(describeError(EVERY_VARIANT.unbalanced_transaction)).toContain('0.01');
  });
});

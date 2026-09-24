import { describe, expect, it } from 'vitest';
import { describe as describeError, titleOf } from '@/server/domain/errors';
import { statusFor } from '@/server/http/problem';
import { EVERY_VARIANT } from '../helpers/ledger-errors';

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

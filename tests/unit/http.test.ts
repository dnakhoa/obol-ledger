import { afterEach, describe, expect, it } from 'vitest';
import { rateLimit, resetRateLimits } from '@/server/http/rate-limit';
import { problemFor, statusFor } from '@/server/http/problem';
import type { LedgerError } from '@/server/domain/errors';
import { errorCodeOf } from '@/app/api/v1/health/route';

afterEach(() => resetRateLimits());

describe('rate limiting', () => {
  it('allows up to the quota and then refuses', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit('client', now, 3).allowed).toBe(true);
    }
    const refused = rateLimit('client', now, 3);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    const now = 1_000_000;
    rateLimit('a', now, 1);
    expect(rateLimit('a', now, 1).allowed).toBe(false);
    expect(rateLimit('b', now, 1).allowed).toBe(true);
  });

  it('opens a fresh window once the old one expires', () => {
    const now = 1_000_000;
    rateLimit('client', now, 1);
    expect(rateLimit('client', now, 1).allowed).toBe(false);
    expect(rateLimit('client', now + 60_001, 1).allowed).toBe(true);
  });

  it('reports the remaining quota', () => {
    const decision = rateLimit('client', 1_000_000, 10);
    expect(decision.allowed && decision.remaining).toBe(9);
  });
});

describe('problem details', () => {
  const cases: [LedgerError, number][] = [
    [{ code: 'account_not_found', accountId: 'acct_x' }, 404],
    [{ code: 'account_closed', accountId: 'acct_x' }, 409],
    [{ code: 'idempotency_key_reused', key: 'k' }, 409],
    [{ code: 'too_few_postings', count: 1 }, 422],
    [{ code: 'unbalanced_transaction', residual: '0.01', currency: 'USD' }, 422],
  ];

  it.each(cases)('maps %o to %i', (error, status) => {
    expect(statusFor(error)).toBe(status);
  });

  it('carries the error specifics as extension members', () => {
    const value = problemFor(
      {
        code: 'insufficient_funds',
        accountId: 'acct_x',
        available: '10.00',
        requested: '25.00',
        currency: 'USD',
      },
      'req-1',
    );

    expect(value).toMatchObject({
      status: 422,
      code: 'insufficient_funds',
      accountId: 'acct_x',
      available: '10.00',
      requested: '25.00',
      requestId: 'req-1',
    });
    // The `type` member is what a client branches on, so it must be stable.
    expect(value.type).toBe('https://obol-ledger.dev/problems/insufficient-funds');
    expect(value.detail).toContain('overdraft is not allowed');
  });
});

describe('health diagnostics', () => {
  it('finds the driver code on a wrapped error', () => {
    // drizzle wraps driver failures, so the code that identifies the fault is
    // rarely on the outermost error.
    const driverError = Object.assign(new Error('getaddrinfo ENOTFOUND db.example'), {
      code: 'ENOTFOUND',
    });
    const wrapped = new Error('Failed query: select 1', { cause: driverError });
    expect(errorCodeOf(wrapped)).toBe('ENOTFOUND');
  });

  it('prefers the outermost code when one is present', () => {
    const outer = Object.assign(new Error('boom'), { code: '28P01' });
    expect(errorCodeOf(outer)).toBe('28P01');
  });

  it('reports "unknown" rather than throwing on anything else', () => {
    expect(errorCodeOf(new Error('no code here'))).toBe('unknown');
    expect(errorCodeOf('a string')).toBe('unknown');
    expect(errorCodeOf(undefined)).toBe('unknown');
  });

  it('ignores a non-string code', () => {
    const odd = Object.assign(new Error('boom'), { code: 500 });
    expect(errorCodeOf(odd)).toBe('unknown');
  });
});

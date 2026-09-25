import { describe, expect, it } from 'vitest';
import { parseStatementAmount } from '@/lib/statement-amount';

describe('parseStatementAmount', () => {
  it.each([
    ['1,250,000', 'VND', 1_250_000n],
    ['1.250.000', 'VND', 1_250_000n],
    ['1,250', 'VND', 1_250n],
    ['¥1,250', 'JPY', 1_250n],
    ['-1,250.50', 'AUD', -125_050n],
    ['1.250,50', 'EUR', 125_050n],
    ['1 250,50 €', 'EUR', 125_050n],
    ['(1,250.00)', 'USD', -125_000n],
    ['1,250.00-', 'USD', -125_000n],
    ['A$ 42.10', 'AUD', 4_210n],
    ['12,5', 'EUR', 1_250n],
    ['+300', 'VND', 300n],
    ['0.5', 'USD', 50n],
  ] as const)('reads %s in %s', (text, currency, expected) => {
    expect(parseStatementAmount(text, currency)).toBe(expected);
  });

  it.each([
    ['', 'USD'],
    ['abc', 'USD'],
    ['1.2.3,4,5', 'USD'],
    // More decimals than the currency has is refused, not rounded.
    ['12.345', 'USD'],
    ['1,5', 'VND'],
  ] as const)('refuses %s in %s', (text, currency) => {
    expect(parseStatementAmount(text, currency)).toBeNull();
  });
});

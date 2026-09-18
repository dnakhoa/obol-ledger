import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatAxisTick, formatMinorUnits, groupDecimalString } from '@/lib/format';
import { minorUnits, parseDecimal } from '@/lib/money';
import { unwrap } from '@/lib/result';

describe('groupDecimalString', () => {
  it.each([
    ['0.00', '0.00'],
    ['999.99', '999.99'],
    ['1000.00', '1,000.00'],
    ['1234567.89', '1,234,567.89'],
    ['-1234567.89', '-1,234,567.89'],
    ['1000', '1,000'],
  ])('groups %s as %s', (input, expected) => {
    expect(groupDecimalString(input)).toBe(expected);
  });

  it('never alters the digits themselves', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }), (amount) => {
        const rendered = formatMinorUnits(minorUnits(amount), 'USD');
        expect(rendered.replaceAll(',', '')).toBe(
          (amount < 0n ? '-' : '') +
            (amount < 0n ? -amount : amount)
              .toString()
              .padStart(3, '0')
              .replace(/(\d{2})$/u, '.$1'),
        );
      }),
    );
  });

  it('formats an amount too large for a double without losing precision', () => {
    // 2^53 + 1 cents: a JavaScript number cannot represent this exactly.
    const amount = unwrap(parseDecimal('90071992547409.93', 'USD'));
    expect(formatMinorUnits(amount, 'USD')).toBe('90,071,992,547,409.93');
  });
});

describe('formatAxisTick', () => {
  it.each([
    [0n, '0'],
    [50_000n, '500'],
    [100_000n, '1,000'],
    [5_000_000n, '50,000'],
    [100_000_000n, '1M'],
    [145_000_000n, '1.4M'],
    [100_000_000_000n, '1B'],
  ] as const)('renders %s minor units as %s', (amount, expected) => {
    expect(formatAxisTick(minorUnits(amount), 'USD')).toBe(expected);
  });

  it('drops the fractional part, because ticks land on round numbers', () => {
    expect(formatAxisTick(minorUnits(123_456n), 'USD')).toBe('1,234');
  });

  it('respects the currency exponent', () => {
    // JPY has no minor units, so 50,000 minor units is 50,000 yen.
    expect(formatAxisTick(minorUnits(50_000n), 'JPY')).toBe('50,000');
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatAxisTick, formatMinorUnits, groupDecimalString } from '@/lib/format';
import { minorUnits, parseDecimal } from '@/lib/money';
import { unwrap } from '@/lib/result';
import { separatorsFor } from '@/lib/i18n';

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

describe("grouping in the reader's language", () => {
  it('writes a Vietnamese figure the way Vietnamese writes it', () => {
    // 71,605,457,995 and 71.605.457.995 are the same number, and a reader
    // shown the wrong one has to stop and work out which mark means what.
    expect(groupDecimalString('71605457995', separatorsFor('vi'))).toBe('71.605.457.995');
    expect(groupDecimalString('1234.56', separatorsFor('vi'))).toBe('1.234,56');
  });

  it('leaves English and Japanese on the comma', () => {
    expect(groupDecimalString('1234.56', separatorsFor('en'))).toBe('1,234.56');
    expect(groupDecimalString('1234.56', separatorsFor('ja'))).toBe('1,234.56');
  });

  it('defaults to English when nobody says', () => {
    expect(groupDecimalString('1234.56')).toBe('1,234.56');
  });

  it('keeps the sign outside the grouping', () => {
    expect(groupDecimalString('-1234567.89', separatorsFor('vi'))).toBe('-1.234.567,89');
  });

  it('reads the ASCII point whatever it writes', () => {
    // The domain always produces `1234.56`. The locale's mark is only ever
    // written, never parsed — so a Vietnamese render does not then fail to
    // round-trip through a Vietnamese read.
    const vietnamese = groupDecimalString('0.05', separatorsFor('vi'));
    expect(vietnamese).toBe('0,05');
  });

  it('never goes through a JavaScript number', () => {
    // 2^53 + 1. `Intl.NumberFormat` would have been shorter and takes a
    // number, by which point this figure is already wrong.
    expect(groupDecimalString('9007199254740993', separatorsFor('en'))).toBe(
      '9,007,199,254,740,993',
    );
    expect(groupDecimalString('9007199254740993', separatorsFor('vi'))).toBe(
      '9.007.199.254.740.993',
    );
  });

  it('groups an axis tick the same way', () => {
    // Otherwise the labels down the side of a chart use one convention and
    // the bars beside them use another, and the reader cannot tell which.
    // Below the point where ticks compact to `5M`, which has no separator
    // to disagree about.
    expect(formatAxisTick(minorUnits(500_000n), 'VND', 'vi')).toBe('500.000');
    expect(formatAxisTick(minorUnits(500_000n), 'VND', 'en')).toBe('500,000');
  });
});

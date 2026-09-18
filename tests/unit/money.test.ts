import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  exponentOf,
  isCurrencyCode,
  minorUnits,
  parseDecimal,
  SUPPORTED_CURRENCIES,
  sum,
  toDecimalString,
  type CurrencyCode,
} from '@/lib/money';
import { isOk, unwrap } from '@/lib/result';

describe('parseDecimal', () => {
  it.each([
    ['0', 'USD', 0n],
    ['1', 'USD', 100n],
    ['1.5', 'USD', 150n],
    ['1.05', 'USD', 105n],
    ['-1234.56', 'USD', -123456n],
    ['+7.89', 'USD', 789n],
    ['1000', 'JPY', 1000n],
    ['1.234', 'BHD', 1234n],
  ] as const)('parses %s (%s) to %s minor units', (input, currency, expected) => {
    expect(unwrap(parseDecimal(input, currency))).toBe(expected);
  });

  it('rejects more decimals than the currency has', () => {
    // The classic bug this guards: assuming every currency has two decimals.
    expect(parseDecimal('1.5', 'JPY')).toMatchObject({
      ok: false,
      error: { kind: 'too_many_decimals', maxDecimals: 0 },
    });
    expect(parseDecimal('1.005', 'USD')).toMatchObject({
      ok: false,
      error: { kind: 'too_many_decimals', maxDecimals: 2 },
    });
    expect(isOk(parseDecimal('1.005', 'BHD'))).toBe(true);
  });

  it.each(['', ' ', 'abc', '1.2.3', '1,50', '1e3', 'NaN', 'Infinity', '.5', '1.'])(
    'rejects %o as malformed',
    (input) => {
      expect(parseDecimal(input, 'USD')).toMatchObject({ ok: false, error: { kind: 'malformed' } });
    },
  );

  it('rejects an amount that would not survive a 64-bit column', () => {
    expect(parseDecimal('99999999999999999999', 'USD')).toMatchObject({
      ok: false,
      error: { kind: 'out_of_range' },
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(unwrap(parseDecimal('  12.34  ', 'USD'))).toBe(1234n);
  });
});

describe('toDecimalString', () => {
  it.each([
    [0n, 'USD', '0.00'],
    [5n, 'USD', '0.05'],
    [-5n, 'USD', '-0.05'],
    [123456n, 'USD', '1234.56'],
    [1000n, 'JPY', '1000'],
    [-1000n, 'JPY', '-1000'],
    [1n, 'BHD', '0.001'],
  ] as const)('renders %s (%s) as %s', (amount, currency, expected) => {
    expect(toDecimalString(minorUnits(amount), currency)).toBe(expected);
  });
});

const currencyArb = fc.constantFrom<CurrencyCode>(...SUPPORTED_CURRENCIES);

describe('money laws', () => {
  it('round-trips any storable amount through string form', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        currencyArb,
        (amount, currency) => {
          const rendered = toDecimalString(minorUnits(amount), currency);
          expect(unwrap(parseDecimal(rendered, currency))).toBe(amount);
        },
      ),
    );
  });

  it('renders exactly as many decimal places as the currency defines', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
        currencyArb,
        (a, currency) => {
          const rendered = toDecimalString(minorUnits(a), currency);
          const decimals = rendered.includes('.') ? (rendered.split('.')[1]?.length ?? 0) : 0;
          expect(decimals).toBe(exponentOf(currency));
        },
      ),
    );
  });

  it('sums a list the same way regardless of order', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n })), (amounts) => {
        const forwards = sum(amounts.map(minorUnits));
        const backwards = sum([...amounts].reverse().map(minorUnits));
        expect(forwards).toBe(backwards);
      }),
    );
  });

  it('never loses a minor unit, unlike floating point', () => {
    // 0.1 + 0.2 in doubles is 0.30000000000000004; in minor units it is exact.
    const total = sum([unwrap(parseDecimal('0.1', 'USD')), unwrap(parseDecimal('0.2', 'USD'))]);
    expect(toDecimalString(total, 'USD')).toBe('0.30');
  });
});

describe('isCurrencyCode', () => {
  it('accepts supported codes and rejects everything else', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('XYZ')).toBe(false);
    // Guards against `Object.hasOwn` being fooled by prototype members.
    expect(isCurrencyCode('toString')).toBe(false);
  });
});

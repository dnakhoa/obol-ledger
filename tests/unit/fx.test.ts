import { describe, expect, it } from 'vitest';
import { convert, formatRate, impliedRate, parseRate, RATE_SCALE } from '@/lib/fx';
import { minorUnits, type CurrencyCode } from '@/lib/money';

const rate = (value: string): bigint => {
  const parsed = parseRate(value);
  if (typeof parsed !== 'bigint') throw new Error(`bad rate: ${parsed}`);
  return parsed;
};

describe('rates', () => {
  it('round-trips a decimal exactly', () => {
    for (const value of ['1', '25470.5', '0.0000392600', '1.2345678901'.slice(0, 12)]) {
      expect(formatRate(rate(value))).toBe(Number(value).toString());
    }
  });

  it('keeps ten decimal places, matching the column', () => {
    expect(formatRate(rate('0.0000000001'))).toBe('0.0000000001');
    expect(parseRate('0.00000000001')).toBe('too_precise');
  });

  it('refuses a rate that is not a positive number', () => {
    expect(parseRate('0')).toBe('not_positive');
    expect(parseRate('-1')).toBe('malformed');
    expect(parseRate('1e5')).toBe('malformed');
    expect(parseRate('')).toBe('malformed');
  });

  it('never sees a float', () => {
    // 0.1 + 0.2 territory: this rate is not representable as a double, and
    // parsing through Number would already have lost it.
    const parsed = rate('0.1234567891');
    expect(formatRate(parsed)).toBe('0.1234567891');
    expect(parsed).toBe(1234567891n);
  });
});

describe('conversion', () => {
  const usd = 'USD' as CurrencyCode;
  const vnd = 'VND' as CurrencyCode;
  const jpy = 'JPY' as CurrencyCode;

  it('is the identity within one currency', () => {
    expect(convert({ amount: minorUnits(12_345n), from: usd, to: usd, rate: rate('7') })).toBe(
      12_345n,
    );
  });

  it('rescales between currencies with different exponents', () => {
    // 1,000.00 USD at 25,470.5 VND per USD. USD has two decimal places and
    // VND none, so 100_000 minor units of USD becomes 25,470,500 of VND —
    // the exponent shift is the step that is easy to omit, and omitting it
    // here would answer 2,547,050,000.
    const result = convert({
      amount: minorUnits(100_000n),
      from: usd,
      to: vnd,
      rate: rate('25470.5'),
    });
    expect(result).toBe(25_470_500n);
  });

  it('converts back the other way', () => {
    const result = convert({
      amount: minorUnits(25_470_500n),
      from: vnd,
      to: usd,
      rate: rate('0.0000392611'.slice(0, 12)),
    });
    // Approximately a thousand dollars; the rate is the inverse to ten places.
    expect(result).toBeGreaterThan(99_900n);
    expect(result).toBeLessThan(100_100n);
  });

  it('handles a zero-decimal currency on both sides', () => {
    expect(convert({ amount: minorUnits(1_000n), from: jpy, to: vnd, rate: rate('170.25') })).toBe(
      170_250n,
    );
  });

  it('rounds half away from zero, so a debit and its credit stay mirrored', () => {
    // Math.round sends -0.5 to -0 and 0.5 to 1, which makes the two halves of
    // an entry round to different magnitudes and unbalances it after
    // conversion.
    const half = { from: usd, to: usd === usd ? ('EUR' as CurrencyCode) : usd, rate: rate('0.5') };
    const positive = convert({ amount: minorUnits(1n), ...half });
    const negative = convert({ amount: minorUnits(-1n), ...half });
    expect(positive).toBe(1n);
    expect(negative).toBe(-1n);
  });

  it('is exact at scale', () => {
    // Ten million dong at a rate with ten decimal places: a double would have
    // stopped being able to represent this product long before here.
    const result = convert({
      amount: minorUnits(10_000_000n),
      from: vnd,
      to: usd,
      rate: rate('0.0000392600'),
    });
    expect(result).toBe(39_260n);
  });

  it('declares the scale it keeps', () => {
    expect(RATE_SCALE).toBe(10);
  });
});

describe('the rate two amounts imply', () => {
  const usd = 'USD' as CurrencyCode;
  const vnd = 'VND' as CurrencyCode;
  const jpy = 'JPY' as CurrencyCode;
  const bhd = 'BHD' as CurrencyCode;

  it('is the rate a person would quote, not a ratio of minor units', () => {
    // 40,000.00 USD booked at 1,016,000,000 VND. The minor units divide to
    // 254; the rate is 25,400, and the difference is the exponent shift.
    expect(
      impliedRate({
        amount: minorUnits(4_000_000n),
        from: usd,
        baseAmount: minorUnits(1_016_000_000n),
        to: vnd,
      }),
    ).toBe('25400');
  });

  it('ignores the sign, because a credit and its debit imply one rate', () => {
    expect(
      impliedRate({
        amount: minorUnits(-4_000_000n),
        from: usd,
        baseAmount: minorUnits(-1_016_000_000n),
        to: vnd,
      }),
    ).toBe('25400');
  });

  it('inverts cleanly when the functional currency has more decimals', () => {
    // 1,000 JPY recorded as 6.70 USD: 0.0067 dollars to the yen.
    expect(
      impliedRate({ amount: minorUnits(1_000n), from: jpy, baseAmount: minorUnits(670n), to: usd }),
    ).toBe('0.0067');
    // Three places against two: 1.000 BHD recorded as 2.65 USD.
    expect(
      impliedRate({ amount: minorUnits(1_000n), from: bhd, baseAmount: minorUnits(265n), to: usd }),
    ).toBe('2.65');
  });

  it('round-trips through convert', () => {
    const quoted = impliedRate({
      amount: minorUnits(5_840_000n),
      from: usd,
      baseAmount: minorUnits(1_487_448_000n),
      to: vnd,
    });
    expect(quoted).toBe('25470');
    expect(
      convert({ amount: minorUnits(5_840_000n), from: usd, to: vnd, rate: rate(quoted) }),
    ).toBe(1_487_448_000n);
  });
});

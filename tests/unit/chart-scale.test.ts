import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minorUnits } from '@/lib/money';
import { buildLinearScale, heightPercent, niceCeiling } from '@/lib/chart-scale';

describe('niceCeiling', () => {
  it.each([
    [1n, 1n],
    [7n, 10n],
    [12n, 20n],
    [21n, 50n],
    [50n, 50n],
    [51n, 100n],
    [999n, 1000n],
    [123_456n, 200_000n],
  ])('rounds %s up to %s', (input, expected) => {
    expect(niceCeiling(minorUnits(input))).toBe(expected);
  });

  it('never returns a ceiling below the value it is given', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 15n }), (value) => {
        expect(niceCeiling(minorUnits(value))).toBeGreaterThanOrEqual(value);
      }),
    );
  });

  it('always lands on 1, 2 or 5 times a power of ten', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 15n }), (value) => {
        const top = niceCeiling(minorUnits(value));
        const leading = BigInt(top.toString()[0] ?? '0');
        expect([1n, 2n, 5n]).toContain(leading);
        expect(BigInt(top.toString().slice(1) || '0')).toBe(0n);
      }),
    );
  });

  it('handles an all-zero series without dividing by zero', () => {
    const scale = buildLinearScale([minorUnits(0n), minorUnits(0n)]);
    expect(scale.peakIndex).toBe(-1);
    expect(heightPercent(minorUnits(0n), scale.top)).toBe(0);
  });
});

describe('buildLinearScale', () => {
  it('produces gridlines from the top down to zero', () => {
    const scale = buildLinearScale([minorUnits(35n), minorUnits(80n), minorUnits(12n)]);
    expect(scale.top).toBe(100n);
    expect(scale.ticks).toEqual([100n, 75n, 50n, 25n, 0n]);
    expect(scale.peakIndex).toBe(1);
  });

  it('keeps every bar inside the plot area', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 1, maxLength: 40 }),
        (values) => {
          const amounts = values.map(minorUnits);
          const scale = buildLinearScale(amounts);
          for (const amount of amounts) {
            const percent = heightPercent(amount, scale.top);
            expect(percent).toBeGreaterThanOrEqual(0);
            expect(percent).toBeLessThanOrEqual(100);
          }
        },
      ),
    );
  });

  it('scales values too large for a double without losing the ordering', () => {
    const big = minorUnits(9_007_199_254_740_993n);
    const scale = buildLinearScale([big, minorUnits(big / 2n)]);
    expect(heightPercent(big, scale.top)).toBeGreaterThan(
      heightPercent(minorUnits(big / 2n), scale.top),
    );
  });
});

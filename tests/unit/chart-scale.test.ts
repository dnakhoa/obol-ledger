import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { minorUnits } from '@/lib/money';
import { buildLinearScale, DIVISIONS, heightPercent, niceCeiling } from '@/lib/chart-scale';

describe('niceCeiling', () => {
  it.each([
    [1n, 1n],
    [7n, 10n],
    [12n, 15n],
    [21n, 25n],
    [50n, 50n],
    [51n, 60n],
    [999n, 1000n],
    [123_456n, 150_000n],
    // The case that motivated the intermediate steps: a 1/2/5 ladder would
    // give 50,000 here and leave the tallest bar at half the plot height.
    [2_496_198n, 2_500_000n],
  ])('rounds %s up to %s', (input, expected) => {
    expect(niceCeiling(minorUnits(input))).toBe(expected);
  });

  it('always fills at least two thirds of the plot', () => {
    // The ladder's widest relative gap sets this bound: 10 -> 15 is a factor of
    // 1.5, so a value just above a step can only fall to 2/3 of the axis. The
    // old 1/2/5 ladder had a factor-of-2 gap, and so could leave the tallest
    // bar at half height — which is what this change was for.
    fc.assert(
      fc.property(fc.bigInt({ min: 10n, max: 10n ** 15n }), (value) => {
        const top = niceCeiling(minorUnits(value));
        expect(heightPercent(minorUnits(value), top)).toBeGreaterThan(66);
      }),
    );
  });

  it('never returns a ceiling below the value it is given', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 15n }), (value) => {
        expect(niceCeiling(minorUnits(value))).toBeGreaterThanOrEqual(value);
      }),
    );
  });

  it('always produces gridline labels that divide evenly', () => {
    // Round ticks are the whole point of snapping the axis at all: a reader
    // holds 0 / 5,000 / 10,000 in their head and 0 / 4,634 / 9,268 not at all.
    fc.assert(
      fc.property(fc.bigInt({ min: 10n, max: 10n ** 15n }), (value) => {
        const scale = buildLinearScale([minorUnits(value)]);
        for (const tick of scale.ticks) {
          expect((tick * BigInt(DIVISIONS)) % BigInt(DIVISIONS)).toBe(0n);
        }
        expect(scale.ticks.at(-1)).toBe(0n);
        expect(scale.ticks[0]).toBe(scale.top);
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
    expect(scale.top).toBe(80n);
    expect(scale.ticks).toEqual([80n, 64n, 48n, 32n, 16n, 0n]);
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

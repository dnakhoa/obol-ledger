import { describe, expect, it } from 'vitest';
import { apportion } from '@/lib/apportion';

/**
 * The property that matters is one line: the pieces add back up to what you
 * started with. Everything else here is a way of getting at it from an angle
 * where the naive implementation fails.
 */
const sum = (values: readonly { amount: bigint }[]) =>
  values.reduce((total, value) => total + value.amount, 0n);

describe('apportion', () => {
  it('divides evenly when it can', () => {
    const result = apportion(900n, [{ weight: 1n }, { weight: 1n }, { weight: 1n }]);
    expect(result.map((r) => r.amount)).toEqual([300n, 300n, 300n]);
  });

  it('loses nothing when the division does not come out', () => {
    // Rounding each share independently gives 3, 3, 3 and drops a unit.
    const result = apportion(10n, [{ weight: 1n }, { weight: 1n }, { weight: 1n }]);
    expect(sum(result)).toBe(10n);
    expect(result.map((r) => r.amount)).toEqual([4n, 3n, 3n]);
  });

  it('invents nothing when rounding would go the other way', () => {
    // Independent rounding gives 7, 7, 7 — a twenty-first unit from nowhere.
    const result = apportion(20n, [{ weight: 1n }, { weight: 1n }, { weight: 1n }]);
    expect(sum(result)).toBe(20n);
  });

  it('follows the weights', () => {
    // A freight invoice across two containers, one worth three times the other.
    const result = apportion(4_000_00n, [{ weight: 30_000n }, { weight: 10_000n }]);
    expect(result.map((r) => r.amount)).toEqual([3_000_00n, 1_000_00n]);
  });

  it('gives a zero-weight share nothing', () => {
    const result = apportion(100n, [{ weight: 0n }, { weight: 5n }, { weight: 5n }]);
    expect(result.map((r) => r.amount)).toEqual([0n, 50n, 50n]);
  });

  it('mirrors itself for a credit note', () => {
    // A reversal has to undo exactly what the entry did, share for share. If
    // the remainder lands on a different share when the sign flips, the two
    // do not cancel and the difference is stranded on a lot forever.
    const shares = [{ weight: 7n }, { weight: 11n }, { weight: 13n }];
    const charged = apportion(1_000_01n, shares);
    const credited = apportion(-1_000_01n, shares);

    expect(sum(credited)).toBe(-1_000_01n);
    expect(credited.map((r) => r.amount)).toEqual(charged.map((r) => -r.amount));
  });

  it('keeps the total when every weight is zero rather than dropping it', () => {
    const result = apportion(500n, [{ weight: 0n }, { weight: 0n }]);
    expect(sum(result)).toBe(500n);
  });

  it('is exact across a spread of awkward inputs', () => {
    // The property, swept. Prime weights and prime totals are where a
    // floor-and-hope implementation drifts.
    for (const total of [1n, 7n, 99n, 100_01n, 999_983n, 1_000_000_007n]) {
      for (const weights of [
        [1n, 1n, 1n],
        [1n, 2n, 3n, 4n],
        [7n, 11n, 13n],
        [1n, 0n, 999n],
        [123_456n, 654_321n],
      ]) {
        const result = apportion(
          total,
          weights.map((weight) => ({ weight })),
        );
        expect(sum(result)).toBe(total);
        expect(result.every((r) => r.amount >= 0n)).toBe(true);
      }
    }
  });

  it('returns nothing for no shares rather than losing the total silently', () => {
    expect(apportion(100n, [])).toEqual([]);
  });
});

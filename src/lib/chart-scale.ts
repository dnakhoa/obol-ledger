import { minorUnits, type MinorUnits } from './money';

/**
 * Axis maths for the activity chart.
 *
 * Pure and free of any rendering concern, which is the point: picking a
 * readable axis top is the only part of a chart with a right and a wrong
 * answer, so it lives where it can be property-tested rather than inside a
 * component that would need a browser to exercise.
 */

/**
 * Candidate axis tops, as tenths of a power of ten.
 *
 * A bare 1 / 2 / 5 ladder is the usual shortcut, but it leaves too much air:
 * a series peaking at 24,962 gets an axis of 50,000, so the tallest bar
 * reaches half the plot and the chart reads as under-filled. The intermediate
 * steps close that gap — the same series now tops out at 25,000 and fills it.
 *
 * Every entry divides evenly by `DIVISIONS`, which is what keeps the gridline
 * labels round: a reader holds 0 / 5,000 / 10,000 in their head, and
 * 0 / 4,634 / 9,268 not at all, however snugly the latter fits the data.
 */
const STEPS = [10n, 15n, 20n, 25n, 30n, 40n, 50n, 60n, 80n, 100n] as const;

export const DIVISIONS = 5;

/** Rounds an axis top up to the nearest readable step at its magnitude. */
export function niceCeiling(value: MinorUnits): MinorUnits {
  if (value <= 0n) return minorUnits(1n);

  // Tenths, so the fractional steps above stay integers.
  const magnitude = 10n ** BigInt(value.toString().length - 1) / 10n;
  if (magnitude === 0n) {
    // Single-digit values: nothing below 10 subdivides usefully.
    for (const step of [1n, 2n, 5n]) if (step >= value) return minorUnits(step);
    return minorUnits(10n);
  }

  for (const step of STEPS) {
    const candidate = step * magnitude;
    if (candidate >= value) return minorUnits(candidate);
  }
  return minorUnits(100n * magnitude);
}

export type LinearScale = {
  /** The value the tallest gridline represents. */
  readonly top: MinorUnits;
  /** Gridline values, highest first, always ending at zero. */
  readonly ticks: MinorUnits[];
  /** Index of the largest value, for the single direct label. `-1` when all zero. */
  readonly peakIndex: number;
};

export function buildLinearScale(
  values: readonly MinorUnits[],
  divisions = DIVISIONS,
): LinearScale {
  const max = values.reduce<MinorUnits>(
    (highest, value) => (value > highest ? value : highest),
    minorUnits(0n),
  );
  const top = niceCeiling(max);

  const ticks: MinorUnits[] = [];
  for (let step = divisions; step >= 0; step -= 1) {
    ticks.push(minorUnits((top * BigInt(step)) / BigInt(divisions)));
  }

  return { top, ticks, peakIndex: max === 0n ? -1 : values.indexOf(max) };
}

/**
 * A bar's height as a percentage of the axis top.
 *
 * Scaled through bigint before converting, so a ledger large enough to exceed
 * `Number.MAX_SAFE_INTEGER` in minor units still plots correctly.
 */
export function heightPercent(value: MinorUnits, top: MinorUnits): number {
  if (top <= 0n) return 0;
  return Number((value * 10_000n) / top) / 100;
}

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
 * Rounds an axis top up to 1, 2 or 5 times a power of ten.
 *
 * Gridlines labelled 0 / 2,500 / 5,000 are numbers a reader holds in their
 * head; 0 / 2,317 / 4,634 are not, even though they fit the data more snugly.
 */
export function niceCeiling(value: MinorUnits): MinorUnits {
  if (value <= 0n) return minorUnits(1n);

  const magnitude = 10n ** BigInt(value.toString().length - 1);
  for (const step of [1n, 2n, 5n]) {
    const candidate = step * magnitude;
    if (candidate >= value) return minorUnits(candidate);
  }
  return minorUnits(10n * magnitude);
}

export type LinearScale = {
  /** The value the tallest gridline represents. */
  readonly top: MinorUnits;
  /** Gridline values, highest first, always ending at zero. */
  readonly ticks: MinorUnits[];
  /** Index of the largest value, for the single direct label. `-1` when all zero. */
  readonly peakIndex: number;
};

export function buildLinearScale(values: readonly MinorUnits[], divisions = 4): LinearScale {
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

import { toDecimalString, type CurrencyCode, type MinorUnits } from './money';

/**
 * Presentation formatting for money.
 *
 * Kept pure and separate from the components so it can be unit-tested and so
 * that the server and the browser render a value identically — a mismatch would
 * be a hydration error on every page that shows a figure.
 *
 * Crucially, none of this converts through a JavaScript `number`. The exact
 * decimal string produced by the domain is split and grouped as *text*, so the
 * floating-point error the whole backend exists to avoid cannot sneak back in
 * at the last step.
 */

const GROUPS = /\B(?=(\d{3})+(?!\d))/gu;

function group(digits: string): string {
  return digits.replace(GROUPS, ',');
}

/** `-1234567.5` becomes `-1,234,567.5`. */
export function groupDecimalString(value: string): string {
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  const [whole = '0', fraction] = magnitude.split('.');
  const grouped = fraction ? `${group(whole)}.${fraction}` : group(whole);
  return negative ? `-${grouped}` : grouped;
}

export function formatMinorUnits(amount: MinorUnits, currency: CurrencyCode): string {
  return groupDecimalString(toDecimalString(amount, currency));
}

const COMPACT_STEPS = [
  { threshold: 1_000_000_000n, suffix: 'B' },
  { threshold: 1_000_000n, suffix: 'M' },
] as const;

/**
 * Axis ticks: grouped whole units, compacted once the labels would get long.
 *
 * Ticks land on round numbers by construction, so the fractional part is
 * dropped — `50,000` is read at a glance where `50000.00` is not. Grouping is
 * kept all the way to a million: `50K` is no clearer than `50,000` and throws
 * away precision for nothing. Past a million the labels would crowd the gutter,
 * so they compact to `1.4M`.
 */
export function formatAxisTick(amount: MinorUnits, currency: CurrencyCode): string {
  const decimal = toDecimalString(amount, currency);
  const whole = decimal.split('.')[0] ?? '0';
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const magnitude = BigInt(digits);

  for (const { threshold, suffix } of COMPACT_STEPS) {
    if (magnitude < threshold) continue;
    // One decimal place, computed in integer maths: 1_450_000 -> "1.4M".
    const scaled = (magnitude * 10n) / threshold;
    const rendered = `${scaled / 10n}${scaled % 10n === 0n ? '' : `.${scaled % 10n}`}${suffix}`;
    return negative ? `-${rendered}` : rendered;
  }

  return negative ? `-${group(digits)}` : group(digits);
}

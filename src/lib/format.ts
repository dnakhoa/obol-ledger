import { toDecimalString, type CurrencyCode, type MinorUnits } from './money';
import { separatorsFor, type Separators } from './i18n/separators';
import type { Locale } from './i18n/locales';

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

const ENGLISH: Separators = { group: ',', decimal: '.' };

function group(digits: string, mark: string): string {
  return digits.replace(GROUPS, mark);
}

/**
 * `-1234567.5` becomes `-1,234,567.5`, or `-1.234.567,5` in Vietnamese.
 *
 * The separators are supplied rather than looked up from a locale, so this
 * stays a pure function of its arguments — which is what lets the server and
 * the browser render a figure identically. A mismatch would be a hydration
 * error on every page showing money.
 */
export function groupDecimalString(value: string, separators: Separators = ENGLISH): string {
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  // Split on the ASCII point, which is what the domain always produces; the
  // locale's mark is only ever written, never read.
  const [whole = '0', fraction] = magnitude.split('.');
  const grouped = fraction
    ? `${group(whole, separators.group)}${separators.decimal}${fraction}`
    : group(whole, separators.group);
  return negative ? `-${grouped}` : grouped;
}

/**
 * A money value as a person in this language reads it.
 *
 * Takes the shape rather than the `MoneyDto` type, so this module stays free
 * of any import from the server — the boundary the architecture test keeps.
 */
export function formatAmount(value: { readonly amount: string }, locale: Locale = 'en'): string {
  return groupDecimalString(value.amount, separatorsFor(locale));
}

export function formatMinorUnits(
  amount: MinorUnits,
  currency: CurrencyCode,
  locale: Locale = 'en',
): string {
  return groupDecimalString(toDecimalString(amount, currency), separatorsFor(locale));
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
export function formatAxisTick(
  amount: MinorUnits,
  currency: CurrencyCode,
  locale: Locale = 'en',
): string {
  const separators = separatorsFor(locale);
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

  return negative ? `-${group(digits, separators.group)}` : group(digits, separators.group);
}

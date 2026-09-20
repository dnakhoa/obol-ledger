import { err, ok, type Result } from './result';

/**
 * Quantities, stored the same way money is: an integer, scaled.
 *
 * The argument is identical to the one in `money.ts` and worth repeating,
 * because quantity is where people assume a float is harmless. It is not. A
 * container of granite weighs 24.687 tonnes; a pallet of pavers covers 11.52
 * square metres. Accumulate a few hundred of those in IEEE-754 and the
 * on-hand figure drifts from the sum of the movements that produced it — and
 * the drift shows up as a cost layer that will not close, months later, with
 * no way to find which movement caused it.
 *
 * Unlike money, the scale is not fixed by a standard. Nobody ratified how many
 * decimal places a tonne has, so each item declares its own, defaulting to
 * whatever the unit is normally measured to.
 */

/**
 * Units of measure, with how finely each is normally counted.
 *
 * Deliberately a small closed list rather than free text. A unit is compared
 * (you cannot issue square metres from a layer of tonnes) and a free-text unit
 * makes "TONNE", "tonne", "Tonnes" and "MT" four incompatible things that look
 * the same to the person typing. The list is easy to extend; ambiguity is not
 * easy to undo.
 */
export const UNITS = {
  piece: { label: 'pieces', precision: 0 },
  slab: { label: 'slabs', precision: 0 },
  block: { label: 'blocks', precision: 0 },
  pallet: { label: 'pallets', precision: 0 },
  crate: { label: 'crates', precision: 0 },
  container: { label: 'containers', precision: 0 },
  kg: { label: 'kg', precision: 3 },
  tonne: { label: 't', precision: 3 },
  m: { label: 'm', precision: 2 },
  m2: { label: 'm²', precision: 2 },
  m3: { label: 'm³', precision: 3 },
  litre: { label: 'L', precision: 3 },
  hour: { label: 'hours', precision: 2 },
} as const satisfies Record<string, { label: string; precision: number }>;

export type Unit = keyof typeof UNITS;

export const SUPPORTED_UNITS = Object.keys(UNITS) as [Unit, ...Unit[]];

export function isUnit(value: string): value is Unit {
  return Object.hasOwn(UNITS, value);
}

/** What this unit is normally measured to, unless the item says otherwise. */
export function defaultPrecision(unit: Unit): number {
  return UNITS[unit].precision;
}

export function unitLabel(unit: Unit): string {
  return UNITS[unit].label;
}

/**
 * The widest precision an item may declare.
 *
 * Six places is more than any physical unit of trade needs and leaves a
 * quantity comfortably inside a 64-bit integer even at warehouse scale: a
 * billion tonnes to six places is 10^15, and `bigint` in Postgres holds
 * 9.2 × 10^18.
 */
export const MAX_PRECISION = 6;

declare const quantityBrand: unique symbol;

/** A scaled integer quantity. Branded so a bare count cannot be passed as one. */
export type Quantity = bigint & { readonly [quantityBrand]: 'Quantity' };

export const NONE = 0n as Quantity;

export function quantity(value: bigint): Quantity {
  return value as Quantity;
}

export type QuantityParseError = 'not_a_number' | 'too_many_decimals' | 'negative' | 'too_large';

const DECIMAL = /^(?<sign>-?)(?<whole>\d+)(?:\.(?<fraction>\d+))?$/u;

/** The largest quantity that survives a round trip through a Postgres bigint. */
const MAX_QUANTITY = 2n ** 63n - 1n;

/**
 * `"24.687"` at precision 3 → `24687n`.
 *
 * Refuses more decimals than the item declares rather than rounding them away.
 * Silently dropping a digit is how a 0.5 tonne discrepancy becomes somebody's
 * afternoon: the person typing believes they entered 24.6875, and every screen
 * afterwards agrees with the ledger rather than with them.
 */
export function parseQuantity(
  input: string,
  precision: number,
): Result<Quantity, QuantityParseError> {
  const match = DECIMAL.exec(input.trim());
  if (!match?.groups) return err('not_a_number');

  const { sign, whole, fraction = '' } = match.groups;
  if (fraction.length > precision) return err('too_many_decimals');
  if (sign === '-') return err('negative');

  const scaled =
    BigInt(whole ?? '0') * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, '0') || '0');
  if (scaled > MAX_QUANTITY) return err('too_large');

  return ok(scaled as Quantity);
}

/** `24687n` at precision 3 → `"24.687"`. */
export function toQuantityString(value: Quantity | bigint, precision: number): string {
  const factor = 10n ** BigInt(precision);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / factor;
  if (precision === 0) return `${negative ? '-' : ''}${whole}`;
  const fraction = (magnitude % factor).toString().padStart(precision, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** What a person reads: `"24.687 t"`. Trailing zeroes kept — they are precision. */
export function formatQuantity(value: Quantity | bigint, precision: number, unit: Unit): string {
  return `${toQuantityString(value, precision)} ${unitLabel(unit)}`;
}

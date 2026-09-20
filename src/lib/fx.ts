import { exponentOf, type CurrencyCode, type MinorUnits } from './money';

/**
 * Converting an amount between currencies, without a float anywhere.
 *
 * Two traps sit in what looks like one multiplication.
 *
 * **The rate is a decimal.** `25470.5` is representable as a double;
 * `0.00003926` is not, and neither is the product. At Vietnamese dong scale a
 * double has already lost the tenth of a dong, and a rate wrong in the tenth
 * place is wrong by a dollar on every hundred thousand. So a rate travels as a
 * string and is parsed into an integer scaled by `RATE_SCALE`.
 *
 * **Minor units are not comparable across currencies.** 100 USD minor units is
 * one dollar; 100 VND minor units is one hundred dong, because VND has no
 * minor unit at all. Converting minor to minor therefore also rescales by the
 * difference in exponents, which is the step that is easy to omit and
 * produces an answer wrong by a factor of a hundred — large enough to notice,
 * which is the only mercy in it.
 */

/** Decimal places kept for a rate; matches `numeric(20, 10)` in the schema. */
export const RATE_SCALE = 10;

const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

export type RateParseError = 'malformed' | 'not_positive' | 'too_precise';

/** `"25470.5"` → `254705000000n` (scaled by 10^10). */
export function parseRate(rate: string): bigint | RateParseError {
  const trimmed = rate.trim();
  if (!/^\d+(\.\d+)?$/u.test(trimmed)) return 'malformed';

  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > RATE_SCALE) return 'too_precise';

  const scaled = BigInt(whole) * RATE_FACTOR + BigInt(fraction.padEnd(RATE_SCALE, '0') || '0');
  return scaled > 0n ? scaled : 'not_positive';
}

/** `254705000000n` → `"25470.5"`, trailing zeros trimmed. */
export function formatRate(scaled: bigint): string {
  const whole = scaled / RATE_FACTOR;
  const fraction = (scaled % RATE_FACTOR).toString().padStart(RATE_SCALE, '0').replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Divide, rounding half away from zero.
 *
 * Half *away from zero* rather than JavaScript's `Math.round`, which rounds
 * half *up* — so -0.5 becomes -0 and 0.5 becomes 1. Applied to money that
 * makes a credit and its mirrored debit round to different magnitudes, and an
 * entry that was balanced before conversion is unbalanced after it.
 *
 * Exported because it is the ledger's rounding *policy*, not an FX detail:
 * inventory costing apportions a layer's cost across a partial issue and has
 * to round the same way, or the two halves of one purchase disagree.
 */
export function divideRounding(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absolute = (numerator < 0n ? -numerator : numerator) * 2n;
  const divisor = denominator < 0n ? -denominator : denominator;
  const magnitude = (absolute + divisor) / (divisor * 2n);
  return negative ? -magnitude : magnitude;
}

/**
 * `amount` in `from`'s minor units → the equivalent in `to`'s minor units.
 *
 * `rate` is scaled by `RATE_SCALE` and expresses how many units of `to` one
 * unit of `from` is worth.
 */
export function convert(input: {
  amount: MinorUnits;
  from: CurrencyCode;
  to: CurrencyCode;
  rate: bigint;
}): MinorUnits {
  if (input.from === input.to) return input.amount;

  // One multiplication, one division, both on integers, and the exponent
  // difference folded into the same fraction so there is only one rounding.
  const exponentShift = exponentOf(input.to) - exponentOf(input.from);
  const numerator = BigInt(input.amount) * input.rate;
  const scaledNumerator = exponentShift >= 0 ? numerator * 10n ** BigInt(exponentShift) : numerator;
  const denominator =
    exponentShift >= 0 ? RATE_FACTOR : RATE_FACTOR * 10n ** BigInt(-exponentShift);

  return divideRounding(scaledNumerator, denominator) as MinorUnits;
}

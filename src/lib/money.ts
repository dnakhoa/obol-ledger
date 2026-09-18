import { err, ok, type Result } from './result';

/**
 * Money, stored as an integer count of a currency's *minor units*.
 *
 * Two rules drive this module:
 *
 * 1. Never use floating point. `0.1 + 0.2 !== 0.3` under IEEE-754, and a ledger
 *    that loses a cent per thousand postings is worthless. Amounts are `bigint`
 *    from the HTTP boundary all the way into Postgres' `bigint` column.
 * 2. Not every currency has two decimal places. JPY has zero, BHD has three.
 *    Hard-coding `* 100` is the second-most common money bug, so the exponent
 *    comes from a registry and parsing/formatting are driven by it.
 */

/** A currency's minor-unit exponent, per ISO 4217. */
const CURRENCY_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  JPY: 0,
  VND: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

// Typed as a non-empty tuple so it can drive a zod enum directly, keeping the
// validated set and the exponent registry from ever drifting apart.
export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENTS) as [
  CurrencyCode,
  ...CurrencyCode[],
];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function exponentOf(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency];
}

declare const minorUnitsBrand: unique symbol;

/**
 * A signed amount in minor units. Branded so a bare `bigint` — a row count, an
 * id, a length — cannot be passed where money is expected.
 */
export type MinorUnits = bigint & { readonly [minorUnitsBrand]: 'MinorUnits' };

export const ZERO = 0n as MinorUnits;

/** Asserts that a raw bigint is being used deliberately as money. */
export function minorUnits(value: bigint): MinorUnits {
  return value as MinorUnits;
}

export function add(a: MinorUnits, b: MinorUnits): MinorUnits {
  return (a + b) as MinorUnits;
}

export function subtract(a: MinorUnits, b: MinorUnits): MinorUnits {
  return (a - b) as MinorUnits;
}

export function negate(a: MinorUnits): MinorUnits {
  return -a as MinorUnits;
}

export function sum(amounts: readonly MinorUnits[]): MinorUnits {
  return amounts.reduce<MinorUnits>((total, amount) => add(total, amount), ZERO);
}

export function absolute(a: MinorUnits): MinorUnits {
  return (a < 0n ? -a : a) as MinorUnits;
}

/** Postgres `bigint` is 64-bit; reject anything that would not survive the round trip. */
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

export function isStorableAmount(value: bigint): boolean {
  return value >= INT64_MIN && value <= INT64_MAX;
}

export type MoneyParseError =
  | { readonly kind: 'malformed'; readonly input: string }
  | { readonly kind: 'too_many_decimals'; readonly input: string; readonly maxDecimals: number }
  | { readonly kind: 'out_of_range'; readonly input: string };

const DECIMAL_PATTERN = /^(?<sign>[+-])?(?<whole>\d+)(?:\.(?<fraction>\d+))?$/u;

/**
 * Parses a human decimal string ("-1234.50") into minor units for a currency.
 *
 * Deliberately string-based: accepting a JS `number` here would mean the caller
 * had already rounded, and we would have no way to detect it. The API layer
 * therefore requires amounts as strings or integers, never as floats.
 */
export function parseDecimal(
  input: string,
  currency: CurrencyCode,
): Result<MinorUnits, MoneyParseError> {
  const trimmed = input.trim();
  const match = DECIMAL_PATTERN.exec(trimmed);
  if (!match?.groups) return err({ kind: 'malformed', input });

  const {
    sign,
    whole,
    fraction = '',
  } = match.groups as {
    sign?: string;
    whole: string;
    fraction?: string;
  };

  const exponent = exponentOf(currency);
  if (fraction.length > exponent) {
    return err({ kind: 'too_many_decimals', input, maxDecimals: exponent });
  }

  const scaled = BigInt(whole + fraction.padEnd(exponent, '0'));
  const signed = sign === '-' ? -scaled : scaled;
  if (!isStorableAmount(signed)) return err({ kind: 'out_of_range', input });

  return ok(signed as MinorUnits);
}

/**
 * Renders minor units as a plain decimal string ("-1234.50").
 *
 * Locale-aware presentation belongs in the UI; this stays pure so it can be
 * asserted on exactly and used in API responses, where a locale would be wrong.
 */
export function toDecimalString(amount: MinorUnits, currency: CurrencyCode): string {
  const exponent = exponentOf(currency);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(exponent + 1, '0');
  const boundary = digits.length - exponent;
  const whole = digits.slice(0, boundary);
  const fraction = digits.slice(boundary);
  const magnitude = exponent === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${magnitude}` : magnitude;
}

/** A complete monetary value: an amount is meaningless without its currency. */
export type Money = {
  readonly amount: MinorUnits;
  readonly currency: CurrencyCode;
};

export function money(amount: MinorUnits, currency: CurrencyCode): Money {
  return { amount, currency };
}

export function formatMoney(value: Money): string {
  return `${toDecimalString(value.amount, value.currency)} ${value.currency}`;
}

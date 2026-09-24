import { divideRounding } from '@/lib/fx';
import type { TaxCalculation, TaxLeg } from './tax';

/**
 * What an invoice is worth in the books' own currency, and what was made on it.
 *
 * Pure arithmetic, like `costing.ts` beside it: the service reads the lots and
 * the rate and posts the entry; this decides the numbers, and can be checked
 * by hand against the invoice it describes.
 */

export type PricedSale = {
  /** Each line's net price in the functional currency, in line order. */
  readonly lineBases: readonly bigint[];
  /** Their sum. The revenue leg, and what the lines must add back up to. */
  readonly baseNet: bigint;
  /** The tax, in the functional currency. Zero when none is charged. */
  readonly baseTax: bigint;
  /** The tax legs, converted, signs kept. */
  readonly taxLegs: readonly TaxLeg[];
  /** What the customer's leg is worth in the functional currency. */
  readonly receivableBase: bigint;
};

/**
 * Converts an invoice to the functional currency, one figure at a time.
 *
 * **Each line is converted on its own.** The alternative — convert the total
 * and apportion it back across the lines — gives the same header but makes
 * every line's revenue depend on its neighbours, so adding a line to an
 * invoice would change the margin reported on the others. Converting each line
 * makes a line's revenue a fact about that line, and the header is their sum
 * by construction; the database checks the sum again at commit.
 *
 * **The customer's leg is derived, not converted.** It is whatever balances
 * the entry: net revenue plus the tax legs. Converting the gross separately
 * would round a third time and leave the entry out by a dong, which the
 * balance rule would rightly refuse.
 *
 * `toBase` must be symmetric in sign — `toBase(-x) === -toBase(x)` — which the
 * ledger's rounding is, being half away from zero.
 */
export function priceSale(
  lineAmounts: readonly bigint[],
  tax: TaxCalculation,
  toBase: (amount: bigint) => bigint,
): PricedSale {
  const lineBases = lineAmounts.map(toBase);
  const baseNet = lineBases.reduce((sum, value) => sum + value, 0n);
  const taxLegs = tax.legs.map((leg) => ({ accountId: leg.accountId, amount: toBase(leg.amount) }));
  const legTotal = taxLegs.reduce((sum, leg) => sum + leg.amount, 0n);

  return {
    lineBases,
    baseNet,
    baseTax: toBase(tax.tax),
    taxLegs,
    // A sale's tax legs are credits (negative), so subtracting them adds the
    // tax to what the customer owes.
    receivableBase: baseNet - legTotal,
  };
}

export type Margin = {
  readonly revenue: bigint;
  readonly cost: bigint;
  /** Revenue less cost. Negative when the goods were sold at a loss. */
  readonly margin: bigint;
  /**
   * The margin as a share of revenue, in basis points — 2,350 is 23.5%.
   *
   * Null rather than zero when there is no revenue: a line given away has an
   * undefined margin, not a zero one, and printing 0% beside it would claim it
   * broke even.
   */
  readonly basisPoints: number | null;
};

export function marginOf(revenue: bigint, cost: bigint): Margin {
  const margin = revenue - cost;
  return {
    revenue,
    cost,
    margin,
    basisPoints: revenue === 0n ? null : Number(divideRounding(margin * 10_000n, revenue)),
  };
}

/** `2350` → `23.5%`, `-412` → `-4.12%`. */
export function formatBasisPoints(basisPoints: number): string {
  const negative = basisPoints < 0;
  const magnitude = Math.abs(basisPoints);
  const whole = Math.trunc(magnitude / 100);
  const fraction = String(magnitude % 100)
    .padStart(2, '0')
    .replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}%`;
}

import { divideRounding } from './fx';
import { parseDecimal, type CurrencyCode, type MinorUnits } from './money';

export type InvoiceTotals = {
  readonly net: MinorUnits;
  readonly tax: MinorUnits;
  readonly gross: MinorUnits;
};

/**
 * What an invoice will come to, while it is still being typed.
 *
 * The same arithmetic the ledger runs when the invoice is raised — minor units
 * of the invoice's own currency, tax on the net total rounded half away from
 * zero — so the figure the person checks against their paper invoice is the
 * figure that will be posted, not an approximation of it. A preview that
 * rounds differently from the posting is a preview that disagrees by a dong
 * on exactly the invoices somebody checks.
 *
 * Blank lines are skipped, because a row just added is not yet an error. An
 * amount that cannot be read in this currency — letters, or three decimals of
 * a two-decimal currency — returns null: a total that silently left a line out
 * would be worse than no total.
 */
export function invoiceTotals(
  amounts: readonly string[],
  currency: CurrencyCode,
  taxBasisPoints: number,
): InvoiceTotals | null {
  let net = 0n;
  for (const amount of amounts) {
    if (amount.trim() === '') continue;
    const parsed = parseDecimal(amount, currency);
    if (!parsed.ok || parsed.value < 0n) return null;
    net += parsed.value;
  }
  const tax = divideRounding(net * BigInt(taxBasisPoints), 10_000n);
  return {
    net: net as MinorUnits,
    tax: tax as MinorUnits,
    gross: (net + tax) as MinorUnits,
  };
}

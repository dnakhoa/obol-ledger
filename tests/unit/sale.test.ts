import { describe, expect, it } from 'vitest';
import { convert, parseRate } from '@/lib/fx';
import { minorUnits, type CurrencyCode } from '@/lib/money';
import { formatBasisPoints, marginOf, priceSale } from '@/server/domain/sale';
import type { TaxCalculation } from '@/server/domain/tax';

/**
 * The arithmetic of an invoice, checkable by hand.
 *
 * The property that matters is that the entry balances whatever the rate and
 * however the lines divide — which in dong means to the dong, because the
 * balance rule has no tolerance and should not have one.
 */

const toVnd = (rate: string) => (amount: bigint) => {
  const scaled = parseRate(rate);
  if (typeof scaled !== 'bigint') throw new Error(scaled);
  return convert({
    amount: minorUnits(amount),
    from: 'USD' as CurrencyCode,
    to: 'VND' as CurrencyCode,
    rate: scaled,
  });
};

const noTax = (net: bigint): TaxCalculation => ({ net, tax: 0n, gross: net, legs: [] });

describe('priceSale', () => {
  it('converts each line on its own, so a line’s revenue is a fact about that line', () => {
    // 3 lines at 25,470.5: each rounds on its own and the header is their sum.
    const priced = priceSale([1_00n, 1_00n, 1_00n], noTax(3_00n), toVnd('25470.5'));
    expect(priced.lineBases).toEqual([25_471n, 25_471n, 25_471n]);
    expect(priced.baseNet).toBe(76_413n);
    expect(priced.receivableBase).toBe(76_413n);
  });

  it('derives the customer’s leg, so the entry balances to the dong', () => {
    const tax: TaxCalculation = {
      net: 3_00n,
      tax: 30n,
      gross: 3_30n,
      legs: [{ accountId: 'acct_vat', amount: -30n }],
    };
    const priced = priceSale([1_00n, 1_00n, 1_00n], tax, toVnd('25470.5'));

    // Converting the gross on its own would give 84,053; the legs give
    // 76,413 + 7,641 = 84,054. The derived figure is the one that balances.
    expect(priced.baseTax).toBe(7_641n);
    expect(priced.taxLegs).toEqual([{ accountId: 'acct_vat', amount: -7_641n }]);
    expect(priced.receivableBase).toBe(84_054n);
    expect(
      priced.receivableBase -
        priced.baseNet +
        priced.taxLegs.reduce((sum, leg) => sum + leg.amount, 0n),
    ).toBe(0n);
  });

  it('is the identity in the functional currency', () => {
    const priced = priceSale([120_000n, 80_000n], noTax(200_000n), (x) => x);
    expect(priced.baseNet).toBe(200_000n);
    expect(priced.receivableBase).toBe(200_000n);
  });
});

describe('marginOf', () => {
  it('is revenue less cost, and its share of revenue in basis points', () => {
    expect(marginOf(1_000_000n, 765_000n)).toEqual({
      revenue: 1_000_000n,
      cost: 765_000n,
      margin: 235_000n,
      basisPoints: 2350,
    });
  });

  it('goes negative on a loss rather than hiding it', () => {
    expect(marginOf(100n, 104n).basisPoints).toBe(-400);
  });

  it('has no percentage when nothing was charged', () => {
    // A sample given away has an undefined margin, not a zero one.
    expect(marginOf(0n, 500n).basisPoints).toBeNull();
  });
});

describe('formatBasisPoints', () => {
  it('prints the places that carry information', () => {
    expect(formatBasisPoints(2350)).toBe('23.5%');
    expect(formatBasisPoints(2300)).toBe('23%');
    expect(formatBasisPoints(-412)).toBe('-4.12%');
    expect(formatBasisPoints(5)).toBe('0.05%');
  });
});

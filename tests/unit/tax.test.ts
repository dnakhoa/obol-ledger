import { describe, expect, it } from 'vitest';
import { applyTax, formatRate, fromGross, fromNet, type TaxCode } from '@/server/domain/tax';

/**
 * Three mechanisms wearing one name. Modelling them as one rate with one
 * account is wrong in a way that only surfaces when somebody files a return,
 * by which time a quarter of the entries are wrong.
 */
const vat: TaxCode = {
  id: 'tax_vat',
  name: 'GTGT 10%',
  rateBasisPoints: 1000,
  treatment: 'vat',
  inputAccountId: 'acct_input',
  outputAccountId: 'acct_output',
};

const salesTax: TaxCode = {
  id: 'tax_us',
  name: 'Washington sales tax',
  rateBasisPoints: 825,
  treatment: 'sales_tax',
  // No input account, by law — and the US chart of accounts ships without one.
  inputAccountId: null,
  outputAccountId: 'acct_sales_tax',
};

const reverseCharge: TaxCode = {
  id: 'tax_rc',
  name: 'EU reverse charge',
  rateBasisPoints: 2000,
  treatment: 'reverse_charge',
  inputAccountId: 'acct_input',
  outputAccountId: 'acct_output',
};

describe('extracting the tax', () => {
  it('adds it to a net amount', () => {
    expect(fromNet(1_000_00n, 1000)).toEqual({ net: 1_000_00n, tax: 100_00n });
  });

  it('takes it out of a gross amount so the two add back to the price', () => {
    // Prices are quoted inclusive in Vietnam and Japan. Rounding both sides
    // independently leaves a dong that reconciles to nothing, so the net is
    // rounded and the tax takes the remainder.
    const { net, tax } = fromGross(1_100_00n, 1000);
    expect(net + tax).toBe(1_100_00n);
    expect(net).toBe(1_000_00n);
  });

  it('keeps that exact on amounts that do not divide', () => {
    for (const gross of [1n, 7n, 99n, 100_01n, 999_983n, 1_234_567n]) {
      for (const rate of [500, 800, 825, 1000, 2000]) {
        const { net, tax } = fromGross(gross, rate);
        expect(net + tax).toBe(gross);
      }
    }
  });
});

describe('value added tax', () => {
  it('credits what is owed to the state on a sale', () => {
    const result = applyTax(vat, 'sale', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gross).toBe(1_100_00n);
    expect(result.value.legs).toEqual([{ accountId: 'acct_output', amount: -100_00n }]);
  });

  it('debits what can be reclaimed on a purchase', () => {
    const result = applyTax(vat, 'purchase', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs).toEqual([{ accountId: 'acct_input', amount: 100_00n }]);
  });
});

describe('United States sales tax', () => {
  it('is collected on a sale', () => {
    const result = applyTax(salesTax, 'sale', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tax).toBe(82_50n);
    expect(result.value.legs).toEqual([{ accountId: 'acct_sales_tax', amount: -82_50n }]);
  });

  it('is not separated out on a purchase, because it is never reclaimable', () => {
    // It is part of what the thing cost. An input-tax account here would
    // accumulate a receivable from a state that does not owe it, and the
    // accounts would balance perfectly while the asset was fictional.
    const result = applyTax(salesTax, 'purchase', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tax).toBe(0n);
    expect(result.value.legs).toEqual([]);
    expect(result.value.gross).toBe(1_000_00n);
  });
});

describe('EU reverse charge', () => {
  it('books both sides on a purchase, netting to nothing', () => {
    // Not "no tax". Both entries have to appear on the return, and a system
    // that posts neither cannot produce one.
    const result = applyTax(reverseCharge, 'purchase', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.legs).toEqual([
      { accountId: 'acct_input', amount: 200_00n },
      { accountId: 'acct_output', amount: -200_00n },
    ]);
    // The supplier is owed the net only — the tax changes no hands.
    expect(result.value.gross).toBe(1_000_00n);
    expect(result.value.legs.reduce((sum, leg) => sum + leg.amount, 0n)).toBe(0n);
  });

  it('charges nothing on a sale, because the obligation moved to the buyer', () => {
    const result = applyTax(reverseCharge, 'sale', 1_000_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tax).toBe(0n);
    expect(result.value.legs).toEqual([]);
  });
});

describe('refusals', () => {
  it('refuses VAT with no account for the side it needs', () => {
    const broken = { ...vat, inputAccountId: null };
    expect(applyTax(broken, 'purchase', 100n)).toEqual({
      ok: false,
      error: { code: 'tax_account_missing', treatment: 'vat', side: 'input' },
    });
  });

  it('refuses reverse charge that can only book one side', () => {
    const broken = { ...reverseCharge, outputAccountId: null };
    expect(applyTax(broken, 'purchase', 100n)).toEqual({
      ok: false,
      error: { code: 'tax_account_missing', treatment: 'reverse_charge', side: 'output' },
    });
  });
});

describe('formatting a rate', () => {
  it.each([
    [1000, '10%'],
    [825, '8.25%'],
    [500, '5%'],
    [0, '0%'],
    [1750, '17.5%'],
  ])('%i basis points is %s', (basis, expected) => {
    expect(formatRate(basis)).toBe(expected);
  });
});

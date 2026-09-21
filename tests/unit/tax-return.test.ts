import { describe, expect, it } from 'vitest';
import { buildReturn, clearingLegs, type TaxEntryLine } from '@/server/domain/tax-return';

/**
 * A return is not `output - input`. It is that only when the answer is
 * positive — and the case where it is not is the one every jurisdiction has
 * rules about.
 */
function line(over: Partial<TaxEntryLine> & Pick<TaxEntryLine, 'supply'>): TaxEntryLine {
  return {
    taxCodeId: 'tax_vat',
    name: 'GTGT 10%',
    treatment: 'vat',
    rateBasisPoints: 1000,
    base: 1_000_00n,
    tax: 100_00n,
    ...over,
  };
}

describe('a period that owes tax', () => {
  it('pays the difference between what it charged and what it paid', () => {
    const result = buildReturn(
      [
        line({ supply: 'sale', base: 10_000_00n, tax: 1_000_00n }),
        line({ supply: 'purchase', base: 4_000_00n, tax: 400_00n }),
      ],
      0n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.outputTax).toBe(1_000_00n);
    expect(result.value.inputTax).toBe(400_00n);
    expect(result.value.payable).toBe(600_00n);
    expect(result.value.carriedForward).toBe(0n);
  });

  it('spends an opening credit before paying anything', () => {
    const result = buildReturn(
      [
        line({ supply: 'sale', base: 10_000_00n, tax: 1_000_00n }),
        line({ supply: 'purchase', base: 4_000_00n, tax: 400_00n }),
      ],
      250_00n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,000 owed, 400 input, 250 brought forward: 350 left to pay.
    expect(result.value.payable).toBe(350_00n);
    expect(result.value.carriedForward).toBe(0n);
  });
});

describe('a period that is owed tax', () => {
  it('carries the excess forward instead of claiming a refund', () => {
    // A quarter with a big import and few sales. Most systems do not refund
    // this — it becomes next period's opening credit, which is why a run of
    // returns is a chain rather than a series of independent subtractions.
    const result = buildReturn(
      [
        line({ supply: 'sale', base: 1_000_00n, tax: 100_00n }),
        line({ supply: 'purchase', base: 13_000_00n, tax: 1_300_00n }),
      ],
      0n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.payable).toBe(0n);
    expect(result.value.carriedForward).toBe(1_200_00n);
  });

  it('adds an opening credit to the one it carries on', () => {
    const result = buildReturn([line({ supply: 'purchase', tax: 100_00n })], 50_00n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.carriedForward).toBe(150_00n);
    expect(result.value.payable).toBe(0n);
  });

  it('never reports a negative payable', () => {
    const result = buildReturn([line({ supply: 'purchase', tax: 999_99n })], 0n);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payable).toBe(0n);
  });
});

describe('the three mechanisms on one return', () => {
  it('lets a reverse charge appear on both sides and change nothing', () => {
    // A cross-border acquisition books output tax and input tax of the same
    // amount. Both belong on the return — a system that posted neither could
    // not produce one — and together they contribute nothing to the payable.
    const result = buildReturn(
      [
        line({ supply: 'sale', tax: 500_00n, base: 5_000_00n }),
        line({
          taxCodeId: 'tax_rc',
          name: 'EU reverse charge 20%',
          treatment: 'reverse_charge',
          rateBasisPoints: 2000,
          supply: 'purchase',
          base: 2_000_00n,
          tax: 400_00n,
        }),
        line({
          taxCodeId: 'tax_rc',
          name: 'EU reverse charge 20%',
          treatment: 'reverse_charge',
          rateBasisPoints: 2000,
          supply: 'sale',
          base: 2_000_00n,
          tax: 400_00n,
        }),
      ],
      0n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.outputTax).toBe(900_00n);
    expect(result.value.inputTax).toBe(400_00n);
    // The reverse charge nets out: only the domestic sale is really owed.
    expect(result.value.payable).toBe(500_00n);
    // And it is visible on both sides, which is what the form asks for.
    expect(result.value.sales.map((b) => b.taxCodeId)).toContain('tax_rc');
    expect(result.value.purchases.map((b) => b.taxCodeId)).toContain('tax_rc');
  });

  it('gives US sales tax no input side at all', () => {
    const result = buildReturn(
      [
        {
          taxCodeId: 'tax_us',
          name: 'WA sales tax',
          treatment: 'sales_tax',
          rateBasisPoints: 825,
          supply: 'sale',
          base: 10_000_00n,
          tax: 825_00n,
        },
      ],
      0n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.inputTax).toBe(0n);
    expect(result.value.payable).toBe(825_00n);
  });

  it('keeps two codes at the same rate on separate lines', () => {
    // A domestic 10% sale and a 10% reverse charge are both 10% and belong on
    // different lines of the form, so bands group by code rather than rate.
    const result = buildReturn(
      [
        line({ supply: 'sale', taxCodeId: 'a', name: 'Domestic 10%' }),
        line({ supply: 'sale', taxCodeId: 'b', name: 'Export 10%' }),
      ],
      0n,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sales).toHaveLength(2);
  });
});

describe('the entry that files it', () => {
  it('clears both accounts and books the difference as payable', () => {
    const figures = buildReturn(
      [line({ supply: 'sale', tax: 1_300_00n }), line({ supply: 'purchase', tax: 1_000_00n })],
      0n,
    );
    if (!figures.ok) return;

    const legs = clearingLegs(figures.value);
    expect(legs).toEqual({ output: 1_300_00n, input: 1_000_00n, payable: 300_00n });
    // Debits equal credits, which is the only reason to trust the other two.
    expect(legs.output).toBe(legs.input + legs.payable);
  });

  it('leaves an unused credit sitting in the input account', () => {
    // This is what "carried forward" means in the books: the next period finds
    // it already there rather than having to remember a number off a form.
    const figures = buildReturn(
      [line({ supply: 'sale', tax: 100_00n }), line({ supply: 'purchase', tax: 130_00n })],
      0n,
    );
    if (!figures.ok) return;

    const legs = clearingLegs(figures.value);
    expect(legs).toEqual({ output: 100_00n, input: 100_00n, payable: 0n });
    // 30 stays in the input account — and equals what the return carries on.
    expect(figures.value.inputTax - legs.input).toBe(figures.value.carriedForward);
  });
});

describe('refusals', () => {
  it('refuses a negative opening credit', () => {
    expect(buildReturn([], -1n)).toEqual({
      ok: false,
      error: { code: 'negative_brought_forward' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { creditTax, lineAmounts, restore, shareOf } from '@/server/domain/credit-note';
import { ageAccount } from '@/server/domain/aging';

describe('shareOf', () => {
  it('takes exactly what is left when the part is everything outstanding', () => {
    // 1,000,001 across 3: rounding each third would leave a unit behind.
    const whole = { original: 1_000_001n, taken: 666_667n };
    expect(shareOf(whole, 1n, { original: 3n, taken: 2n })).toBe(333_334n);
  });

  it('converges on the total whatever the instalments', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 1n, max: 1000n }), { minLength: 1, maxLength: 12 }),
        (total, parts) => {
          const basis = parts.reduce((sum, part) => sum + part, 0n);
          let takenWhole = 0n;
          let takenBasis = 0n;
          for (const part of parts) {
            const share = shareOf({ original: total, taken: takenWhole }, part, {
              original: basis,
              taken: takenBasis,
            });
            expect(share).toBeGreaterThanOrEqual(0n);
            takenWhole += share;
            takenBasis += part;
          }
          expect(takenWhole).toBe(total);
        },
      ),
    );
  });
});

describe('restore', () => {
  const draws = [
    {
      consumptionId: 'draw_a',
      layerId: 'layer_a',
      acquiredAt: new Date('2026-01-02'),
      quantity: 1000n,
      cost: 200n,
      baseCost: 200n,
      restoredQuantity: 0n,
      restoredCost: 0n,
      restoredBaseCost: 0n,
    },
    {
      consumptionId: 'draw_b',
      layerId: 'layer_b',
      acquiredAt: new Date('2026-01-03'),
      quantity: 500n,
      cost: 125n,
      baseCost: 125n,
      restoredQuantity: 0n,
      restoredCost: 0n,
      restoredBaseCost: 0n,
    },
  ];

  it('refills the newest lot first, then the older one', () => {
    const result = restore(draws, 700n);
    expect(result).toEqual({
      ok: true,
      restorations: [
        { consumptionId: 'draw_b', layerId: 'layer_b', quantity: 500n, cost: 125n, baseCost: 125n },
        { consumptionId: 'draw_a', layerId: 'layer_a', quantity: 200n, cost: 40n, baseCost: 40n },
      ],
    });
  });

  it('refuses to bring back more than left, naming how much can', () => {
    expect(restore(draws, 1501n)).toEqual({ ok: false, returnable: 1500n });
  });

  it('counts what earlier returns already brought back', () => {
    const partly = draws.map((draw) =>
      draw.consumptionId === 'draw_b'
        ? { ...draw, restoredQuantity: 499n, restoredCost: 124n, restoredBaseCost: 124n }
        : draw,
    );
    const result = restore(partly, 1n);
    // The last unit of the draw takes the last of its cost, whatever the
    // rounding did to the 499 before it.
    expect(result).toEqual({
      ok: true,
      restorations: [
        { consumptionId: 'draw_b', layerId: 'layer_b', quantity: 1n, cost: 1n, baseCost: 1n },
      ],
    });
  });
});

describe('creditTax', () => {
  const invoice = {
    net: { original: 25n, taken: 20n },
    tax: { original: 3n, taken: 3n },
    baseTax: { original: 3n, taken: 3n },
  };
  const tenPercent = (net: bigint) => (net * 10n + 5n) / 100n;

  it('never takes back more tax than the invoice charged', () => {
    // Four credits of 5 at 10% round to 1 each; the invoice charged only 3.
    expect(
      creditTax({
        net: 4n,
        invoice: { ...invoice, net: { original: 25n, taken: 15n } },
        taxOn: tenPercent,
        toBase: (x) => x,
      }),
    ).toEqual({ tax: 0n, baseTax: 0n });
  });

  it('takes the rest of the tax exactly with the final credit', () => {
    expect(
      creditTax({
        net: 5n,
        invoice: {
          ...invoice,
          tax: { original: 3n, taken: 2n },
          baseTax: { original: 3n, taken: 2n },
        },
        taxOn: tenPercent,
        toBase: (x) => x,
      }),
    ).toEqual({ tax: 1n, baseTax: 1n });
  });
});

describe('lineAmounts', () => {
  it('uses what each line recorded when every line recorded it', () => {
    expect(
      lineAmounts(10n, [
        { amount: 3n, revenueBase: 76_200n },
        { amount: 7n, revenueBase: 177_800n },
      ]),
    ).toEqual([3n, 7n]);
  });

  it('apportions the invoice across older lines by their revenue, adding back up', () => {
    const amounts = lineAmounts(1_000n, [
      { amount: null, revenueBase: 1n },
      { amount: null, revenueBase: 1n },
      { amount: null, revenueBase: 1n },
    ]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(1_000n);
  });
});

describe('ageing a credit that names its invoice', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 0, d));
  const invoice = (id: string, d: number, amount: bigint) => ({
    id,
    occurredAt: day(d),
    amount,
    description: id,
    reference: id,
  });

  it('settles the named invoice first, and only the remainder oldest-first', () => {
    const aged = ageAccount(
      [
        invoice('INV-1', 1, 100n),
        invoice('INV-2', 5, 300n),
        { ...invoice('CN-1', 10, -350n), reference: 'CN-1', appliesTo: 'INV-2' },
      ],
      day(20),
      'debit',
    );
    expect(aged.items.map((item) => [item.reference, item.outstanding])).toEqual([['INV-1', 50n]]);
  });
});

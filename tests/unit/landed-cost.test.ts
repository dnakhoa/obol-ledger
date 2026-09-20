import { describe, expect, it } from 'vitest';
import { allocateCharge, type ChargeableLayer } from '@/server/domain/landed-cost';

/**
 * What the stone cost to get here.
 *
 * The arithmetic is the whole feature: a freight invoice that does not
 * reconcile to the sum of what it was spread over is a freight invoice
 * somebody spends an afternoon on.
 */
function layer(overrides: Partial<ChargeableLayer> & { id: string }): ChargeableLayer {
  return {
    quantity: 1000_00n,
    remainingQuantity: 1000_00n,
    baseCost: 40_000_00n,
    weight: null,
    unit: 'm2',
    ...overrides,
  };
}

/** Two containers on one bill of lading, one worth three times the other. */
const shipment = [
  layer({ id: 'layer_a', baseCost: 30_000_00n, quantity: 600_00n, remainingQuantity: 600_00n }),
  layer({ id: 'layer_b', baseCost: 10_000_00n, quantity: 400_00n, remainingQuantity: 400_00n }),
];

describe('allocating a charge', () => {
  it('spreads freight by value', () => {
    const result = allocateCharge(shipment, 4_000_00n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines.map((l) => [l.layerId, l.amount])).toEqual([
      ['layer_a', 3_000_00n],
      ['layer_b', 1_000_00n],
    ]);
  });

  it('spreads by quantity when that is the fairer basis', () => {
    // Ocean freight is charged by volume, not by what the stone is worth.
    const result = allocateCharge(shipment, 1_000_00n, 'quantity');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines.map((l) => l.amount)).toEqual([600_00n, 400_00n]);
  });

  it('refuses to spread by quantity across different units', () => {
    // Adding tonnes to square metres produces a number that comes out and
    // means nothing.
    const mixed = [shipment[0]!, layer({ id: 'layer_c', unit: 'tonne' })];
    const result = allocateCharge(mixed, 100_00n, 'quantity');
    expect(result).toEqual({ ok: false, error: { code: 'mixed_units', units: ['m2', 'tonne'] } });
  });

  it('names the lots that have no weight rather than treating them as weightless', () => {
    const result = allocateCharge(shipment, 100_00n, 'weight');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'weight_missing',
      layerIds: ['layer_a', 'layer_b'],
    });
  });

  it('reconciles to the charge, to the cent', () => {
    // 1,000.01 across three lots with prime values: the case where rounding
    // each share independently loses or invents a cent.
    const awkward = [
      layer({ id: 'a', baseCost: 7_00n }),
      layer({ id: 'b', baseCost: 11_00n }),
      layer({ id: 'c', baseCost: 13_00n }),
    ];
    const result = allocateCharge(awkward, 1_000_01n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const total = result.value.lines.reduce((sum, line) => sum + line.amount, 0n);
    expect(total).toBe(1_000_01n);
    expect(result.value.toInventory + result.value.toCogs).toBe(1_000_01n);
  });
});

describe('a charge that arrives after some of the stock has sold', () => {
  it('puts the sold portion to cost of sales, not onto a lot that has gone', () => {
    // The freight invoice turns up six weeks after the container did, by which
    // time three quarters of it has shipped. That cost cannot be added to
    // stock nobody has, and the COGS it belongs to is already posted and
    // append-only — so it goes to cost of sales now.
    const sold = [layer({ id: 'layer_a', quantity: 1000_00n, remainingQuantity: 250_00n })];
    const result = allocateCharge(sold, 4_000_00n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.toInventory).toBe(1_000_00n);
    expect(result.value.toCogs).toBe(3_000_00n);
  });

  it('capitalises the whole charge when nothing has moved', () => {
    const result = allocateCharge(shipment, 4_000_00n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toCogs).toBe(0n);
    expect(result.value.toInventory).toBe(4_000_00n);
  });

  it('expenses the whole charge when the lot has sold through', () => {
    const gone = [layer({ id: 'layer_a', remainingQuantity: 0n })];
    const result = allocateCharge(gone, 4_000_00n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toInventory).toBe(0n);
    expect(result.value.toCogs).toBe(4_000_00n);
  });

  it('splits each line exactly, with no cent left between the two halves', () => {
    const partly = [
      layer({ id: 'a', baseCost: 7_00n, quantity: 300n, remainingQuantity: 101n }),
      layer({ id: 'b', baseCost: 11_00n, quantity: 300n, remainingQuantity: 199n }),
    ];
    const result = allocateCharge(partly, 999_99n, 'value');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const line of result.value.lines) {
      expect(line.toInventory + line.toCogs).toBe(line.amount);
    }
    expect(result.value.toInventory + result.value.toCogs).toBe(999_99n);
  });
});

describe('refusals', () => {
  it('refuses a shipment with no lots', () => {
    expect(allocateCharge([], 100n, 'value')).toEqual({ ok: false, error: { code: 'no_layers' } });
  });

  it('refuses a charge of nothing', () => {
    expect(allocateCharge(shipment, 0n, 'value')).toEqual({
      ok: false,
      error: { code: 'nothing_to_allocate' },
    });
  });
});

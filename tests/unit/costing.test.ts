import { describe, expect, it } from 'vitest';
import {
  allocate,
  averageUnitCost,
  onHand,
  type CostLayer,
  type CostingMethod,
} from '@/server/domain/costing';
import { parseQuantity, toQuantityString } from '@/lib/quantity';

/**
 * The tests that matter here are the arithmetic ones. The service around this
 * module can be exercised against a database, but whether a partial draw from
 * a layer leaves the layer closeable is a property of the numbers, and it is
 * the property a spreadsheet gets wrong.
 */

function layer(
  id: string,
  quantity: bigint,
  cost: bigint,
  acquiredAt: string,
  baseCost = cost,
): CostLayer {
  return {
    id,
    remainingQuantity: quantity,
    remainingCost: cost,
    remainingBaseCost: baseCost,
    acquiredAt: new Date(acquiredAt),
  };
}

/** Three containers of the same paver at three prices, in arrival order. */
const containers = [
  layer('layer_a', 1000n, 40_000_00n, '2026-01-10T00:00:00Z'),
  layer('layer_b', 800n, 36_000_00n, '2026-02-14T00:00:00Z'),
  layer('layer_c', 1200n, 57_600_00n, '2026-03-02T00:00:00Z'),
];

describe('allocate', () => {
  it('takes the oldest container first under FIFO', () => {
    const result = allocate(containers, 1500n, 'fifo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.draws.map((d) => d.layerId)).toEqual(['layer_a', 'layer_b']);
    expect(result.value.draws[0]?.quantity).toBe(1000n);
    expect(result.value.draws[1]?.quantity).toBe(500n);
    // 1000 at 40.00 plus 500 at 45.00.
    expect(result.value.cost).toBe(40_000_00n + 22_500_00n);
  });

  it('takes the newest container first under LIFO, costing the same stock differently', () => {
    const fifo = allocate(containers, 1500n, 'fifo');
    const lifo = allocate(containers, 1500n, 'lifo');
    expect(fifo.ok && lifo.ok).toBe(true);
    if (!fifo.ok || !lifo.ok) return;

    expect(lifo.value.draws.map((d) => d.layerId)).toEqual(['layer_c', 'layer_b']);
    // FIFO costs them at 62,500 and LIFO at 71,100 — the same 1500 pavers,
    // out of the same yard, and $8,600 of profit between the two answers.
    // That gap is why one of the two is illegal in most of the world.
    expect(fifo.value.cost).toBe(62_500_00n);
    expect(lifo.value.cost).toBe(71_100_00n);
  });

  it('refuses to issue more than is on hand, and says how much there is', () => {
    const result = allocate(containers, 5000n, 'fifo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'insufficient_stock',
      requested: '5000',
      available: '3000',
    });
  });

  it('refuses a zero or negative issue rather than posting an empty entry', () => {
    expect(allocate(containers, 0n, 'fifo')).toEqual({
      ok: false,
      error: { code: 'non_positive_quantity' },
    });
  });
});

describe('specific identification', () => {
  it('draws from the named block, whatever its age', () => {
    const result = allocate(containers, 600n, 'specific', 'layer_c');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draws).toHaveLength(1);
    expect(result.value.draws[0]?.layerId).toBe('layer_c');
    expect(result.value.cost).toBe(28_800_00n);
  });

  it('will not spill into another layer when the named one runs short', () => {
    // FIFO would happily continue into the next container. Specific
    // identification must not: the customer bought *that* block, and there is
    // not enough of it.
    const result = allocate(containers, 1500n, 'specific', 'layer_c');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'insufficient_stock',
      requested: '1500',
      available: '1200',
    });
  });

  it('requires a layer to be named', () => {
    expect(allocate(containers, 10n, 'specific')).toEqual({
      ok: false,
      error: { code: 'layer_required' },
    });
  });
});

describe('weighted average', () => {
  it('costs a draw at the pool average while keeping the audit trail', () => {
    // 100 at 10.00 and 50 at 15.00: 150 units, 1750.00, averaging 11.6666…
    const pool = [
      layer('layer_a', 100n, 1_000_00n, '2026-01-01T00:00:00Z'),
      layer('layer_b', 50n, 750_00n, '2026-02-01T00:00:00Z'),
    ];

    const result = allocate(pool, 30n, 'weighted_average');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Drawn from both, in proportion — not blended into an anonymous number.
    expect(result.value.draws.map((d) => [d.layerId, d.quantity])).toEqual([
      ['layer_a', 20n],
      ['layer_b', 10n],
    ]);
    // And it costs exactly 30 × the pool average, to the cent.
    expect(result.value.cost).toBe(350_00n);
  });

  it('apportions indivisible units by largest remainder, losing none', () => {
    const pool = [
      layer('layer_a', 3n, 30n, '2026-01-01T00:00:00Z'),
      layer('layer_b', 3n, 60n, '2026-02-01T00:00:00Z'),
      layer('layer_c', 3n, 90n, '2026-03-01T00:00:00Z'),
    ];

    // 5 out of 9 does not divide three ways. Every unit must still land.
    const result = allocate(pool, 5n, 'weighted_average');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quantity).toBe(5n);
  });
});

describe('a layer closes exactly', () => {
  /**
   * The property the spreadsheet loses. Issue a layer away in awkward pieces
   * and the quantity and the cost must reach zero on the same movement — if
   * the cost runs out first the account shows stock worth nothing, and if the
   * quantity runs out first the account shows money with no stock behind it.
   */
  it.each<CostingMethod>(['fifo', 'lifo', 'weighted_average'])(
    'under %s, over an indivisible cost',
    (method) => {
      // 7 units for $100.01 — a unit cost that is not a number of cents.
      let remaining: CostLayer[] = [layer('layer_a', 7n, 100_01n, '2026-01-01T00:00:00Z')];
      let drawn = 0n;

      for (const take of [2n, 3n, 1n, 1n]) {
        const result = allocate(remaining, take, method);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        drawn += result.value.cost;
        remaining = remaining.map((l) => {
          const draw = result.value.draws.find((d) => d.layerId === l.id);
          if (!draw) return l;
          return {
            ...l,
            remainingQuantity: l.remainingQuantity - draw.quantity,
            remainingCost: l.remainingCost - draw.cost,
            remainingBaseCost: l.remainingBaseCost - draw.baseCost,
          };
        });
      }

      expect(onHand(remaining)).toEqual({ quantity: 0n, cost: 0n, baseCost: 0n });
      expect(drawn).toBe(100_01n);
    },
  );
});

describe('the functional-currency cost is carried separately', () => {
  it('draws base cost in the same proportion, at the rate on the day it arrived', () => {
    // 1,000 units bought for 40,000 USD when the dong rate was 25,400.
    const imported = [layer('layer_a', 1000n, 40_000_00n, '2026-01-10T00:00:00Z', 1_016_000_000n)];

    const result = allocate(imported, 250n, 'fifo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.cost).toBe(10_000_00n);
    // A quarter of the dong cost, and it never moves again however the rate
    // does: inventory is non-monetary. See docs/adr/0012-fx-revaluation.md.
    expect(result.value.baseCost).toBe(254_000_000n);
  });
});

describe('averageUnitCost', () => {
  it('is null on an empty pool rather than a division by zero', () => {
    expect(averageUnitCost([])).toBeNull();
    expect(averageUnitCost([layer('layer_a', 0n, 0n, '2026-01-01T00:00:00Z')])).toBeNull();
  });

  it('weights by what is left, not by what arrived', () => {
    expect(
      averageUnitCost([
        layer('layer_a', 100n, 1_000_00n, '2026-01-01T00:00:00Z'),
        layer('layer_b', 50n, 750_00n, '2026-02-01T00:00:00Z'),
      ]),
    ).toBe(1_167n); // 11.6666… rounded to the cent, for display only.
  });
});

describe('quantities are scaled integers', () => {
  it('parses a weight to the tonne precision it is traded in', () => {
    const result = parseQuantity('24.687', 3);
    expect(result).toEqual({ ok: true, value: 24_687n });
  });

  it('refuses a digit it would have to throw away', () => {
    // 24.6875 tonnes at three places is not 24.687 tonnes, and rounding it
    // silently is how half a kilo goes missing per container.
    expect(parseQuantity('24.6875', 3)).toEqual({ ok: false, error: 'too_many_decimals' });
  });

  it('refuses a negative quantity, which is a movement direction not an amount', () => {
    expect(parseQuantity('-5', 0)).toEqual({ ok: false, error: 'negative' });
  });

  it('keeps trailing zeroes, because they are the precision', () => {
    expect(toQuantityString(24_600n, 3)).toBe('24.600');
    expect(toQuantityString(1500n, 0)).toBe('1500');
  });
});

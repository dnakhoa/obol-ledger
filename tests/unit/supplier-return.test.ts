import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { supplierRefund } from '@/server/domain/supplier-return';

describe('supplierRefund', () => {
  const atRate = (rate: bigint) => (amount: bigint) => amount * rate;

  it('leaves nothing unrecovered on a lot with nothing landed on it', () => {
    // A remainder-exact carrying share that a fresh conversion would miss by one.
    expect(
      supplierRefund({
        draw: { cost: 333_334n, baseCost: 333_334n },
        landed: false,
        toBase: (amount) => amount - 1n,
      }),
    ).toEqual({ refund: 333_334n, refundBase: 333_334n, carrying: 333_334n, unrecovered: 0n });
  });

  it('sends the landed share to the expense when the supplier refunds its price', () => {
    expect(
      supplierRefund({
        draw: { cost: 400_000n, baseCost: 106_680_000n },
        landed: true,
        toBase: (cents) => (cents * 25_400n) / 100n,
      }),
    ).toEqual({
      refund: 400_000n,
      refundBase: 101_600_000n,
      carrying: 106_680_000n,
      unrecovered: 5_080_000n,
    });
  });

  it('always splits the carrying amount exactly, whatever is refunded', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.option(fc.bigInt({ min: 0n, max: 10n ** 12n }), { nil: undefined }),
        fc.boolean(),
        (cost, baseCost, refund, landed) => {
          const result = supplierRefund({
            draw: { cost, baseCost },
            refund,
            landed,
            toBase: atRate(3n),
          });
          expect(result.refundBase + result.unrecovered).toBe(baseCost);
          expect(result.refund).toBe(refund ?? cost);
        },
      ),
    );
  });
});

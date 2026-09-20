import { describe, expect, it } from 'vitest';
import { ageAccount, bucketFor, type AgingEntry } from '@/server/domain/aging';

/**
 * Aging is arithmetic plus one convention, and the convention is where it
 * goes wrong: nothing says which invoice a payment settled, so the report
 * decides, and it has to decide the same way every time.
 */
const ASOF = new Date(Date.UTC(2026, 3, 1));
const daysBefore = (days: number) => new Date(ASOF.getTime() - days * 24 * 60 * 60 * 1000);

function invoice(id: string, days: number, amount: bigint): AgingEntry {
  return {
    id,
    occurredAt: daysBefore(days),
    amount,
    description: `Invoice ${id}`,
    reference: id,
  };
}

describe('aging a receivable', () => {
  it('buckets by how long the money has been outstanding', () => {
    const aging = ageAccount(
      [
        invoice('INV-1', 10, 1_000_00n),
        invoice('INV-2', 45, 2_000_00n),
        invoice('INV-3', 75, 3_000_00n),
        invoice('INV-4', 200, 4_000_00n),
      ],
      ASOF,
      'debit',
    );

    expect(aging.byBucket).toEqual({
      current: 1_000_00n,
      days31to60: 2_000_00n,
      days61to90: 3_000_00n,
      over90: 4_000_00n,
    });
    expect(aging.total).toBe(10_000_00n);
    // 9,000 of 10,000 is past thirty days.
    expect(aging.overdueBasisPoints).toBe(9000);
  });

  it('settles the oldest invoice first', () => {
    // Nothing says which invoice the 1,500 paid. Oldest-first is the
    // convention, and it is the same rule the stock uses when it cannot know
    // which unit went.
    const aging = ageAccount(
      [
        invoice('INV-1', 90, 1_000_00n),
        invoice('INV-2', 30, 1_000_00n),
        { ...invoice('RECEIPT', 5, -1_500_00n), description: 'Customer payment' },
      ],
      ASOF,
      'debit',
    );

    // INV-1 is cleared entirely and half of INV-2 remains.
    expect(aging.items.map((item) => [item.reference, item.outstanding])).toEqual([
      ['INV-2', 500_00n],
    ]);
  });

  it('keeps an overpayment visible rather than dropping it', () => {
    // A credit balance on a customer is something somebody needs to see.
    const aging = ageAccount(
      [
        invoice('INV-1', 60, 1_000_00n),
        { ...invoice('RECEIPT', 5, -1_400_00n), description: 'Customer payment' },
      ],
      ASOF,
      'debit',
    );

    expect(aging.total).toBe(-400_00n);
    expect(aging.items).toHaveLength(1);
    expect(aging.items[0]?.outstanding).toBe(-400_00n);
  });

  it('is empty when everything has been paid', () => {
    const aging = ageAccount(
      [
        invoice('INV-1', 60, 1_000_00n),
        { ...invoice('PAY', 5, -1_000_00n), description: 'Payment' },
      ],
      ASOF,
      'debit',
    );
    expect(aging.items).toEqual([]);
    expect(aging.total).toBe(0n);
    expect(aging.overdueBasisPoints).toBe(0);
  });
});

describe('aging a payable', () => {
  it('reads the signs the other way round', () => {
    // A supplier invoice is a credit and paying it is a debit. The arithmetic
    // is the same under a sign, which is why there is one function.
    const aging = ageAccount(
      [
        invoice('BILL-1', 100, -5_000_00n),
        { ...invoice('PAYMENT', 10, 2_000_00n), description: 'Paid supplier' },
      ],
      ASOF,
      'credit',
    );

    expect(aging.total).toBe(3_000_00n);
    expect(aging.items[0]?.bucket).toBe('over90');
  });
});

describe('settling in a stable order', () => {
  it('breaks a same-day tie on the id, which is time-ordered', () => {
    // Two invoices on one day must settle in the order they were written, not
    // in whatever order the rows came back from Postgres.
    const sameDay = [
      { ...invoice('B', 50, 100_00n), id: 'txn_02' },
      { ...invoice('A', 50, 100_00n), id: 'txn_01' },
      { ...invoice('PAY', 5, -100_00n), id: 'txn_03', description: 'Payment' },
    ];

    const forwards = ageAccount(sameDay, ASOF, 'debit');
    const backwards = ageAccount([...sameDay].reverse(), ASOF, 'debit');

    expect(forwards.items.map((i) => i.id)).toEqual(['txn_02']);
    expect(backwards.items.map((i) => i.id)).toEqual(forwards.items.map((i) => i.id));
  });
});

describe('buckets', () => {
  it.each([
    [0, 'current'],
    [30, 'current'],
    [31, 'days31to60'],
    [60, 'days31to60'],
    [61, 'days61to90'],
    [90, 'days61to90'],
    [91, 'over90'],
  ])('%i days is %s', (days, expected) => {
    expect(bucketFor(days)).toBe(expected);
  });
});

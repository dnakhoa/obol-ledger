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
  it('buckets by how late the money is, assuming thirty days when nothing says', () => {
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

    // With no terms stated, each invoice is due thirty days after it was
    // raised — so these land where the age-based report used to put them,
    // under labels that now say what they meant.
    expect(aging.byBucket).toEqual({
      current: 1_000_00n,
      days1to30: 2_000_00n,
      days31to60: 3_000_00n,
      days61to90: 0n,
      over90: 4_000_00n,
    });
    expect(aging.total).toBe(10_000_00n);
    // 9,000 of 10,000 is past due.
    expect(aging.overdueBasisPoints).toBe(9000);
  });

  it('is not late on sixty-day terms at forty days', () => {
    // The distributor's case. Counted from the invoice date, a forty-day-old
    // invoice looks late; on sixty-day terms it has twenty days to go.
    const aging = ageAccount([invoice('INV-1', 40, 1_000_00n)], ASOF, 'debit', 60);
    expect(aging.items[0]).toMatchObject({ bucket: 'current', daysOverdue: 0, ageDays: 40 });
    expect(aging.items[0]?.dueOn).toEqual(daysBefore(-20));
    expect(aging.overdueBasisPoints).toBe(0);
  });

  it('lets an invoice’s own due date win over the account’s terms', () => {
    // An export sold on thirty days to a customer whose account says sixty:
    // the invoice is the contract.
    const aging = ageAccount(
      [{ ...invoice('INV-1', 45, 1_000_00n), dueOn: daysBefore(15) }],
      ASOF,
      'debit',
      60,
    );
    expect(aging.items[0]).toMatchObject({ bucket: 'days1to30', daysOverdue: 15 });
  });

  it('counts payment on receipt as due the day it was raised', () => {
    const aging = ageAccount([invoice('INV-1', 1, 1_000_00n)], ASOF, 'debit', 0);
    expect(aging.items[0]).toMatchObject({ bucket: 'days1to30', daysOverdue: 1 });
  });

  it('is not late on the day it falls due', () => {
    const aging = ageAccount([{ ...invoice('INV-1', 30, 1_000_00n), dueOn: ASOF }], ASOF, 'debit');
    expect(aging.items[0]).toMatchObject({ bucket: 'current', daysOverdue: 0 });
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
    // A hundred days old, due at thirty: seventy days late.
    expect(aging.items[0]?.bucket).toBe('days61to90');
    expect(aging.items[0]?.daysOverdue).toBe(70);
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
    [1, 'days1to30'],
    [30, 'days1to30'],
    [31, 'days31to60'],
    [60, 'days31to60'],
    [61, 'days61to90'],
    [90, 'days61to90'],
    [91, 'over90'],
  ])('%i days late is %s', (days, expected) => {
    expect(bucketFor(days)).toBe(expected);
  });
});

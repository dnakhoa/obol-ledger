/**
 * How old the money owed is.
 *
 * Every accounting package has this and it is the first thing a finance person
 * looks for, because "we are owed 4.8 billion" and "we are owed 4.8 billion
 * and a third of it is over ninety days" are different businesses.
 *
 * ## Which invoice did that payment settle?
 *
 * Nothing in this ledger says. A customer wires an amount against an account,
 * not against an invoice, and demanding that every receipt name the invoice it
 * clears would be demanding a discipline nobody has at the moment of banking a
 * payment.
 *
 * So the convention is **oldest first**: a receipt settles the oldest open
 * invoice on that account, and what is left of it moves to the next. This is
 * the standard fallback — "balance forward", applied FIFO — and it is exactly
 * the rule `domain/costing.ts` uses for stock, for the same reason: when you
 * cannot know which one went, the oldest is the answer that cannot drift.
 *
 * It is a convention and not a fact, which matters when a customer pays a
 * later invoice and disputes an earlier one. The report says which assumption
 * it made rather than presenting the result as though nobody chose.
 */

export const AGING_BUCKETS = ['current', 'days31to60', 'days61to90', 'over90'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** A posting on a receivable or payable account, in date order. */
export type AgingEntry = {
  readonly id: string;
  readonly occurredAt: Date;
  /** Signed, debit-positive — the same convention as every posting here. */
  readonly amount: bigint;
  readonly description: string;
  /** An invoice number, when the entry carried one. */
  readonly reference: string | null;
};

export type OpenItem = {
  readonly id: string;
  readonly occurredAt: Date;
  readonly description: string;
  readonly reference: string | null;
  /** What is still outstanding, as a positive number. */
  readonly outstanding: bigint;
  readonly ageDays: number;
  readonly bucket: AgingBucket;
};

export type Aging = {
  readonly items: readonly OpenItem[];
  readonly total: bigint;
  readonly byBucket: Readonly<Record<AgingBucket, bigint>>;
  /** What is past thirty days, as a share of the total in basis points. */
  readonly overdueBasisPoints: number;
};

const DAY = 24 * 60 * 60 * 1000;

export function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 30) return 'current';
  if (ageDays <= 60) return 'days31to60';
  if (ageDays <= 90) return 'days61to90';
  return 'over90';
}

/**
 * Applies receipts to invoices oldest-first and ages what is left.
 *
 * `increases` is the side that opens an item: `debit` for a receivable, where
 * an invoice is a debit and a receipt a credit, and `credit` for a payable,
 * where it is the other way round. One function rather than two, because the
 * arithmetic is identical under a sign and two copies would drift.
 */
export function ageAccount(
  entries: readonly AgingEntry[],
  asOf: Date,
  increases: 'debit' | 'credit',
): Aging {
  const sign = increases === 'debit' ? 1n : -1n;

  // Oldest first, and ties broken on id — which is a ULID, so it is also
  // oldest-first. Two invoices on the same day settle in the order they were
  // written rather than in whatever order the rows came back.
  const ordered = [...entries].sort((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
    return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
  });

  const open: { entry: AgingEntry; outstanding: bigint }[] = [];

  for (const entry of ordered) {
    const signed = entry.amount * sign;

    if (signed > 0n) {
      open.push({ entry, outstanding: signed });
      continue;
    }

    // A settlement. It works through the open items from the front, and what
    // is left over when they run out is an overpayment — kept as a negative
    // item rather than dropped, because a credit balance on a customer is
    // something somebody needs to see, not something to hide.
    let remaining = -signed;
    while (remaining > 0n && open.length > 0) {
      const oldest = open[0];
      if (!oldest) break;

      if (oldest.outstanding > remaining) {
        oldest.outstanding -= remaining;
        remaining = 0n;
        break;
      }

      remaining -= oldest.outstanding;
      open.shift();
    }

    if (remaining > 0n) open.push({ entry, outstanding: -remaining });
  }

  const items = open
    .filter((item) => item.outstanding !== 0n)
    .map((item): OpenItem => {
      const ageDays = Math.max(
        0,
        Math.floor((asOf.getTime() - item.entry.occurredAt.getTime()) / DAY),
      );
      return {
        id: item.entry.id,
        occurredAt: item.entry.occurredAt,
        description: item.entry.description,
        reference: item.entry.reference,
        outstanding: item.outstanding,
        ageDays,
        bucket: bucketFor(ageDays),
      };
    });

  const byBucket = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [
      bucket,
      items
        .filter((item) => item.bucket === bucket)
        .reduce((sum, item) => sum + item.outstanding, 0n),
    ]),
  ) as Record<AgingBucket, bigint>;

  const total = items.reduce((sum, item) => sum + item.outstanding, 0n);
  const overdue = total - (byBucket.current ?? 0n);

  return {
    items,
    total,
    byBucket,
    // Basis points, so a share of an integer never becomes a float before the
    // string it is about to be printed as.
    overdueBasisPoints: total > 0n ? Number((overdue * 10_000n) / total) : 0,
  };
}

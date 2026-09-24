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

/**
 * Buckets by how late the money is, not how old the invoice is.
 *
 * They used to be the invoice's age — up to 30 days, 31–60, and so on — which
 * quietly assumed every customer was on thirty-day terms. On sixty-day terms
 * an invoice forty days old is not late, and a report that files it beside the
 * genuinely late ones teaches the reader to ignore the column that matters.
 * So the first bucket is "not yet due", and the rest count days past due.
 *
 * When nothing states the terms the report still assumes thirty days, so an
 * undated invoice lands exactly where it used to — 45 days old was "31–60",
 * and is now "1–30 days overdue", which is what that label always meant.
 */
export const AGING_BUCKETS = [
  'current',
  'days1to30',
  'days31to60',
  'days61to90',
  'over90',
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** The terms assumed when neither the invoice nor the account states any. */
export const DEFAULT_TERMS_DAYS = 30;

/** A posting on a receivable or payable account, in date order. */
export type AgingEntry = {
  readonly id: string;
  readonly occurredAt: Date;
  /** Signed, debit-positive — the same convention as every posting here. */
  readonly amount: bigint;
  readonly description: string;
  /** An invoice number, when the entry carried one. */
  readonly reference: string | null;
  /** When the invoice itself says it is due. Wins over the account's terms. */
  readonly dueOn?: Date | null | undefined;
  /**
   * The invoice a settlement belongs to, when it says so — a credit note
   * names the invoice it corrects. Applied to that invoice first and only the
   * remainder to the oldest, so crediting March's invoice does not make
   * January's look paid.
   */
  readonly appliesTo?: string | null | undefined;
};

export type OpenItem = {
  readonly id: string;
  readonly occurredAt: Date;
  readonly description: string;
  readonly reference: string | null;
  /** What is still outstanding, as a positive number. */
  readonly outstanding: bigint;
  readonly ageDays: number;
  readonly dueOn: Date;
  /** Days past due; zero while it is not yet due. */
  readonly daysOverdue: number;
  readonly bucket: AgingBucket;
};

export type Aging = {
  readonly items: readonly OpenItem[];
  readonly total: bigint;
  readonly byBucket: Readonly<Record<AgingBucket, bigint>>;
  /** What is past due, as a share of the total in basis points. */
  readonly overdueBasisPoints: number;
};

const DAY = 24 * 60 * 60 * 1000;

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days1to30';
  if (daysOverdue <= 60) return 'days31to60';
  if (daysOverdue <= 90) return 'days61to90';
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
  /** The account's payment terms; null or absent assumes `DEFAULT_TERMS_DAYS`. */
  termsDays: number | null = null,
): Aging {
  const terms = termsDays ?? DEFAULT_TERMS_DAYS;
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
    if (entry.appliesTo) {
      const target = open.find((item) => item.entry.reference === entry.appliesTo);
      if (target) {
        const applied = target.outstanding < remaining ? target.outstanding : remaining;
        target.outstanding -= applied;
        remaining -= applied;
        if (target.outstanding === 0n) open.splice(open.indexOf(target), 1);
      }
    }
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
      // Due at the start of the stated day, so an invoice due today is not
      // yet late and one due yesterday is a day late.
      const dueOn =
        item.entry.dueOn ?? new Date(startOfDay(item.entry.occurredAt).getTime() + terms * DAY);
      const daysOverdue = Math.max(
        0,
        Math.floor((startOfDay(asOf).getTime() - startOfDay(dueOn).getTime()) / DAY),
      );
      return {
        id: item.entry.id,
        occurredAt: item.entry.occurredAt,
        description: item.entry.description,
        reference: item.entry.reference,
        outstanding: item.outstanding,
        ageDays,
        dueOn,
        daysOverdue,
        bucket: bucketFor(daysOverdue),
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

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

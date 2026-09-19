import { asc, desc, eq, sql } from 'drizzle-orm';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { presentedBalance, type AccountType } from '@/server/domain/account';
import { accounts, postings, transactions } from '@/server/db/schema';
import type { Database } from '@/server/db/types';
import { toMoneyDto } from './serialize';
import type { AccountDto, MoneyDto, Page, TrialBalanceRow } from './dto';
import { toAccountDto } from './serialize';
import { buildPage, decodeCursor, type PageDirection } from './cursor';

export type StatementLine = {
  readonly postingId: string;
  readonly transactionId: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly direction: 'debit' | 'credit';
  readonly amount: MoneyDto;
  /** The account's balance immediately after this posting, as a reader expects it. */
  readonly runningBalance: MoneyDto;
};

export type AccountStatement = {
  readonly account: AccountDto;
  readonly lines: Page<StatementLine>;
};

export function createReportingService(database: Database) {
  return {
    /**
     * The trial balance: the ledger auditing itself.
     *
     * Because every entry sums to zero, the signed balances of all accounts in
     * a currency must also sum to zero. Computing this from the *cached*
     * balances is the point — it is precisely the number that would drift if
     * the balance trigger were ever wrong, which is why the dashboard shows it
     * rather than hiding it in a test.
     */
    async trialBalance(): Promise<TrialBalanceRow[]> {
      const rows = await database
        .select({
          currency: accounts.currency,
          debits: sql<string>`coalesce(sum(case when ${accounts.balanceMinor} > 0 then ${accounts.balanceMinor} else 0 end), 0)`,
          credits: sql<string>`coalesce(sum(case when ${accounts.balanceMinor} < 0 then -${accounts.balanceMinor} else 0 end), 0)`,
          residual: sql<string>`coalesce(sum(${accounts.balanceMinor}), 0)`,
        })
        .from(accounts)
        .groupBy(accounts.currency)
        .orderBy(asc(accounts.currency));

      return rows.map((row) => {
        const currency = row.currency as CurrencyCode;
        const residual = BigInt(row.residual) as MinorUnits;
        return {
          currency,
          debits: toMoneyDto(BigInt(row.debits) as MinorUnits, currency),
          credits: toMoneyDto(BigInt(row.credits) as MinorUnits, currency),
          residual: toMoneyDto(residual, currency),
          balanced: residual === 0n,
        };
      });
    },

    /**
     * An account statement with a running balance.
     *
     * The running total is a window function over the account's own postings,
     * so Postgres walks the index once and returns only the page. Computing it
     * in JavaScript would require every posting since the account opened, which
     * defeats the point of paginating.
     *
     * The window is ordered by `(occurred_at, id)` — the same key the page is
     * sorted and seeked on. If the two orders disagreed, the running balance
     * column would not reconcile with the rows printed beside it, which is the
     * one thing a statement must never do.
     */
    async statement(
      accountId: string,
      options: {
        limit: number;
        cursor?: string | undefined;
        direction?: PageDirection | undefined;
      },
    ): Promise<AccountStatement | undefined> {
      const [account] = await database
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .limit(1);
      if (!account) return undefined;

      const limit = Math.min(Math.max(options.limit, 1), 100);
      const after = options.cursor ? decodeCursor(options.cursor) : undefined;
      const backward = options.direction === 'backward' && after !== undefined;

      const ledger = database
        .select({
          postingId: postings.id,
          transactionId: postings.transactionId,
          amountMinor: postings.amountMinor,
          description: transactions.description,
          occurredAt: transactions.occurredAt,
          runningMinor:
            sql<string>`sum(${postings.amountMinor}) over (order by ${transactions.occurredAt}, ${postings.id} rows between unbounded preceding and current row)`.as(
              'running_minor',
            ),
        })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(eq(postings.accountId, accountId))
        .as('ledger');

      const rows = await database
        .select()
        .from(ledger)
        .where(
          after
            ? backward
              ? sql`(${ledger.occurredAt}, ${ledger.postingId}) > (${after.occurredAt}, ${after.id})`
              : sql`(${ledger.occurredAt}, ${ledger.postingId}) < (${after.occurredAt}, ${after.id})`
            : undefined,
        )
        .orderBy(
          ...(backward
            ? [asc(ledger.occurredAt), asc(ledger.postingId)]
            : [desc(ledger.occurredAt), desc(ledger.postingId)]),
        )
        .limit(limit + 1);

      const currency = account.currency as CurrencyCode;
      const type = account.type as AccountType;

      const page = buildPage({
        rows,
        limit,
        direction: backward ? 'backward' : 'forward',
        hasCursor: after !== undefined,
        keyOf: (row) => ({ occurredAt: row.occurredAt, id: row.postingId }),
      });

      return {
        account: toAccountDto(account),
        lines: {
          nextCursor: page.nextCursor,
          previousCursor: page.previousCursor,
          items: page.items.map((row) => {
            const amount = BigInt(row.amountMinor) as MinorUnits;
            return {
              postingId: row.postingId,
              transactionId: row.transactionId,
              description: row.description,
              occurredAt: row.occurredAt.toISOString(),
              direction: amount >= 0n ? ('debit' as const) : ('credit' as const),
              amount: toMoneyDto((amount < 0n ? -amount : amount) as MinorUnits, currency),
              runningBalance: toMoneyDto(
                presentedBalance(BigInt(row.runningMinor) as MinorUnits, type),
                currency,
              ),
            };
          }),
        },
      };
    },

    /** Headline figures for the dashboard, in one round trip per currency. */
    async summary(): Promise<{
      readonly accountCount: number;
      readonly entryCount: number;
      readonly postingCount: number;
    }> {
      const [counts] = await database
        .select({
          accountCount: sql<string>`(select count(*) from ${accounts})`,
          entryCount: sql<string>`(select count(*) from ${transactions})`,
          postingCount: sql<string>`(select count(*) from ${postings})`,
        })
        .from(sql`(select 1) as anchor`);

      return {
        accountCount: Number(counts?.accountCount ?? 0),
        entryCount: Number(counts?.entryCount ?? 0),
        postingCount: Number(counts?.postingCount ?? 0),
      };
    },

    /**
     * Daily debit volume for the activity chart, oldest first.
     *
     * The date spine comes from `generate_series` and the postings are LEFT
     * JOINed onto it, so quiet days come back as zero rather than as missing
     * rows. A chart that silently drops empty days compresses the x-axis and
     * makes a gap look like activity.
     *
     * Only the debit side is summed: every entry has an equal and opposite
     * credit, so summing both would report exactly double the money that moved.
     */
    async dailyVolume(
      currency: CurrencyCode,
      days: number,
    ): Promise<{ readonly day: string; readonly volume: MoneyDto }[]> {
      const span = Math.min(Math.max(Math.trunc(days), 1), 366);

      const rows = await database
        .select({ day: sql<string>`series.day`, volume: sql<string>`series.volume` })
        .from(
          sql`(
            SELECT
              to_char(spine.day, 'YYYY-MM-DD') AS day,
              coalesce(sum(p.amount_minor) FILTER (WHERE p.amount_minor > 0), 0)::text AS volume
            FROM generate_series(
              date_trunc('day', now()) - make_interval(days => ${span - 1}),
              date_trunc('day', now()),
              interval '1 day'
            ) AS spine(day)
            LEFT JOIN transactions t
              ON date_trunc('day', t.occurred_at) = spine.day
             AND t.currency = ${currency}
            LEFT JOIN postings p ON p.transaction_id = t.id
            GROUP BY spine.day
            ORDER BY spine.day
          ) AS series`,
        );

      return rows.map((row) => ({
        day: row.day,
        volume: toMoneyDto(BigInt(row.volume) as MinorUnits, currency),
      }));
    },
  };
}

export type ReportingService = ReturnType<typeof createReportingService>;

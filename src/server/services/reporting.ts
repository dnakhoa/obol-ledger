import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { presentedBalance, type AccountType } from '@/server/domain/account';
import { accounts, postings, transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database } from '@/server/db/types';
import { toMoneyDto } from './serialize';
import type {
  AccountDto,
  BalanceSheet,
  IncomeStatement,
  MoneyDto,
  Page,
  StatementLineDto,
  StatementSection,
  TrialBalanceRow,
} from './dto';
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

export function createReportingService(database: Database, orgId: string) {
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
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
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
      return withTenant(database, orgId, async (tx) => {
        const [account] = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);
        if (!account) return undefined;

        const limit = Math.min(Math.max(options.limit, 1), 100);
        const after = options.cursor ? decodeCursor(options.cursor) : undefined;
        const backward = options.direction === 'backward' && after !== undefined;

        const ledger = tx
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

        const rows = await tx
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
      });
    },

    /**
     * The balance sheet: what is owned and owed at a point in time.
     *
     * Balances come from the cached `balance_minor`, which a trigger maintains
     * from the postings — so this is a read of aggregates Postgres already
     * keeps rather than a scan of every posting ever written.
     *
     * Retained earnings is the part worth explaining. Revenue and expense
     * accounts accumulate over a period and are closed into equity at period
     * end; between closes, a balance sheet that ignored them would not
     * balance. Folding them in as retained earnings is what the accounting
     * equation requires, and it is why `balanced` is computed rather than
     * asserted.
     */
    async balanceSheet(currency: CurrencyCode): Promise<BalanceSheet> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.currency, currency))
          .orderBy(asc(accounts.type), asc(accounts.name));

        const section = (type: AccountType, label: string): StatementSection =>
          buildSection(
            label,
            rows.filter((row) => row.type === type),
            currency,
          );

        const assets = section('asset', 'Assets');
        const liabilities = section('liability', 'Liabilities');
        const equity = section('equity', 'Equity');

        const revenueTotal = sumPresented(rows, 'revenue');
        const expenseTotal = sumPresented(rows, 'expense');
        const retained = (revenueTotal - expenseTotal) as MinorUnits;

        const left = BigInt(assets.total.minorUnits);
        const right =
          BigInt(liabilities.total.minorUnits) + BigInt(equity.total.minorUnits) + retained;

        return {
          asOf: new Date().toISOString(),
          currency,
          assets,
          liabilities,
          equity,
          retainedEarnings: toMoneyDto(retained, currency),
          liabilitiesAndEquity: toMoneyDto(right as MinorUnits, currency),
          balanced: left === right,
        };
      });
    },

    /**
     * The income statement: performance between two dates.
     *
     * Bounded by the period, so this sums *postings* rather than reading the
     * cached balances — a balance is a position and cannot answer "how much did
     * we earn in March". The join to `transactions` is what makes the date
     * filter meaningful: a posting's date is its entry's date.
     */
    async incomeStatement(
      currency: CurrencyCode,
      period: { from: Date; to: Date },
    ): Promise<IncomeStatement> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({
            accountId: accounts.id,
            accountName: accounts.name,
            type: accounts.type,
            total: sql<string>`coalesce(sum(${postings.amountMinor}), 0)::text`,
          })
          .from(accounts)
          .leftJoin(
            postings,
            and(
              eq(postings.accountId, accounts.id),
              sql`${postings.transactionId} in (
                select id from transactions
                 where occurred_at >= ${period.from} and occurred_at <= ${period.to}
              )`,
            ),
          )
          .where(
            and(eq(accounts.currency, currency), inArray(accounts.type, ['revenue', 'expense'])),
          )
          .groupBy(accounts.id, accounts.name, accounts.type)
          .orderBy(asc(accounts.type), asc(accounts.name));

        const lineFor = (row: (typeof rows)[number]): StatementLineDto => ({
          accountId: row.accountId,
          accountName: row.accountName,
          type: row.type as AccountType,
          amount: toMoneyDto(
            presentedBalance(BigInt(row.total) as MinorUnits, row.type as AccountType),
            currency,
          ),
        });

        const build = (type: AccountType, label: string): StatementSection => {
          const lines = rows.filter((row) => row.type === type).map(lineFor);
          const total = lines.reduce((sum, line) => sum + BigInt(line.amount.minorUnits), 0n);
          return { label, lines, total: toMoneyDto(total as MinorUnits, currency) };
        };

        const revenue = build('revenue', 'Revenue');
        const expenses = build('expense', 'Expenses');
        const net = (BigInt(revenue.total.minorUnits) -
          BigInt(expenses.total.minorUnits)) as MinorUnits;

        return {
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          currency,
          revenue,
          expenses,
          netIncome: toMoneyDto(net, currency),
          profitable: net > 0n,
        };
      });
    },

    /** Headline figures for the dashboard, in one round trip per currency. */
    async summary(): Promise<{
      readonly accountCount: number;
      readonly entryCount: number;
      readonly postingCount: number;
    }> {
      return withTenant(database, orgId, async (tx) => {
        const [counts] = await tx
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
      });
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

      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
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
      });
    },
  };
}

export type ReportingService = ReturnType<typeof createReportingService>;

/** Total of an account class, in the sign a reader expects. */
function sumPresented(
  rows: readonly { type: string; balanceMinor: bigint }[],
  type: AccountType,
): bigint {
  return rows
    .filter((row) => row.type === type)
    .reduce((total, row) => total + presentedBalance(row.balanceMinor as MinorUnits, type), 0n);
}

function buildSection(
  label: string,
  rows: readonly { id: string; name: string; type: string; balanceMinor: bigint }[],
  currency: CurrencyCode,
): StatementSection {
  const lines: StatementLineDto[] = rows.map((row) => ({
    accountId: row.id,
    accountName: row.name,
    type: row.type as AccountType,
    amount: toMoneyDto(
      presentedBalance(row.balanceMinor as MinorUnits, row.type as AccountType),
      currency,
    ),
  }));
  const total = lines.reduce((sum, line) => sum + BigInt(line.amount.minorUnits), 0n);
  return { label, lines, total: toMoneyDto(total as MinorUnits, currency) };
}

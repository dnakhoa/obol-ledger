import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import {
  STATUTORY_FORMS,
  fillForm,
  formsFor,
  type AccountFigure,
  type FilledForm,
  type StatutoryForm,
} from '@/server/domain/statutory';
import { accounts, organizations, postings, transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { toMoneyDto } from './serialize';
import type { MoneyDto } from './dto';

/**
 * Vietnam's statutory statements, filled from the ledger.
 *
 * The balance sheet is drawn at the end of a day and beside it the same
 * figures at the start of the year, as the form asks; the income statement
 * covers a period and beside it the same period a year earlier. Both come
 * from posted entries only and in the books' own currency — foreign balances
 * at the rate the revaluation left them at, which is the figure the law asks
 * for. The month-end close is left out of the income statement, because it
 * moves a result rather than earning one.
 */

export type StatutoryLine = {
  readonly code: string;
  readonly vi: string;
  readonly en: string;
  readonly level: 0 | 1 | 2;
  readonly current: MoneyDto;
  readonly comparative: MoneyDto;
};

export type StatutoryStatement = {
  readonly form: StatutoryForm;
  readonly kind: 'balance_sheet' | 'income_statement';
  readonly titleVi: string;
  readonly titleEn: string;
  readonly organisation: string;
  readonly currency: CurrencyCode;
  /** The day the balance sheet is drawn at, or the period an income statement covers. */
  readonly current: { readonly from: string | null; readonly to: string };
  readonly comparative: { readonly from: string | null; readonly to: string };
  readonly lines: readonly StatutoryLine[];
  /** Accounts with a balance that no line of the form claims. */
  readonly unplaced: readonly {
    readonly code: string | null;
    readonly name: string;
    readonly amount: MoneyDto;
  }[];
  readonly balanced: boolean | null;
};

export function createStatutoryService(database: Database, orgId: string) {
  return {
    /** The forms this organisation's chart reports on, or null outside Vietnam's charts. */
    async forms() {
      return withTenant(database, orgId, async (tx) =>
        formsFor((await org(tx, orgId)).chartTemplate),
      );
    },

    /** Mẫu B01-DN or B01a-DNN, at the end of `asOf`, with the start of that year beside it. */
    async balanceSheet(asOf: string): Promise<StatutoryStatement | null> {
      return withTenant(database, orgId, async (tx) => {
        const book = await org(tx, orgId);
        const forms = formsFor(book.chartTemplate);
        if (!forms) return null;
        const definition = STATUTORY_FORMS[forms.balanceSheet];
        const opening = `${Number(asOf.slice(0, 4)) - 1}-12-31`;

        const fill = async (day: string) => {
          const figures = await balancesAt(tx, day);
          const result = -figures
            .filter((figure) => figure.type === 'revenue' || figure.type === 'expense')
            .reduce((sum, figure) => sum + figure.balance, 0n);
          return fillForm(
            definition,
            figures.filter((figure) => figure.type !== 'revenue' && figure.type !== 'expense'),
            result,
          );
        };

        return present(book, await fill(asOf), await fill(opening), {
          current: { from: null, to: asOf },
          comparative: { from: null, to: opening },
        });
      });
    },

    /** Mẫu B02-DN or B02-DNN over `[from, to]`, with the same period a year earlier. */
    async incomeStatement(from: string, to: string): Promise<StatutoryStatement | null> {
      return withTenant(database, orgId, async (tx) => {
        const book = await org(tx, orgId);
        const forms = formsFor(book.chartTemplate);
        if (!forms) return null;
        const definition = STATUTORY_FORMS[forms.incomeStatement];
        const earlier = (day: string) => `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;
        const previous = { from: earlier(from), to: earlier(to) };

        return present(
          book,
          fillForm(definition, await movements(tx, from, to)),
          fillForm(definition, await movements(tx, previous.from, previous.to)),
          { current: { from, to }, comparative: previous },
        );
      });
    },
  };
}

export type StatutoryService = ReturnType<typeof createStatutoryService>;

type Book = { name: string; chartTemplate: string; currency: CurrencyCode };

async function org(tx: Transactional, orgId: string): Promise<Book> {
  const [row] = await tx
    .select({
      name: organizations.name,
      chartTemplate: organizations.chartTemplate,
      currency: organizations.functionalCurrency,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return {
    name: row?.name ?? '',
    chartTemplate: row?.chartTemplate ?? 'generic',
    currency: (row?.currency ?? 'VND') as CurrencyCode,
  };
}

type TypedFigure = AccountFigure & { readonly type: string };

/** Every account's balance at the end of `day`, debit-positive, in the functional currency. */
async function balancesAt(tx: Transactional, day: string): Promise<TypedFigure[]> {
  const end = new Date(`${day}T23:59:59.999Z`);
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      balance: sql<string>`coalesce(sum(${postings.baseAmountMinor}), 0)::text`,
    })
    .from(accounts)
    .leftJoin(
      postings,
      and(
        eq(postings.accountId, accounts.id),
        sql`${postings.transactionId} in (
          select t.id from transactions t
           where t.occurred_at <= ${end} and t.status = 'posted'
        )`,
      ),
    )
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type);
  return rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    type: row.type,
    balance: BigInt(row.balance),
  }));
}

/**
 * Revenue and expense movements over a period, debit-positive.
 *
 * The month-end close, and the reversal of one, are left out: they move a
 * result into equity rather than earn one, and counted they would zero every
 * closed month.
 */
async function movements(tx: Transactional, from: string, to: string): Promise<AccountFigure[]> {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      balance: sql<string>`coalesce(sum(${postings.baseAmountMinor}), 0)::text`,
    })
    .from(accounts)
    .leftJoin(
      postings,
      and(
        eq(postings.accountId, accounts.id),
        sql`${postings.transactionId} in (
          select t.id from ${transactions} t
           where t.occurred_at >= ${start} and t.occurred_at <= ${end}
             and t.status = 'posted'
             and not (t.metadata ? 'closingPeriod')
             and not exists (
               select 1 from transactions closing
                where closing.id = t.reverses_transaction_id
                  and closing.metadata ? 'closingPeriod'
             )
        )`,
      ),
    )
    .where(inArray(accounts.type, ['revenue', 'expense']))
    .groupBy(accounts.id, accounts.code, accounts.name);
  return rows.map((row) => ({
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    balance: BigInt(row.balance),
  }));
}

function present(
  book: Book,
  current: FilledForm,
  comparative: FilledForm,
  periods: Pick<StatutoryStatement, 'current' | 'comparative'>,
): StatutoryStatement {
  const money = (value: bigint) => toMoneyDto(value as MinorUnits, book.currency);
  const earlier = new Map(comparative.lines.map((line) => [line.code, line.amount]));
  const definition = current.definition;
  return {
    form: definition.form,
    kind: definition.kind,
    titleVi: definition.titleVi,
    titleEn: definition.titleEn,
    organisation: book.name,
    currency: book.currency,
    ...periods,
    lines: current.lines.map((line) => ({
      code: line.code,
      vi: line.vi,
      en: line.en,
      level: line.level,
      current: money(line.amount),
      comparative: money(earlier.get(line.code) ?? 0n),
    })),
    unplaced: current.unplaced.map((figure) => ({
      code: figure.code,
      name: figure.name,
      amount: money(figure.balance),
    })),
    balanced: current.balanced,
  };
}

import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { buildReturn, clearingLegs, type TaxReturnFigures } from '@/server/domain/tax-return';
import { monthOf } from '@/server/domain/period';
import type { LedgerError } from '@/server/domain/errors';
import {
  accounts,
  organizations,
  taxCodes,
  taxEntries,
  taxReturnMonths,
  taxReturns,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createJournalService } from './journal';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Filing a consumption tax return.
 *
 * The return itself is arithmetic and lives in `domain/tax-return.ts`. What
 * this adds is the two things arithmetic cannot do: find the period's entries,
 * and write the entry that settles them.
 *
 * Filing posts a journal entry rather than printing a figure, which is the
 * decision worth defending. A report leaves the tax accounts accruing across
 * the period boundary, so their balances answer neither "what did I accrue
 * this month" nor "what do I owe" — and an unused input credit exists only as
 * a number somebody wrote on last quarter's form. Posting the clearing entry
 * makes both facts things the ledger knows: the payable moves to an account
 * the business settles, and the credit is left sitting in the input account,
 * where the next return finds it without being told.
 */

export type PeriodInput = {
  /** `2026-03-01`, inclusive. */
  readonly periodStart: string;
  /** `2026-05-01`, inclusive — the *first* month of the last month. */
  readonly periodEnd: string;
};

export type TaxBandDto = {
  readonly taxCodeId: string;
  readonly name: string;
  readonly treatment: string;
  readonly rate: string;
  readonly base: MoneyDto;
  readonly tax: MoneyDto;
};

export type TaxReturnDto = {
  readonly id: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sales: readonly TaxBandDto[];
  readonly purchases: readonly TaxBandDto[];
  readonly outputTax: MoneyDto;
  readonly inputTax: MoneyDto;
  readonly broughtForward: MoneyDto;
  readonly payable: MoneyDto;
  readonly carriedForward: MoneyDto;
  readonly filedAt: string | null;
  readonly transactionId: string | null;
};

export type FiledReturn = {
  readonly return: TaxReturnDto;
  /** Absent when the return moved nothing — see `file`. */
  readonly entry: TransactionDto | null;
};

export function createTaxReturnService(database: Database, orgId: string) {
  /**
   * What the return would say, without filing it.
   *
   * Shares every line of arithmetic with `file`, deliberately: a preview that
   * computes the figures differently from the thing it previews is a preview
   * of nothing.
   */
  async function preview(period: PeriodInput): Promise<Result<TaxReturnDto, LedgerError>> {
    return withTenant(database, orgId, async (tx) => {
      const figures = await compute(tx, period);
      if (!figures.ok) return figures;
      const currency = await functionalCurrency(tx, orgId);
      return ok(toDto(figures.value, period, currency, null));
    });
  }

  async function file(
    period: PeriodInput,
    options?: { readonly filedBy?: string | undefined },
  ): Promise<Result<FiledReturn, LedgerError>> {
    return withTenant(database, orgId, async (tx) => {
      const months = monthsIn(period);

      // Checked before the arithmetic so the refusal names the month rather
      // than arriving as a unique-violation from the insert below. The index
      // is still the thing that makes it true — this only makes it legible.
      const [taken] = await tx
        .select({ month: taxReturnMonths.periodMonth })
        .from(taxReturnMonths)
        .where(inArray(taxReturnMonths.periodMonth, months))
        .orderBy(asc(taxReturnMonths.periodMonth))
        .limit(1);
      if (taken) return err({ code: 'period_already_filed', periodMonth: taken.month });

      // Returns are a chain, so they have to be filed in order. An earlier
      // period left unfiled is not a missing report: its credit has not been
      // brought forward, so this return's opening figure is wrong and nothing
      // downstream can detect it.
      const earliest = months[0] ?? period.periodStart;
      const [stranded] = await tx
        .select({ occurredAt: taxEntries.occurredAt })
        .from(taxEntries)
        .where(lt(taxEntries.occurredAt, new Date(`${earliest}T00:00:00.000Z`)))
        .orderBy(asc(taxEntries.occurredAt))
        .limit(1);
      if (stranded) {
        const unfiled = monthOf(stranded.occurredAt);
        const [covered] = await tx
          .select({ id: taxReturnMonths.id })
          .from(taxReturnMonths)
          .where(eq(taxReturnMonths.periodMonth, unfiled))
          .limit(1);
        if (!covered) {
          return err({ code: 'earlier_return_unfiled', periodMonth: earliest, unfiled });
        }
      }

      const computed = await compute(tx, period);
      if (!computed.ok) return computed;
      const figures = computed.value;

      // Nothing was bought or sold and no credit was waiting. Filing that
      // would claim the months for a return with no content, and a month once
      // claimed cannot be released.
      if (
        figures.sales.length === 0 &&
        figures.purchases.length === 0 &&
        figures.broughtForward === 0n
      ) {
        return err({
          code: 'nothing_to_file',
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
        });
      }

      const [payableAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.role, 'tax_payable'))
        .limit(1);
      if (!payableAccount) return err({ code: 'tax_payable_account_missing' });

      const legs = clearingLegs(figures);
      const codes = await tx.select().from(taxCodes);
      const outputAccount = codes.find((code) => code.outputAccountId)?.outputAccountId;
      const inputAccount = codes.find((code) => code.inputAccountId)?.inputAccountId;
      if (legs.output > 0n && !outputAccount) {
        return err({ code: 'tax_account_missing', treatment: 'vat', side: 'output' });
      }
      if (legs.input > 0n && !inputAccount) {
        return err({ code: 'tax_account_missing', treatment: 'vat', side: 'input' });
      }

      const currency = await functionalCurrency(tx, orgId);
      const returnId = newId('taxReturn');

      // Dated the last instant of the period, so it falls inside the months it
      // settles rather than opening the next one with a balance that belongs
      // to the one before.
      const occurredAt = endOfPeriod(period.periodEnd);

      const postings = [
        // Debit the output liability by the whole of it: the period's charging
        // is finished, and what it accrued is now dealt with.
        ...(legs.output > 0n && outputAccount
          ? [{ accountId: outputAccount, amount: legs.output as MinorUnits }]
          : []),
        // Credit the input asset by at most the output. Crediting the whole of
        // it would be claiming a refund the tenant is not getting; what is
        // left behind is the credit carried forward, and it is left behind by
        // arithmetic rather than by a flag.
        ...(legs.input > 0n && inputAccount
          ? [{ accountId: inputAccount, amount: -legs.input as MinorUnits }]
          : []),
        ...(legs.payable > 0n
          ? [{ accountId: payableAccount.id, amount: -legs.payable as MinorUnits }]
          : []),
      ];

      // A period can be a real filing and still move nothing.
      //
      // A quarter that only bought has no output tax, so there is nothing to
      // debit, and crediting the input account would be claiming a refund the
      // tenant is not getting. The whole of the input stays where it is as
      // credit carried forward. That return has no entry — but it is still a
      // return: it claims its months and it sets the figure the next one
      // opens with. Refusing it would make the chain unfileable after any
      // quiet quarter.
      const entry =
        postings.length > 0
          ? await createJournalService(tx, orgId).postEntry({
              description: `Tax return ${period.periodStart} — ${period.periodEnd}`,
              currency,
              occurredAt,
              postings,
              metadata: { taxReturnId: returnId },
            })
          : null;
      if (entry && !entry.ok) return entry;

      await tx.insert(taxReturns).values({
        id: returnId,
        orgId,
        periodStart: period.periodStart,
        periodEnd: endOfPeriodDate(period.periodEnd),
        outputTaxMinor: figures.outputTax,
        inputTaxMinor: figures.inputTax,
        broughtForwardMinor: figures.broughtForward,
        payableMinor: figures.payable,
        carriedForwardMinor: figures.carriedForward,
        transactionId: entry?.ok ? entry.value.transaction.id : null,
        filedBy: options?.filedBy ?? null,
      });

      // The months, which is what actually forbids a second return over any of
      // them. Inserted after the return row because they point at it.
      await tx.insert(taxReturnMonths).values(
        months.map((month) => ({
          id: newId('taxReturnMonth'),
          orgId,
          returnId,
          periodMonth: month,
        })),
      );

      return ok({
        return: toDto(figures, period, currency, {
          id: returnId,
          filedAt: new Date().toISOString(),
          transactionId: entry?.ok ? entry.value.transaction.id : null,
        }),
        entry: entry?.ok ? entry.value.transaction : null,
      });
    });
  }

  /** Every return filed, newest first. */
  async function list(): Promise<readonly TaxReturnDto[]> {
    return withTenant(database, orgId, async (tx) => {
      const currency = await functionalCurrency(tx, orgId);
      const rows = await tx.select().from(taxReturns).orderBy(desc(taxReturns.periodStart));
      return rows.map((row) => ({
        id: row.id,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        sales: [],
        purchases: [],
        outputTax: money(row.outputTaxMinor, currency),
        inputTax: money(row.inputTaxMinor, currency),
        broughtForward: money(row.broughtForwardMinor, currency),
        payable: money(row.payableMinor, currency),
        carriedForward: money(row.carriedForwardMinor, currency),
        filedAt: row.filedAt.toISOString(),
        transactionId: row.transactionId,
      }));
    });
  }

  /**
   * The figures, from the entries in the window and the last return's credit.
   *
   * The brought-forward figure is read from the previous *return* rather than
   * from the input account's balance. They agree when nothing else has touched
   * the account, and when they disagree the return row is the one that was
   * filed — the balance may have moved for reasons a return should not silently
   * absorb.
   */
  async function compute(
    tx: Transactional,
    period: PeriodInput,
  ): Promise<Result<TaxReturnFigures, LedgerError>> {
    const from = new Date(`${period.periodStart}T00:00:00.000Z`);
    const to = endOfPeriod(period.periodEnd);

    const rows = await tx
      .select({
        taxCodeId: taxEntries.taxCodeId,
        supply: taxEntries.supply,
        base: taxEntries.baseMinor,
        tax: taxEntries.taxMinor,
        name: taxCodes.name,
        treatment: taxCodes.treatment,
        rateBasisPoints: taxCodes.rateBasisPoints,
      })
      .from(taxEntries)
      .innerJoin(taxCodes, eq(taxCodes.id, taxEntries.taxCodeId))
      .where(and(gte(taxEntries.occurredAt, from), lte(taxEntries.occurredAt, to)))
      .orderBy(asc(taxEntries.occurredAt), asc(taxEntries.id));

    // The *latest* return before this period — descending, because the chain
    // hands its credit on one link at a time and only the last link holds it.
    const [previous] = await tx
      .select({ carriedForward: taxReturns.carriedForwardMinor })
      .from(taxReturns)
      .where(lt(taxReturns.periodStart, period.periodStart))
      .orderBy(desc(taxReturns.periodStart))
      .limit(1);

    const figures = buildReturn(
      rows.map((row) => ({
        taxCodeId: row.taxCodeId,
        name: row.name,
        treatment: row.treatment,
        rateBasisPoints: row.rateBasisPoints,
        supply: row.supply,
        base: row.base,
        tax: row.tax,
      })),
      previous?.carriedForward ?? 0n,
    );

    // The domain's only refusal is a negative opening credit, which cannot
    // arise from a row this service wrote — a CHECK forbids it. Mapped rather
    // than thrown so the exhaustiveness check keeps holding if it grows.
    return figures.ok ? ok(figures.value) : err({ code: 'tax_payable_account_missing' });
  }

  /**
   * The month that should be filed next, or nothing.
   *
   * The page shows one period and no chooser, for the same reason month-end
   * does: returns are filed in order, so there is only ever one that can be
   * filed, and offering a picker would be offering nine wrong answers beside
   * the right one.
   *
   * A month still in progress is not offered. Filing it would claim it, and a
   * claimed month cannot be released — the sale booked on the 30th would have
   * nowhere to go.
   */
  async function nextPeriod(now: Date = new Date()): Promise<PeriodInput | null> {
    return withTenant(database, orgId, async (tx) => {
      const [earliest] = await tx
        .select({ occurredAt: taxEntries.occurredAt })
        .from(taxEntries)
        .orderBy(asc(taxEntries.occurredAt))
        .limit(1);
      if (!earliest) return null;

      const filed = await tx
        .select({ month: taxReturnMonths.periodMonth })
        .from(taxReturnMonths)
        .orderBy(asc(taxReturnMonths.periodMonth));
      const claimed = new Set(filed.map((row) => row.month));

      const thisMonth = monthOf(now);
      const cursor = new Date(`${monthOf(earliest.occurredAt)}T00:00:00.000Z`);
      while (true) {
        const month = cursor.toISOString().slice(0, 10);
        // Everything up to the current month has been filed, and the current
        // one is not finished. Nothing to do, which is the common case.
        if (month >= thisMonth) return null;
        if (!claimed.has(month)) return { periodStart: month, periodEnd: month };
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    });
  }

  return { preview, file, list, nextPeriod };
}

export type TaxReturnService = ReturnType<typeof createTaxReturnService>;

/** `toMoneyDto` takes the branded type; the brand is erased at runtime. */
function money(amount: bigint, currency: CurrencyCode): MoneyDto {
  return toMoneyDto(amount as MinorUnits, currency);
}

function toDto(
  figures: TaxReturnFigures,
  period: PeriodInput,
  currency: CurrencyCode,
  filed: { id: string; filedAt: string; transactionId: string | null } | null,
): TaxReturnDto {
  const band = (item: TaxReturnFigures['sales'][number]): TaxBandDto => ({
    taxCodeId: item.taxCodeId,
    name: item.name,
    treatment: item.treatment,
    rate: item.rate,
    base: money(item.base, currency),
    tax: money(item.tax, currency),
  });

  return {
    id: filed?.id ?? null,
    periodStart: period.periodStart,
    periodEnd: endOfPeriodDate(period.periodEnd),
    sales: figures.sales.map(band),
    purchases: figures.purchases.map(band),
    outputTax: money(figures.outputTax, currency),
    inputTax: money(figures.inputTax, currency),
    broughtForward: money(figures.broughtForward, currency),
    payable: money(figures.payable, currency),
    carriedForward: money(figures.carriedForward, currency),
    filedAt: filed?.filedAt ?? null,
    transactionId: filed?.transactionId ?? null,
  };
}

/**
 * Every month a period covers, as the first of each.
 *
 * `periodEnd` is given as a month rather than a date because that is what a
 * filing period is — nobody files the 7th to the 22nd. Decomposing it here is
 * what lets one unique index forbid overlap between a month and a quarter that
 * contains it.
 */
function monthsIn(period: PeriodInput): string[] {
  const months: string[] = [];
  const start = new Date(`${period.periodStart}T00:00:00.000Z`);
  const end = new Date(`${period.periodEnd}T00:00:00.000Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** The last instant of the month `periodEnd` names. */
function endOfPeriod(periodEnd: string): Date {
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

/** The same instant as a date, for the stored row. */
function endOfPeriodDate(periodEnd: string): string {
  return endOfPeriod(periodEnd).toISOString().slice(0, 10);
}

async function functionalCurrency(tx: Transactional, orgId: string): Promise<CurrencyCode> {
  const [row] = await tx
    .select({ currency: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return (row?.currency ?? 'USD') as CurrencyCode;
}

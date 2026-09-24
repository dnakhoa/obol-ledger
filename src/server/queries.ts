import 'server-only';

import { demoServices } from './container';
import { buildLinearScale, heightPercent } from '@/lib/chart-scale';
import { type CurrencyCode, type MinorUnits } from '@/lib/money';
import { formatAxisTick } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import { toMoneyDto } from './services/serialize';
import type { AccountDto, MoneyDto, TrialBalanceRow, TransactionDto } from './services/dto';
import { ACCOUNT_TYPES, type AccountType } from './domain/account';
import type { VolumeColumn } from '@/components/volume-chart';

/**
 * Read models for the pages.
 *
 * Server Components call these directly rather than fetching the app's own HTTP
 * API: an internal round trip would pay for serialisation, a socket and a cold
 * function invocation to reach code already running in the same process. The
 * public API exists for external callers, and both routes go through the same
 * services, so there is one implementation of every rule.
 *
 * Presentation shaping — grouping, axis ticks, percentages — happens here, on
 * the server, so the client bundle never has to reconstruct a money value.
 */

export type DashboardModel = {
  readonly accounts: AccountDto[];
  readonly trialBalance: TrialBalanceRow[];
  readonly recent: TransactionDto[];
  readonly summary: { accountCount: number; entryCount: number; postingCount: number };
  readonly chart: { columns: VolumeColumn[]; ticks: string[]; currency: CurrencyCode };
  /** The business at a glance, for a ledger that holds stock. Null when it holds none. */
  readonly trading: TradingSnapshot | null;
};

/**
 * The four numbers a trading business opens the books for.
 *
 * The ledger's own figures — assets, revenue, entries posted — prove the books
 * are consistent. These say how the business is doing: what is in the yard
 * and whether the accounts agree with it, who is late paying, what is owed to
 * suppliers, and what this month's invoices made. Each links to the page that
 * answers the next question.
 */
export type TradingSnapshot = {
  readonly stock: MoneyDto;
  readonly products: number;
  /** Whether the lots and the inventory accounts agree. */
  readonly stockAgrees: boolean;
  /** Everything customers owe, in the functional currency. */
  readonly receivable: MoneyDto;
  readonly overdueInvoices: number;
  readonly oldestDaysLate: number;
  readonly payable: MoneyDto;
  readonly overdueBills: number;
  readonly margin: MoneyDto;
  readonly marginBasisPoints: number | null;
  readonly invoicesThisMonth: number;
};

/**
 * Everything the overview needs, in the currency the books are kept in.
 *
 * No currency argument. A dashboard for a dong exporter that quietly reported
 * only its dollar accounts would be worse than no dashboard, and that is what
 * a default of `'USD'` produced.
 */
/**
 * `locale` only reaches the axis labels.
 *
 * Without it the ticks down the side of the chart would group in English
 * while the bars beside them grouped in Vietnamese, which is worse than either
 * one alone — the reader has no way to know which convention a given figure
 * is in.
 */
export async function loadDashboard(locale: Locale = 'en'): Promise<DashboardModel> {
  const { accounts, journal, reporting, inventory, aging, sales } = await demoServices();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  // Independent reads, issued together: awaiting them in sequence would make the
  // page as slow as the sum of the queries instead of the slowest one.
  const [
    accountRows,
    trialBalance,
    recent,
    summary,
    volume,
    items,
    reconciliation,
    receivables,
    payables,
    margins,
  ] = await Promise.all([
    accounts.list(),
    reporting.trialBalance(),
    journal.list({ limit: 6 }),
    reporting.summary(),
    reporting.dailyVolume(30),
    inventory.list(),
    inventory.reconcile(),
    aging.report('asset', now),
    aging.report('liability', now),
    sales.margins(monthStart, monthEnd),
  ]);

  // The day labels along the chart follow the reader too. Without this they
  // grouped in English under bars whose figures grouped in Vietnamese.
  const dayLabel = new Intl.DateTimeFormat(
    locale === 'vi' ? 'vi-VN' : locale === 'ja' ? 'ja-JP' : 'en-GB',
    {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    },
  );

  const values = volume.map((point) => BigInt(point.volume.minorUnits) as MinorUnits);
  const scale = buildLinearScale(values);

  // The chart's unit comes from the data rather than from an argument: every
  // figure it plots is already in the functional currency.
  const currency = (volume[0]?.volume.currency ?? 'USD') as CurrencyCode;

  const functional = (accountRows[0]?.baseBalance.currency ?? 'USD') as CurrencyCode;
  // Summed from each account's functional balance: a dollar receivable and a
  // dong one only add up once both are in dong, at the rates the ledger holds.
  const openTotal = (type: 'asset' | 'liability') =>
    toMoneyDto(
      accountRows
        .filter((account) => account.openItems && account.type === type)
        .reduce((sum, account) => sum + BigInt(account.baseBalance.minorUnits), 0n) as MinorUnits,
      functional,
    );
  const late = (report: typeof receivables) =>
    report.accounts.flatMap((account) =>
      account.items.filter(
        (item) => item.daysOverdue > 0 && !item.outstanding.amount.startsWith('-'),
      ),
    );
  const lateInvoices = late(receivables);

  const trading: TradingSnapshot | null =
    items.length === 0
      ? null
      : {
          stock: toMoneyDto(
            items.reduce((sum, item) => sum + BigInt(item.valueMinor), 0n) as MinorUnits,
            functional,
          ),
          products: items.length,
          stockAgrees: reconciliation.agrees,
          receivable: openTotal('asset'),
          overdueInvoices: lateInvoices.length,
          oldestDaysLate: lateInvoices.reduce((max, item) => Math.max(max, item.daysOverdue), 0),
          payable: openTotal('liability'),
          overdueBills: late(payables).length,
          margin: margins.total.margin,
          marginBasisPoints: margins.total.marginBasisPoints,
          invoicesThisMonth: margins.total.invoices,
        };

  return {
    trading,
    accounts: accountRows,
    trialBalance,
    recent: [...recent.items],
    summary,
    chart: {
      currency,
      ticks: scale.ticks.map((tick) => formatAxisTick(tick, currency, locale)),
      columns: volume.map((point, index) => ({
        day: point.day,
        label: dayLabel.format(new Date(`${point.day}T00:00:00Z`)),
        value: point.volume,
        heightPercent: heightPercent(values[index] ?? (0n as MinorUnits), scale.top),
        isPeak: index === scale.peakIndex,
      })),
    },
  };
}

export type PositionRow = {
  readonly type: AccountType;
  readonly label: string;
  readonly total: MoneyDto;
  readonly accountCount: number;
};

export type Position = {
  /** The currency every total here is stated in: the tenant's functional one. */
  readonly currency: CurrencyCode;
  readonly rows: PositionRow[];
  /** Assets + Expenses — the debit-normal side of the equation. */
  readonly debitSide: MoneyDto;
  /** Liabilities + Equity + Revenue — the credit-normal side. */
  readonly creditSide: MoneyDto;
  readonly balanced: boolean;
  readonly totalFor: (type: AccountType) => MoneyDto;
};

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

/**
 * The accounting equation, computed from presented balances.
 *
 * Because every posting nets to zero, `assets + expenses` must equal
 * `liabilities + equity + revenue` — the same identity as the trial balance,
 * stated the way a reader of a balance sheet expects it. Showing both sides
 * makes the invariant legible rather than something taken on trust.
 */
export function buildPosition(accounts: readonly AccountDto[]): Position {
  const totals = new Map<AccountType, bigint>();
  const counts = new Map<AccountType, number>();

  /*
   * Summed from the functional-currency balance, and every account counts.
   *
   * This used to skip any account whose currency was not the one passed in,
   * which on a single-currency ledger was invisible and on a multi-currency
   * one silently left most of the balance sheet out of the balance sheet —
   * a dong exporter's dollar and euro receivables simply did not appear in
   * the accounting equation. Summing the base balance is the only way the
   * identity holds across currencies, and it is the same number the trial
   * balance and the residual gauge use.
   */
  const currency = (accounts[0]?.baseBalance.currency ?? 'USD') as CurrencyCode;

  for (const account of accounts) {
    const type = account.type;
    totals.set(type, (totals.get(type) ?? 0n) + BigInt(account.baseBalance.minorUnits));
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const totalOf = (type: AccountType): bigint => totals.get(type) ?? 0n;
  const debitSide = totalOf('asset') + totalOf('expense');
  const creditSide = totalOf('liability') + totalOf('equity') + totalOf('revenue');

  return {
    currency,
    rows: ACCOUNT_TYPES.map((type) => ({
      type,
      label: TYPE_LABELS[type],
      total: toMoneyDto(totalOf(type) as MinorUnits, currency),
      accountCount: counts.get(type) ?? 0,
    })),
    debitSide: toMoneyDto(debitSide as MinorUnits, currency),
    creditSide: toMoneyDto(creditSide as MinorUnits, currency),
    balanced: debitSide === creditSide,
    totalFor: (type) => toMoneyDto(totalOf(type) as MinorUnits, currency),
  };
}

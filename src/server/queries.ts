import 'server-only';

import { demoServices } from './container';
import { buildLinearScale, heightPercent } from '@/lib/chart-scale';
import { type CurrencyCode, type MinorUnits } from '@/lib/money';
import { formatAxisTick } from '@/lib/format';
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

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export type DashboardModel = {
  readonly accounts: AccountDto[];
  readonly trialBalance: TrialBalanceRow[];
  readonly recent: TransactionDto[];
  readonly summary: { accountCount: number; entryCount: number; postingCount: number };
  readonly chart: { columns: VolumeColumn[]; ticks: string[]; currency: CurrencyCode };
};

export async function loadDashboard(currency: CurrencyCode = 'USD'): Promise<DashboardModel> {
  const { accounts, journal, reporting } = await demoServices();

  // Independent reads, issued together: awaiting them in sequence would make the
  // page as slow as the sum of the queries instead of the slowest one.
  const [accountRows, trialBalance, recent, summary, volume] = await Promise.all([
    accounts.list(),
    reporting.trialBalance(),
    journal.list({ limit: 6 }),
    reporting.summary(),
    reporting.dailyVolume(currency, 30),
  ]);

  const values = volume.map((point) => BigInt(point.volume.minorUnits) as MinorUnits);
  const scale = buildLinearScale(values);

  return {
    accounts: accountRows,
    trialBalance,
    recent: [...recent.items],
    summary,
    chart: {
      currency,
      ticks: scale.ticks.map((tick) => formatAxisTick(tick, currency)),
      columns: volume.map((point, index) => ({
        day: point.day,
        label: DAY_LABEL.format(new Date(`${point.day}T00:00:00Z`)),
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
export function buildPosition(accounts: readonly AccountDto[], currency: CurrencyCode): Position {
  const totals = new Map<AccountType, bigint>();
  const counts = new Map<AccountType, number>();

  for (const account of accounts) {
    if (account.balance.currency !== currency) continue;
    const type = account.type;
    totals.set(type, (totals.get(type) ?? 0n) + BigInt(account.balance.minorUnits));
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const totalOf = (type: AccountType): bigint => totals.get(type) ?? 0n;
  const debitSide = totalOf('asset') + totalOf('expense');
  const creditSide = totalOf('liability') + totalOf('equity') + totalOf('revenue');

  return {
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

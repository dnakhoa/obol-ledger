import type { Metadata } from 'next';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { StatementSectionTable } from '@/components/statement';
import { SetupNotice } from '@/components/setup-notice';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { demoServices } from '@/server/container';
import { SetupRequiredError } from '@/server/setup-error';
import type { BalanceSheet, IncomeStatement } from '@/server/services/dto';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

type PageProps = { searchParams: Promise<{ days?: string }> };

const PERIODS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
] as const;

const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export default async function ReportsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const days = PERIODS.find((period) => String(period.days) === query.days)?.days ?? 30;

  let sheet: BalanceSheet;
  let income: IncomeStatement;
  try {
    const services = await demoServices();
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    // Independent reads, issued together.
    [sheet, income] = await Promise.all([
      services.reporting.balanceSheet('USD'),
      services.reporting.incomeStatement('USD', { from, to }),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="The two statements a ledger exists to produce. Both are derived from the same postings as everything else — no separate reporting store to fall out of step."
      />

      {/*
        The accounting identity, stated before the detail that supports it.
        A balance sheet that does not balance is not a rounding problem — it
        means the data behind every figure below is wrong, so it leads.
      */}
      <Card className={sheet.balanced ? '' : 'border-negative'}>
        <CardBody className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                sheet.balanced ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative'
              }`}
            >
              {sheet.balanced ? (
                <CheckIcon width={20} height={20} />
              ) : (
                <AlertIcon width={20} height={20} />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold">
                {sheet.balanced
                  ? 'The balance sheet balances'
                  : 'The balance sheet does not balance'}
              </p>
              <p className="text-ink-muted text-xs">
                Assets = Liabilities + Equity + retained earnings
              </p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <dt className="text-ink-muted text-[11px] tracking-wide uppercase">Assets</dt>
              <dd className="numeric text-sm font-medium">
                <Money value={sheet.assets.total} showCurrency />
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                Liabilities + equity
              </dt>
              <dd className="numeric text-sm font-medium">
                <Money value={sheet.liabilitiesAndEquity} showCurrency />
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>Balance sheet</CardTitle>
              <CardDescription>Position as at {DATE.format(new Date(sheet.asOf))}</CardDescription>
            </div>
            <Badge>{sheet.currency}</Badge>
          </CardHeader>

          <StatementSectionTable section={sheet.assets} emphasis />

          <div className="border-line border-t">
            <StatementSectionTable section={sheet.liabilities} />
          </div>
          <div className="border-line border-t">
            <StatementSectionTable section={sheet.equity} />
          </div>

          <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-medium">Retained earnings</p>
              <p className="text-ink-muted text-xs">
                Revenue less expenses, folded into equity as it would be at period close
              </p>
            </div>
            <span className="numeric text-sm font-medium">
              <Money value={sheet.retainedEarnings} signed />
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>Income statement</CardTitle>
              <CardDescription>
                {DATE.format(new Date(income.from))} — {DATE.format(new Date(income.to))}
              </CardDescription>
            </div>
            {/*
              Revenue and expenses are flows, so the period is a control rather
              than a caption. Real links, so a period is shareable and the back
              button works.
            */}
            <nav aria-label="Reporting period" className="flex items-center gap-1">
              {PERIODS.map((period) => (
                <a
                  key={period.days}
                  href={`/reports?days=${period.days}`}
                  aria-current={period.days === days ? 'page' : undefined}
                  className={`rounded-md px-2 py-1 text-xs transition-colors duration-150 ${
                    period.days === days
                      ? 'bg-surface-hover text-ink font-medium'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {period.label}
                </a>
              ))}
            </nav>
          </CardHeader>

          <StatementSectionTable section={income.revenue} />
          <div className="border-line border-t">
            <StatementSectionTable section={income.expenses} />
          </div>

          <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold">Net income</p>
              <p className="text-ink-muted text-xs">Revenue less expenses for the period</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={income.profitable ? 'positive' : 'neutral'}>
                {income.profitable ? 'Profit' : 'Loss or breakeven'}
              </Badge>
              <span className="numeric text-base font-semibold">
                <Money value={income.netIncome} signed showCurrency />
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

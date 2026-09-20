import type { Metadata } from 'next';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { StatementSectionTable } from '@/components/statement';
import { SetupNotice } from '@/components/setup-notice';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { classLabel, dateFormats } from '@/lib/i18n';
import { SetupRequiredError } from '@/server/setup-error';
import type { BalanceSheet, IncomeStatement } from '@/server/services/dto';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.reports.title };
}
export const dynamic = 'force-dynamic';

type PageProps = { searchParams: Promise<{ days?: string }> };

const PERIODS = [
  { days: 30, key: 'period30' },
  { days: 90, key: 'period90' },
  { days: 365, key: 'period365' },
] as const;

export default async function ReportsPage({ searchParams }: PageProps) {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  // The class is named at the call site rather than read off the section:
  // `StatementSection` carries a label for the API and no type, and adding one
  // to the DTO to satisfy the interface would be the tail wagging the dog.
  const sectionLabels = (type: string) => {
    const name = classLabel(type, t);
    return {
      name,
      amount: t.reports.amount,
      caption: t.reports.sectionCaption(name),
      empty: t.reports.sectionEmpty(name),
      total: t.reports.sectionTotal(name),
    };
  };
  const query = await searchParams;
  const days = PERIODS.find((period) => String(period.days) === query.days)?.days ?? 30;

  let sheet: BalanceSheet;
  let income: IncomeStatement;
  try {
    const { services } = await viewerServices();
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    // Independent reads, issued together.
    [sheet, income] = await Promise.all([
      services.reporting.balanceSheet(),
      services.reporting.incomeStatement({ from, to }),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  return (
    <>
      <PageHeader title={t.reports.title} description={t.reports.description} />

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
                {sheet.balanced ? t.reports.sheetBalances : t.reports.sheetDoesNot}
              </p>
              <p className="text-ink-muted text-xs">{t.reports.equation}</p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                {t.reports.assets}
              </dt>
              <dd className="numeric text-sm font-medium">
                <Money value={sheet.assets.total} showCurrency />
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                {t.reports.liabilitiesPlusEquity}
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
              <CardTitle>{t.reports.balanceSheet}</CardTitle>
              <CardDescription>{t.reports.asAt(format.full(new Date(sheet.asOf)))}</CardDescription>
            </div>
            <Badge>{sheet.currency}</Badge>
          </CardHeader>

          <StatementSectionTable section={sheet.assets} labels={sectionLabels('asset')} emphasis />

          <div className="border-line border-t">
            <StatementSectionTable
              section={sheet.liabilities}
              labels={sectionLabels('liability')}
            />
          </div>
          <div className="border-line border-t">
            <StatementSectionTable section={sheet.equity} labels={sectionLabels('equity')} />
          </div>

          <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-medium">{t.reports.retainedEarnings}</p>
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
              <CardTitle>{t.reports.incomeStatement}</CardTitle>
              <CardDescription>
                {format.full(new Date(income.from))} — {format.full(new Date(income.to))}
              </CardDescription>
            </div>
            {/*
              Revenue and expenses are flows, so the period is a control rather
              than a caption. Real links, so a period is shareable and the back
              button works.
            */}
            <nav aria-label={t.reports.reportingPeriod} className="flex items-center gap-1">
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
                  {t.reports[period.key]}
                </a>
              ))}
            </nav>
          </CardHeader>

          <StatementSectionTable section={income.revenue} labels={sectionLabels('revenue')} />
          <div className="border-line border-t">
            <StatementSectionTable section={income.expenses} labels={sectionLabels('expense')} />
          </div>

          <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold">{t.reports.netIncome}</p>
              <p className="text-ink-muted text-xs">{t.reports.netIncomeHint}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={income.profitable ? 'positive' : 'neutral'}>
                {income.profitable ? t.reports.profit : t.reports.lossOrBreakeven}
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

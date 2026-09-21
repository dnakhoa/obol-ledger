import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { ActionButton, RateForm, Step } from '@/components/month-end-steps';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { closeMonthAction, recordRateAction, reopenMonthAction, revalueAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.monthEnd.title };
}
export const dynamic = 'force-dynamic';

export default async function MonthEndPage() {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  let periods: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['periods']['list']>
  >;
  let accounts: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['accounts']['list']>
  >;
  let rates: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['rates']['list']>
  >;
  let preview: Awaited<
    ReturnType<Awaited<ReturnType<typeof viewerServices>>['services']['revaluation']['preview']>
  > | null = null;

  try {
    const { services } = await viewerServices();
    [periods, accounts, rates] = await Promise.all([
      services.periods.list(),
      services.accounts.list(),
      services.rates.list(40),
    ]);

    const openMonth = periods.find((period) => period.status === 'open' && period.entryCount > 0);
    if (openMonth) preview = await services.revaluation.preview(openMonth.periodMonth);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const functional = accounts[0]?.baseBalance.currency ?? 'USD';
  const foreignCurrencies = [
    ...new Set(
      accounts
        .filter((account) => account.monetary && account.balance.currency !== functional)
        .map((account) => account.balance.currency),
    ),
  ];

  // The oldest open month with anything in it. Months close in order, so this
  // is the only one anybody can act on — showing a chooser would be offering
  // a decision the ledger is going to refuse.
  const current = [...periods]
    .reverse()
    .find((period) => period.status === 'open' && period.entryCount > 0);

  const monthEnd = current ? lastDayOf(current.periodMonth) : null;
  const ratesAtMonthEnd = monthEnd
    ? foreignCurrencies.filter((currency) =>
        rates.some((rate) => rate.base === currency && rate.asOf <= monthEnd),
      )
    : [];
  const ratesReady = ratesAtMonthEnd.length === foreignCurrencies.length;

  return (
    <>
      <PageHeader title={t.monthEnd.title} description={t.monthEnd.description} />

      {!current ? (
        <Card>
          <CardBody className="text-ink-secondary py-8 text-center text-sm">
            {t.monthEnd.allClosed}
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="space-y-0.5">
                <CardTitle>{format.month(new Date(`${current.periodMonth}T00:00:00Z`))}</CardTitle>
                <CardDescription>{t.monthEnd.entriesInMonth(current.entryCount)}</CardDescription>
              </div>
              <Badge tone="caution">{t.monthEnd.open}</Badge>
            </CardHeader>
          </Card>

          <ol className="space-y-3">
            <Step
              number={1}
              numberLabel={t.monthEnd.stepNumber(1)}
              title={t.monthEnd.step1}
              description={
                foreignCurrencies.length === 0
                  ? t.monthEnd.step1NoForeign(functional)
                  : t.monthEnd.step1Body(
                      monthEnd ? format.full(new Date(`${monthEnd}T00:00:00Z`)) : '',
                      foreignCurrencies.join(', '),
                    )
              }
              done={ratesReady}
              doneLabel={
                ratesReady && foreignCurrencies.length > 0
                  ? t.monthEnd.step1Done(ratesAtMonthEnd.join(', '))
                  : undefined
              }
            >
              {foreignCurrencies.length > 0 && monthEnd ? (
                <RateForm
                  action={recordRateAction}
                  currencies={foreignCurrencies}
                  functional={functional}
                  asOf={monthEnd}
                  labels={{
                    currency: t.monthEnd.rateCurrency,
                    worth: t.monthEnd.rateWorth(functional),
                    save: t.monthEnd.rateSave,
                    saving: t.monthEnd.rateSaving,
                  }}
                />
              ) : null}
            </Step>

            <Step
              number={2}
              numberLabel={t.monthEnd.stepNumber(2)}
              title={t.monthEnd.step2}
              description={
                foreignCurrencies.length === 0
                  ? t.monthEnd.step2NoForeign(functional)
                  : t.monthEnd.step2Body(foreignCurrencies.join(', '), functional)
              }
              done={Boolean(preview?.ok && preview.value.lines.length === 0)}
            >
              {preview?.ok && preview.value.lines.length > 0 ? (
                <div className="border-line bg-surface-sunken rounded-lg border p-3">
                  <p className="text-ink-secondary mb-2 text-xs font-medium">
                    {t.monthEnd.whatWillChange}
                  </p>
                  <ul className="space-y-1.5">
                    {preview.value.lines.map((line) => (
                      <li key={line.accountId} className="flex justify-between gap-3 text-xs">
                        <span className="text-ink-secondary truncate">{line.accountName}</span>
                        <span
                          className={
                            BigInt(line.differenceMinor) >= 0n ? 'text-positive' : 'text-negative'
                          }
                        >
                          {BigInt(line.differenceMinor) >= 0n ? '+' : ''}
                          {format.number(BigInt(line.differenceMinor))} {functional}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ActionButton
                action={revalueAction}
                month={current.periodMonth.slice(0, 7)}
                label={t.monthEnd.step2Button}
                pendingLabel={t.monthEnd.step2Pending}
                variant="secondary"
              />
            </Step>

            <Step
              number={3}
              numberLabel={t.monthEnd.stepNumber(3)}
              title={t.monthEnd.step3}
              description={t.monthEnd.step3Body(
                format.month(new Date(`${current.periodMonth}T00:00:00Z`)),
              )}
            >
              <ActionButton
                action={closeMonthAction}
                month={current.periodMonth.slice(0, 7)}
                label={t.monthEnd.step3Button}
                pendingLabel={t.monthEnd.step3Pending}
                confirm={t.monthEnd.step3Confirm(
                  format.month(new Date(`${current.periodMonth}T00:00:00Z`)),
                )}
              />
            </Step>
          </ol>
        </>
      )}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.monthEnd.months}</CardTitle>
            <CardDescription>
              A closed month can be reopened. The original closing entry stays on the record and a
              reversing one cancels it, so there is always a trail.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-2">
          {periods.length === 0 ? (
            <p className="text-ink-secondary text-sm">{t.monthEnd.noMonths}</p>
          ) : (
            periods.map((period) => (
              <div
                key={period.id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-ink text-sm font-medium">
                    {format.month(new Date(`${period.periodMonth}T00:00:00Z`))}
                  </p>
                  <p className="text-ink-muted text-xs">
                    {period.entryCount} entries
                    {period.revaluedAt ? ' · foreign balances updated' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {period.status === 'closed' ? (
                    <>
                      <Badge tone="neutral">{t.monthEnd.closed}</Badge>
                      <ActionButton
                        action={reopenMonthAction}
                        month={period.periodMonth.slice(0, 7)}
                        label={t.monthEnd.reopen}
                        pendingLabel={t.statement.reopening}
                        variant="secondary"
                        confirm={`Reopen ${format.month(
                          new Date(`${period.periodMonth}T00:00:00Z`),
                        )}? The closing entry will be reversed.`}
                      />
                    </>
                  ) : (
                    <Badge tone="caution">{t.monthEnd.open}</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </>
  );
}

/** The last day of a `YYYY-MM-01` month, as `YYYY-MM-DD`. */
function lastDayOf(periodMonth: string): string {
  const [year, month] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).toISOString().slice(0, 10);
}

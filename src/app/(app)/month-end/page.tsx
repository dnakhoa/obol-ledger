import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { ActionButton, RateForm, Step } from '@/components/month-end-steps';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { Money } from '@/components/money';
import { closeMonthAction, recordRateAction, reopenMonthAction, revalueAction } from './actions';

export const metadata: Metadata = { title: 'Month end' };
export const dynamic = 'force-dynamic';

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export default async function MonthEndPage() {
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
  const revalued = Boolean(current && periods.find((p) => p.id === current.id)?.closedAt === null);

  return (
    <>
      <PageHeader
        title="Month end"
        description="Three things, in order, once a month. You can press any of them early — if it is not time yet, the ledger says why instead of doing something wrong."
      />

      {!current ? (
        <Card>
          <CardBody className="text-ink-secondary py-8 text-center text-sm">
            Every month with entries in it is closed. The next one becomes available once the month
            has finished.
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="space-y-0.5">
                <CardTitle>
                  {MONTH_LABEL.format(new Date(`${current.periodMonth}T00:00:00Z`))}
                </CardTitle>
                <CardDescription>
                  {current.entryCount} entries. Closing happens oldest month first, so this is the
                  one to work on.
                </CardDescription>
              </div>
              <Badge tone="caution">Open</Badge>
            </CardHeader>
          </Card>

          <ol className="space-y-3">
            <Step
              number={1}
              title="Put in the exchange rates"
              description={
                foreignCurrencies.length === 0
                  ? 'You only hold ' +
                    functional +
                    ', so there are no rates to enter. Nothing to do here.'
                  : `On ${
                      monthEnd ? DAY_LABEL.format(new Date(`${monthEnd}T00:00:00Z`)) : 'month end'
                    }, what was one ${functional === 'VND' ? 'dollar, euro or Australian dollar' : 'unit of each foreign currency'} worth? Use the rate your bank or the central bank published that day. You hold ${foreignCurrencies.join(', ')}.`
              }
              done={ratesReady}
              doneLabel={
                ratesReady && foreignCurrencies.length > 0
                  ? `Rates on file for ${ratesAtMonthEnd.join(', ')}.`
                  : undefined
              }
            >
              {foreignCurrencies.length > 0 && monthEnd ? (
                <RateForm
                  action={recordRateAction}
                  currencies={foreignCurrencies}
                  functional={functional}
                  asOf={monthEnd}
                />
              ) : null}
            </Step>

            <Step
              number={2}
              title="Update what your foreign money is worth"
              description={
                foreignCurrencies.length === 0
                  ? 'Nothing to update — every account is already in ' + functional + '.'
                  : `Your customers owe you in ${foreignCurrencies.join(' and ')}. Those amounts are worth a different number of ${functional} now than when you invoiced. This works out the difference and records it as income or expense.`
              }
              done={Boolean(preview?.ok && preview.value.lines.length === 0)}
            >
              {preview?.ok && preview.value.lines.length > 0 ? (
                <div className="border-line bg-surface-sunken rounded-lg border p-3">
                  <p className="text-ink-secondary mb-2 text-xs font-medium">
                    What will change if you press this:
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
                          {Number(line.differenceMinor).toLocaleString('en-US')} {functional}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ActionButton
                action={revalueAction}
                month={current.periodMonth.slice(0, 7)}
                label="Update foreign balances"
                pendingLabel="Updating…"
                variant="secondary"
              />
            </Step>

            <Step
              number={3}
              title="Close the month"
              description={`After this, nobody can add or change an entry dated in ${MONTH_LABEL.format(
                new Date(`${current.periodMonth}T00:00:00Z`),
              )}. That is what makes the month's figures final. Your profit for the month moves into retained earnings. You can reopen it if you have to.`}
            >
              <ActionButton
                action={closeMonthAction}
                month={current.periodMonth.slice(0, 7)}
                label="Close the month"
                pendingLabel="Closing…"
                confirm={`Close ${MONTH_LABEL.format(
                  new Date(`${current.periodMonth}T00:00:00Z`),
                )}? Entries dated in it can no longer be added or changed.`}
              />
            </Step>
          </ol>
        </>
      )}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Months</CardTitle>
            <CardDescription>
              A closed month can be reopened. The original closing entry stays on the record and a
              reversing one cancels it, so there is always a trail.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody className="space-y-2">
          {periods.length === 0 ? (
            <p className="text-ink-secondary text-sm">No entries yet, so no months to close.</p>
          ) : (
            periods.map((period) => (
              <div
                key={period.id}
                className="border-line flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-ink text-sm font-medium">
                    {MONTH_LABEL.format(new Date(`${period.periodMonth}T00:00:00Z`))}
                  </p>
                  <p className="text-ink-muted text-xs">
                    {period.entryCount} entries
                    {period.revaluedAt ? ' · foreign balances updated' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {period.status === 'closed' ? (
                    <>
                      <Badge tone="neutral">Closed</Badge>
                      <ActionButton
                        action={reopenMonthAction}
                        month={period.periodMonth.slice(0, 7)}
                        label="Reopen"
                        pendingLabel="Reopening…"
                        variant="secondary"
                        confirm={`Reopen ${MONTH_LABEL.format(
                          new Date(`${period.periodMonth}T00:00:00Z`),
                        )}? The closing entry will be reversed.`}
                      />
                    </>
                  ) : (
                    <Badge tone="caution">Open</Badge>
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

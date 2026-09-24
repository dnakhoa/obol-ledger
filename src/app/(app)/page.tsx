import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/stat-tile';
import { Money } from '@/components/money';
import { marginText } from '@/components/margin';
import { VolumeChart } from '@/components/volume-chart';
import { SetupNotice } from '@/components/setup-notice';
import { CheckIcon, AlertIcon, ArrowRightIcon, ShieldIcon } from '@/components/icons';
import { buildPosition, loadDashboard } from '@/server/queries';
import { translations } from '@/server/i18n';
import { classLabel, dateFormats } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.overview.title };
}

// Balances change on every posting, so nothing here may be served from a cache.
export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  let model;
  try {
    model = await loadDashboard(locale);
  } catch (error) {
    if (error instanceof Error && error.message.includes('DATABASE_URL')) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  const { accounts, trialBalance, recent, summary, chart, trading } = model;
  // One row: the trial balance is stated in the functional currency and
  // nothing else, because that is the only unit it means anything in.
  const books = trialBalance[0];
  const position = buildPosition(accounts);
  const allBalanced = trialBalance.every((row) => row.balanced);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{t.overview.title}</h1>
          <p className="text-ink-muted text-sm">{t.overview.description}</p>
        </div>
        <ButtonLink href="/transfer" variant="primary">
          {t.overview.postEntry}
          <ArrowRightIcon />
        </ButtonLink>
      </header>

      {/*
        The trial balance leads the page rather than hiding in a report. It is
        the ledger's own proof of consistency, and the one number that would
        make every other number here untrustworthy if it moved off zero.
      */}
      <Card className={allBalanced ? '' : 'border-negative'}>
        <CardBody className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                allBalanced ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative'
              }`}
            >
              {allBalanced ? (
                <CheckIcon width={20} height={20} />
              ) : (
                <AlertIcon width={20} height={20} />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold">
                {allBalanced ? t.overview.balanced : t.overview.notBalanced}
              </p>
              <p className="text-ink-muted text-xs">
                {allBalanced ? t.overview.balancedBody : t.overview.notBalancedBody}
              </p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
            {books ? (
              <>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                    {t.overview.debits}
                  </dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={books.debits} showCurrency />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                    {t.overview.credits}
                  </dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={books.credits} showCurrency />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">
                    {t.overview.residual}
                  </dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={books.residual} />
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </CardBody>
        {/*
          The claim above is the easiest one on the page to wave away — every
          screenshot of a ledger says it balances. So the banner carries the
          invitation to test it, against this same database. Only while it
          is true: a banner reporting a residual has no business daring anyone.
        */}
        {allBalanced ? (
          <Link
            href="/break"
            className="group border-line text-ink-secondary hover:bg-surface-hover hover:text-ink flex items-center justify-between gap-3 rounded-b-[var(--radius)] border-t px-4 py-2.5 text-xs transition-colors duration-150 sm:px-5"
          >
            <span className="flex items-center gap-2">
              <ShieldIcon className="text-positive shrink-0" width={14} height={14} />
              {t.overview.breakItPrompt}
            </span>
            <span className="text-ink flex shrink-0 items-center gap-1 font-medium">
              {t.overview.breakItCta}
              <ArrowRightIcon
                width={13}
                height={13}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </span>
          </Link>
        ) : null}
      </Card>

      {/*
        The business before the books. The ledger tiles below prove the
        figures are consistent; these say how the trading is going, and each
        opens the page that answers the next question. Shown only to a ledger
        that holds stock — a services business has no yard to report on.
      */}
      {trading ? (
        <section aria-label={t.overview.trading} className="space-y-2">
          <h2 className="text-ink-muted text-xs font-medium">{t.overview.trading}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatTile
              href="/stock"
              label={t.overview.stockOnHand}
              value={<Money value={trading.stock} />}
              unit={trading.stock.currency}
              tone={trading.stockAgrees ? 'neutral' : 'caution'}
              detail={
                trading.stockAgrees ? (
                  t.overview.stockAgrees(trading.products)
                ) : (
                  <span className="text-caution font-medium">{t.overview.stockDisagrees}</span>
                )
              }
            />
            <StatTile
              href="/reports/aging"
              label={t.overview.owedToYou}
              value={<Money value={trading.receivable} />}
              unit={trading.receivable.currency}
              tone={trading.oldestDaysLate > 60 ? 'caution' : 'neutral'}
              detail={
                trading.overdueInvoices > 0 ? (
                  <span className={trading.oldestDaysLate > 60 ? 'text-caution font-medium' : ''}>
                    {t.overview.invoicesLate(trading.overdueInvoices, trading.oldestDaysLate)}
                  </span>
                ) : (
                  t.overview.nothingLate
                )
              }
            />
            <StatTile
              href="/reports/aging"
              label={t.overview.owedToSuppliers}
              value={<Money value={trading.payable} />}
              unit={trading.payable.currency}
              detail={
                trading.overdueBills > 0
                  ? t.overview.billsLate(trading.overdueBills)
                  : t.overview.nothingPastDue
              }
            />
            <StatTile
              href="/reports/margins"
              label={t.overview.marginThisMonth}
              value={<Money value={trading.margin} signed />}
              unit={trading.margin.currency}
              detail={
                trading.invoicesThisMonth === 0
                  ? t.overview.noInvoicesYet
                  : trading.marginBasisPoints === null
                    ? null
                    : t.overview.marginDetail(
                        trading.invoicesThisMonth,
                        marginText(trading.marginBasisPoints, locale),
                      )
              }
            />
          </div>
        </section>
      ) : null}

      <section aria-label={t.overview.theBooks} className="space-y-2">
        {/* Named only beside the trading row, where there are two to tell apart. */}
        {trading ? (
          <h2 className="text-ink-muted text-xs font-medium">{t.overview.theBooks}</h2>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <StatTile
            label={t.overview.cashAndAssets}
            value={<Money value={position.totalFor('asset')} />}
            unit={position.currency}
            detail={t.overview.debitNormalBalances}
            emphasis
          />
          <StatTile
            label={t.overview.revenue}
            value={<Money value={position.totalFor('revenue')} />}
            unit={position.currency}
            detail={t.overview.revenueDetail}
          />
          <StatTile
            label={t.overview.expenses}
            value={<Money value={position.totalFor('expense')} />}
            unit={position.currency}
            detail={t.overview.debitNormalBalances}
          />
          <StatTile
            label={t.overview.entriesPosted}
            value={format.number(summary.entryCount)}
            detail={t.overview.entriesDetail(
              format.number(summary.postingCount),
              summary.accountCount,
            )}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>{t.overview.volumeTitle}</CardTitle>
              <CardDescription>{t.overview.volumeHint}</CardDescription>
            </div>
            <Badge>{chart.currency}</Badge>
          </CardHeader>
          <CardBody>
            <VolumeChart
              columns={chart.columns}
              ticks={chart.ticks}
              currency={chart.currency}
              locale={locale}
              labels={{
                noActivity: t.misc.noActivity,
                viewAsTable: t.misc.viewAsTable,
                day: t.misc.chartDay,
                volume: t.misc.chartVolume(chart.currency),
                caption: t.misc.chartCaption(chart.currency),
              }}
            />
          </CardBody>
        </Card>

        {/*
          The accounting equation, stated rather than assumed. Because every
          posting nets to zero, the debit-normal classes must total exactly what
          the credit-normal classes do — so the panel both reports the position
          and proves the ledger is internally consistent.
        */}
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>{t.overview.positionTitle}</CardTitle>
              <CardDescription>{t.overview.positionHint}</CardDescription>
            </div>
            <Link
              href="/accounts"
              className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
            >
              {t.misc.allAccounts}
            </Link>
          </CardHeader>
          {accounts.length === 0 ? (
            <EmptyState
              title={t.overview.positionEmpty}
              description={t.overview.positionEmptyBody}
            />
          ) : (
            <>
              <TableScroll>
                <Table caption={t.overview.positionCaption}>
                  <thead>
                    <tr>
                      <Th>{t.overview.klass}</Th>
                      <Th align="right">{t.overview.accountCount}</Th>
                      <Th align="right">{t.overview.balanceIn(position.currency)}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {position.rows.map((row) => (
                      <Tr key={row.type}>
                        <Td className="font-medium">{classLabel(row.type, t)}</Td>
                        <Td align="right" numeric className="text-ink-muted">
                          {row.accountCount}
                        </Td>
                        <Td align="right" numeric>
                          <Money value={row.total} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <dl className="flex items-center gap-6 text-xs">
                  <div>
                    <dt className="text-ink-muted">{t.overview.debitSide}</dt>
                    <dd className="numeric font-medium">
                      <Money value={position.debitSide} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">{t.overview.creditSide}</dt>
                    <dd className="numeric font-medium">
                      <Money value={position.creditSide} />
                    </dd>
                  </div>
                </dl>
                <Badge tone={position.balanced ? 'positive' : 'negative'}>
                  {position.balanced ? (
                    <CheckIcon width={12} height={12} />
                  ) : (
                    <AlertIcon width={12} height={12} />
                  )}
                  {position.balanced ? t.overview.equationHolds : t.overview.equationBroken}
                </Badge>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.overview.recentTitle}</CardTitle>
          <Link
            href="/journal"
            className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
          >
            {t.overview.fullJournal}
          </Link>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState
            title={t.overview.journalEmpty}
            description={t.overview.journalEmptyBody}
            action={<ButtonLink href="/transfer">{t.overview.postEntry}</ButtonLink>}
          />
        ) : (
          <TableScroll>
            <Table caption={t.overview.recentCaption}>
              <thead>
                <tr>
                  <Th hideBelow="sm">{t.overview.date}</Th>
                  <Th>{t.overview.entryDescription}</Th>
                  <Th hideBelow="md">{t.overview.accounts}</Th>
                  <Th align="right">{t.overview.amount}</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => {
                  const debit = entry.postings.find((posting) => posting.direction === 'debit');
                  return (
                    <Tr key={entry.id}>
                      <Td hideBelow="sm" className="text-ink-muted whitespace-nowrap">
                        {format.day(new Date(entry.occurredAt))}
                      </Td>
                      <Td className="font-medium">
                        <Link href={`/journal?highlight=${entry.id}`} className="hover:underline">
                          {entry.description}
                        </Link>
                        {/* The date column is gone on a phone; it rides here instead. */}
                        <span className="text-ink-muted block text-xs font-normal sm:hidden">
                          {format.day(new Date(entry.occurredAt))}
                        </span>
                      </Td>
                      <Td hideBelow="md" className="text-ink-muted text-xs">
                        {entry.postings.map((posting) => posting.accountName).join(' · ')}
                      </Td>
                      <Td align="right" numeric>
                        {debit ? <Money value={debit.amount} showCurrency /> : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}

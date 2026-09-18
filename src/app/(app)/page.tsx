import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/stat-tile';
import { Money } from '@/components/money';
import { VolumeChart } from '@/components/volume-chart';
import { SetupNotice } from '@/components/setup-notice';
import { CheckIcon, AlertIcon, ArrowRightIcon } from '@/components/icons';
import { buildPosition, loadDashboard } from '@/server/queries';

export const metadata: Metadata = { title: 'Overview' };

// Balances change on every posting, so nothing here may be served from a cache.
export const dynamic = 'force-dynamic';

const ENTRY_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

export default async function OverviewPage() {
  let model;
  try {
    model = await loadDashboard('USD');
  } catch (error) {
    if (error instanceof Error && error.message.includes('DATABASE_URL')) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  const { accounts, trialBalance, recent, summary, chart } = model;
  const usd = trialBalance.find((row) => row.currency === 'USD') ?? trialBalance[0];
  const position = buildPosition(accounts, 'USD');
  const allBalanced = trialBalance.every((row) => row.balanced);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="text-ink-muted text-sm">
            Every figure below is derived from postings that are balanced by construction.
          </p>
        </div>
        <ButtonLink href="/transfer" variant="primary">
          Post an entry
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
                {allBalanced ? 'The books balance' : 'The books do not balance'}
              </p>
              <p className="text-ink-muted text-xs">
                {allBalanced
                  ? 'Debits equal credits across every currency, with a residual of exactly zero.'
                  : 'A residual other than zero means cached balances no longer match their postings.'}
              </p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
            {usd ? (
              <>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">Debits</dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={usd.debits} showCurrency />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">Credits</dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={usd.credits} showCurrency />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted text-[11px] tracking-wide uppercase">Residual</dt>
                  <dd className="numeric text-sm font-medium">
                    <Money value={usd.residual} />
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cash & assets"
          value={<Money value={position.totalFor('asset')} />}
          unit="USD"
          detail="Debit-normal balances"
          emphasis
        />
        <StatTile
          label="Revenue"
          value={<Money value={position.totalFor('revenue')} />}
          unit="USD"
          detail="Credit-normal, shown positive"
        />
        <StatTile
          label="Expenses"
          value={<Money value={position.totalFor('expense')} />}
          unit="USD"
          detail="Debit-normal balances"
        />
        <StatTile
          label="Entries posted"
          value={summary.entryCount.toLocaleString('en-US')}
          detail={`${summary.postingCount.toLocaleString('en-US')} postings across ${summary.accountCount} accounts`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>Daily posting volume</CardTitle>
              <CardDescription>
                Debit side only, last 30 days — every entry has an equal credit.
              </CardDescription>
            </div>
            <Badge>USD</Badge>
          </CardHeader>
          <CardBody>
            <VolumeChart columns={chart.columns} ticks={chart.ticks} currency={chart.currency} />
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
              <CardTitle>Position by class</CardTitle>
              <CardDescription>Assets + Expenses = Liabilities + Equity + Revenue</CardDescription>
            </div>
            <Link
              href="/accounts"
              className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
            >
              All accounts
            </Link>
          </CardHeader>
          {accounts.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              description="Open an account to start recording entries."
            />
          ) : (
            <>
              <TableScroll>
                <Table caption="Total balance by account class">
                  <thead>
                    <tr>
                      <Th>Class</Th>
                      <Th align="right">Accounts</Th>
                      <Th align="right">Balance (USD)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {position.rows.map((row) => (
                      <Tr key={row.type}>
                        <Td className="font-medium">{row.label}</Td>
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
                    <dt className="text-ink-muted">Debit side</dt>
                    <dd className="numeric font-medium">
                      <Money value={position.debitSide} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Credit side</dt>
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
                  {position.balanced ? 'Equation holds' : 'Equation broken'}
                </Badge>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
          <Link
            href="/journal"
            className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
          >
            Full journal
          </Link>
        </CardHeader>
        {recent.length === 0 ? (
          <EmptyState
            title="The journal is empty"
            description="Post your first entry to see it appear here."
            action={<ButtonLink href="/transfer">Post an entry</ButtonLink>}
          />
        ) : (
          <TableScroll>
            <Table caption="The six most recent journal entries">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Accounts</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => {
                  const debit = entry.postings.find((posting) => posting.direction === 'debit');
                  return (
                    <Tr key={entry.id}>
                      <Td className="text-ink-muted whitespace-nowrap">
                        {ENTRY_DATE.format(new Date(entry.occurredAt))}
                      </Td>
                      <Td className="font-medium">
                        <Link href={`/journal?highlight=${entry.id}`} className="hover:underline">
                          {entry.description}
                        </Link>
                      </Td>
                      <Td className="text-ink-muted text-xs">
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

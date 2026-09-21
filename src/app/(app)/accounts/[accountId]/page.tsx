import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/stat-tile';
import { CompactAmount, DirectionalAmount, Money } from '@/components/money';
import { CursorPagination } from '@/components/pagination';
import { ArrowLeftIcon, DownloadIcon } from '@/components/icons';
import { ButtonLink } from '@/components/ui/button';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { normalBalanceOf, type AccountType } from '@/server/domain/account';

type PageProps = {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ cursor?: string; direction?: string }>;
};

const PAGE_SIZE = 25;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { accountId } = await params;
  const account = await (await viewerServices()).services.accounts.byId(accountId);
  return { title: account.ok ? account.value.name : 'Account' };
}

export const dynamic = 'force-dynamic';

export default async function AccountStatementPage({ params, searchParams }: PageProps) {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  const [{ accountId }, query] = await Promise.all([params, searchParams]);

  const { services } = await viewerServices();
  const statement = await services.reporting.statement(accountId, {
    limit: PAGE_SIZE,
    cursor: query.cursor,
    direction: query.direction === 'backward' ? 'backward' : 'forward',
  });
  if (!statement) notFound();

  const { account, lines, pending } = statement;
  const normal = normalBalanceOf(account.type as AccountType);

  return (
    <>
      <div className="space-y-1">
        <Link
          href="/accounts"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors duration-150"
        >
          <ArrowLeftIcon width={13} height={13} />
          {t.accounts.title}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{account.name}</h1>
            <p className="text-ink-muted font-mono text-xs">{account.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{account.type}</Badge>
            <Badge>{normal}-normal</Badge>
            {account.status === 'closed' ? (
              <Badge tone="caution">{t.statement.closed}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t.statement.postedBalance}
          value={<Money value={account.balance} signed />}
          unit={account.balance.currency}
          detail={t.statement.postedHint}
          emphasis
        />
        <StatTile
          label={t.statement.available}
          value={<Money value={account.availableBalance} signed />}
          unit={account.balance.currency}
          detail={
            account.balance.minorUnits === account.availableBalance.minorUnits
              ? 'Nothing reserved; all of it is spendable'
              : 'Posted less in-flight outflows — what can still be spent'
          }
        />
        <StatTile
          label={t.statement.pending}
          value={<Money value={account.pendingBalance} signed />}
          unit={account.balance.currency}
          detail={t.statement.pendingHint}
        />
      </div>

      {/*
        Pending entries above the ledger, not inside it — the arrangement every
        bank statement uses, and for the same reason: these have not moved the
        balance, so interleaving them would make the running total reconcile
        with nothing on the page.
      */}
      {pending.length > 0 ? (
        <Card className="border-caution">
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>{t.statement.pendingNote}</CardTitle>
              <CardDescription>
                {t.misc.fundsReserved} <strong>available</strong>, but nothing has moved.
              </CardDescription>
            </div>
            <Badge tone="caution">{pending.length} in flight</Badge>
          </CardHeader>
          <TableScroll>
            <Table caption={`Pending entries for ${account.name}`}>
              <thead>
                <tr>
                  <Th>{t.statement.date}</Th>
                  <Th>{t.statement.description}</Th>
                  <Th align="right">{t.statement.amount}</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((line) => (
                  <Tr key={line.postingId}>
                    <Td className="text-ink-muted whitespace-nowrap">
                      {format.day(new Date(line.occurredAt))}
                    </Td>
                    <Td>
                      <Link href={`/journal/${line.transactionId}`} className="hover:underline">
                        {line.description}
                      </Link>
                    </Td>
                    <Td align="right" numeric>
                      <CompactAmount value={line.amount} direction={line.direction} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.statement.title}</CardTitle>
            <CardDescription>{t.misc.statementNote}</CardDescription>
          </div>
          <ButtonLink href={`/api/v1/accounts/${account.id}/statement?format=csv`} size="sm">
            <DownloadIcon width={13} height={13} />
            {t.misc.exportCsv}
          </ButtonLink>
        </CardHeader>

        {lines.items.length === 0 ? (
          <EmptyState title={t.statement.emptyTitle} description={t.statement.emptyBody} />
        ) : (
          <>
            <TableScroll>
              <Table caption={`Statement for ${account.name}`}>
                <thead>
                  <tr>
                    <Th>{t.statement.date}</Th>
                    <Th>{t.statement.description}</Th>
                    <Th align="right">
                      <span className="sm:hidden">{t.statement.amount}</span>
                      <span className="hidden sm:inline">{t.journal.debit}</span>
                    </Th>
                    <Th align="right" className="hidden sm:table-cell">
                      {t.journal.credit}
                    </Th>
                    <Th align="right">{t.statement.balance}</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.items.map((line) => (
                    <Tr key={line.postingId}>
                      <Td className="text-ink-muted whitespace-nowrap">
                        {format.day(new Date(line.occurredAt))}
                      </Td>
                      <Td>
                        <Link
                          href={`/journal?highlight=${line.transactionId}`}
                          className="hover:underline"
                        >
                          {line.description}
                        </Link>
                      </Td>
                      <Td align="right" numeric>
                        <span className="sm:hidden">
                          <CompactAmount value={line.amount} direction={line.direction} />
                        </span>
                        <span className="hidden sm:inline">
                          <DirectionalAmount
                            value={line.amount}
                            direction={line.direction}
                            side="debit"
                          />
                        </span>
                      </Td>
                      <Td align="right" numeric className="hidden sm:table-cell">
                        <DirectionalAmount
                          value={line.amount}
                          direction={line.direction}
                          side="credit"
                        />
                      </Td>
                      <Td align="right" numeric className="font-medium">
                        <Money value={line.runningBalance} signed />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>

            <CursorPagination
              label={t.forms.pagination}
              basePath={`/accounts/${account.id}`}
              nextCursor={lines.nextCursor}
              previousCursor={lines.previousCursor}
              showingLabel={t.misc.showingLines(lines.items.length)}
              newerLabel={t.misc.newer}
              olderLabel={t.misc.older}
            />
          </>
        )}
      </Card>
    </>
  );
}

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
import { ArrowLeftIcon } from '@/components/icons';
import { services } from '@/server/container';
import { normalBalanceOf, type AccountType } from '@/server/domain/account';

type PageProps = {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ cursor?: string; from?: string }>;
};

const PAGE_SIZE = 25;

const LINE_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { accountId } = await params;
  const account = await services().accounts.byId(accountId);
  return { title: account.ok ? account.value.name : 'Account' };
}

export const dynamic = 'force-dynamic';

export default async function AccountStatementPage({ params, searchParams }: PageProps) {
  const [{ accountId }, query] = await Promise.all([params, searchParams]);

  const statement = await services().reporting.statement(accountId, {
    limit: PAGE_SIZE,
    cursor: query.cursor,
  });
  if (!statement) notFound();

  const { account, lines } = statement;
  const normal = normalBalanceOf(account.type as AccountType);

  return (
    <>
      <div className="space-y-1">
        <Link
          href="/accounts"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors duration-150"
        >
          <ArrowLeftIcon width={13} height={13} />
          Chart of accounts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{account.name}</h1>
            <p className="text-ink-muted font-mono text-xs">{account.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge>{account.type}</Badge>
            <Badge>{normal}-normal</Badge>
            {account.status === 'closed' ? <Badge tone="caution">Closed</Badge> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Current balance"
          value={<Money value={account.balance} signed />}
          unit={account.balance.currency}
          emphasis
        />
        <StatTile
          label="Overdraft"
          value={account.overdraftAllowed ? 'Allowed' : 'Blocked'}
          detail={
            account.overdraftAllowed
              ? 'This account may go below zero.'
              : 'A posting that would overdraw this account is rejected.'
          }
        />
        <StatTile
          label="Opened"
          value={LINE_DATE.format(new Date(account.createdAt))}
          detail={`Denominated in ${account.balance.currency}`}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Statement</CardTitle>
            <CardDescription>
              Newest first. The running balance is computed by Postgres over this account&rsquo;s
              own postings.
            </CardDescription>
          </div>
        </CardHeader>

        {lines.items.length === 0 ? (
          <EmptyState
            title="No postings yet"
            description="Nothing has been posted to this account. It will appear here the moment something is."
          />
        ) : (
          <>
            <TableScroll>
              <Table caption={`Statement for ${account.name}`}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th align="right">
                      <span className="sm:hidden">Amount</span>
                      <span className="hidden sm:inline">Debit</span>
                    </Th>
                    <Th align="right" className="hidden sm:table-cell">
                      Credit
                    </Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.items.map((line) => (
                    <Tr key={line.postingId}>
                      <Td className="text-ink-muted whitespace-nowrap">
                        {LINE_DATE.format(new Date(line.occurredAt))}
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
              basePath={`/accounts/${account.id}`}
              nextCursor={lines.nextCursor}
              previousCursor={query.cursor ? '' : undefined}
              showing={lines.items.length}
            />
          </>
        )}
      </Card>
    </>
  );
}

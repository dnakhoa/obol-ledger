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
import { demoServices } from '@/server/container';
import { normalBalanceOf, type AccountType } from '@/server/domain/account';

type PageProps = {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ cursor?: string; direction?: string }>;
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
  const account = await (await demoServices()).accounts.byId(accountId);
  return { title: account.ok ? account.value.name : 'Account' };
}

export const dynamic = 'force-dynamic';

export default async function AccountStatementPage({ params, searchParams }: PageProps) {
  const [{ accountId }, query] = await Promise.all([params, searchParams]);

  const statement = await (
    await demoServices()
  ).reporting.statement(accountId, {
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
          label="Posted balance"
          value={<Money value={account.balance} signed />}
          unit={account.balance.currency}
          detail="Settled entries only — what is actually there"
          emphasis
        />
        <StatTile
          label="Available"
          value={<Money value={account.availableBalance} signed />}
          unit={account.balance.currency}
          detail={
            account.balance.minorUnits === account.availableBalance.minorUnits
              ? 'Nothing reserved; all of it is spendable'
              : 'Posted less in-flight outflows — what can still be spent'
          }
        />
        <StatTile
          label="Pending"
          value={<Money value={account.pendingBalance} signed />}
          unit={account.balance.currency}
          detail="Settled plus in-flight — what it becomes if everything lands"
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
              <CardTitle>Pending — not yet in the balance</CardTitle>
              <CardDescription>
                Funds are reserved, so they are already out of <strong>available</strong>, but
                nothing has moved.
              </CardDescription>
            </div>
            <Badge tone="caution">{pending.length} in flight</Badge>
          </CardHeader>
          <TableScroll>
            <Table caption={`Pending entries for ${account.name}`}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((line) => (
                  <Tr key={line.postingId}>
                    <Td className="text-ink-muted whitespace-nowrap">
                      {LINE_DATE.format(new Date(line.occurredAt))}
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
            <CardTitle>Statement</CardTitle>
            <CardDescription>
              Settled entries, newest first. The running balance is computed by Postgres over this
              account&rsquo;s own postings, so it reconciles with the posted balance above.
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
              previousCursor={lines.previousCursor}
              showing={lines.items.length}
              noun="line"
            />
          </>
        )}
      </Card>
    </>
  );
}

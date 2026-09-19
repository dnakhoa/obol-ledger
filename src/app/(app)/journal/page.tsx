import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { CompactAmount, DirectionalAmount } from '@/components/money';
import { CursorPagination } from '@/components/pagination';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { ArrowRightIcon, CheckIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { demoServices } from '@/server/container';
import type { Page, TransactionDto } from '@/server/services/dto';

export const metadata: Metadata = { title: 'Journal' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const ENTRY_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const ENTRY_TIME = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

const ENTRY_YEAR = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' });

type PageProps = {
  searchParams: Promise<{ cursor?: string; direction?: string; highlight?: string }>;
};

export default async function JournalPage({ searchParams }: PageProps) {
  const query = await searchParams;

  let page: Page<TransactionDto>;
  try {
    page = await (
      await demoServices()
    ).journal.list({
      limit: PAGE_SIZE,
      cursor: query.cursor,
      direction: query.direction === 'backward' ? 'backward' : 'forward',
    });
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Journal"
        description="Every entry, newest first, with its postings. Entries are append-only: a mistake is corrected by posting a reversing entry, never by editing history."
        actions={
          <ButtonLink href="/transfer" variant="primary">
            Post an entry
            <ArrowRightIcon />
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Entries</CardTitle>
            <CardDescription>
              Each entry&rsquo;s postings sum to zero — verified at COMMIT by a deferred database
              constraint.
            </CardDescription>
          </div>
        </CardHeader>

        {page.items.length === 0 ? (
          <EmptyState
            title="Nothing posted yet"
            description="The journal is empty. Post an entry, or run pnpm db:seed to load a month of example books."
            action={<ButtonLink href="/transfer">Post an entry</ButtonLink>}
          />
        ) : (
          <>
            <TableScroll>
              <Table caption="Journal entries with their postings">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description / account</Th>
                    <Th align="right">
                      <span className="sm:hidden">Amount</span>
                      <span className="hidden sm:inline">Debit</span>
                    </Th>
                    <Th align="right" className="hidden sm:table-cell">
                      Credit
                    </Th>
                  </tr>
                </thead>
                {page.items.map((entry) => (
                  /*
                   * One <tbody> per entry, which is what groups the header row
                   * with its postings semantically — a screen reader announces
                   * them as one block, and the CSS border can hang off the
                   * group rather than being faked with a spacer row.
                   */
                  <tbody
                    key={entry.id}
                    id={entry.id}
                    className={cn(
                      'border-canvas target:bg-surface-hover border-b-4',
                      query.highlight === entry.id && 'bg-surface-hover',
                    )}
                  >
                    <tr className="bg-surface-sunken/60">
                      {/*
                        The clock and the year are dropped on a phone, where the
                        date column would otherwise squeeze the amounts off the
                        edge. Nothing is lost: the full timestamp is on the
                        entry's own page.
                      */}
                      <Td className="text-ink-muted align-top text-xs whitespace-nowrap">
                        {ENTRY_DAY.format(new Date(entry.occurredAt))}
                        <span className="hidden sm:inline">
                          , {ENTRY_YEAR.format(new Date(entry.occurredAt))}
                        </span>
                        <span className="block text-[11px] sm:inline sm:text-xs">
                          <span className="hidden sm:inline">, </span>
                          {ENTRY_TIME.format(new Date(entry.occurredAt))}
                        </span>
                      </Td>
                      <Td className="font-medium">
                        {entry.description}
                        <span className="text-ink-muted ml-2 text-[11px] font-normal">
                          {entry.currency}
                        </span>
                      </Td>
                      <Td colSpan={2} align="right">
                        <Badge tone="positive">
                          <CheckIcon width={11} height={11} />
                          Balanced
                        </Badge>
                      </Td>
                    </tr>
                    {entry.postings.map((posting) => (
                      <tr key={posting.id} className="text-sm">
                        <Td />
                        <Td className="pl-8">
                          <Link
                            href={`/accounts/${posting.accountId}`}
                            className="text-ink-secondary hover:text-ink transition-colors duration-150 hover:underline"
                          >
                            {posting.accountName}
                          </Link>
                        </Td>
                        <Td align="right" numeric>
                          <span className="sm:hidden">
                            <CompactAmount value={posting.amount} direction={posting.direction} />
                          </span>
                          <span className="hidden sm:inline">
                            <DirectionalAmount
                              value={posting.amount}
                              direction={posting.direction}
                              side="debit"
                            />
                          </span>
                        </Td>
                        <Td align="right" numeric className="hidden sm:table-cell">
                          <DirectionalAmount
                            value={posting.amount}
                            direction={posting.direction}
                            side="credit"
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </Table>
            </TableScroll>

            <CursorPagination
              basePath="/journal"
              nextCursor={page.nextCursor}
              previousCursor={page.previousCursor}
              showing={page.items.length}
              noun="entry"
            />
          </>
        )}
      </Card>
    </>
  );
}

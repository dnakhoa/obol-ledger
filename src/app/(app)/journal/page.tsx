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
import { ArrowRightIcon, CheckIcon, DownloadIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats, type Messages } from '@/lib/i18n';
import type { AccountDto, Page, TransactionDto } from '@/server/services/dto';
import { JournalFilters } from '@/components/journal-filters';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.journal.title };
}
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

type PageProps = {
  searchParams: Promise<{
    cursor?: string;
    direction?: string;
    highlight?: string;
    accountId?: string;
    search?: string;
    metadataKey?: string;
    metadataValue?: string;
  }>;
};

/** How an entry came to exist, in the reader's language. */
function viaLabel(via: string, t: Messages): string {
  switch (via) {
    case 'ui':
      return t.journal.viaUi;
    case 'api':
      return t.journal.viaApi;
    case 'system':
      return t.journal.viaSystem;
    case 'import':
      return t.journal.viaImport;
    default:
      return t.journal.viaUnknown;
  }
}

export default async function JournalPage({ searchParams }: PageProps) {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  const query = await searchParams;

  let page: Page<TransactionDto>;
  let accounts: AccountDto[];
  try {
    const { services } = await viewerServices();
    // Independent reads: the accounts are only needed to populate the filter.
    [page, accounts] = await Promise.all([
      services.journal.list({
        limit: PAGE_SIZE,
        cursor: query.cursor,
        direction: query.direction === 'backward' ? 'backward' : 'forward',
        accountId: query.accountId,
        search: query.search,
        metadataKey: query.metadataKey,
        metadataValue: query.metadataValue,
      }),
      services.accounts.list(),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) {
      return <SetupNotice detail={error.message} />;
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        title={t.journal.title}
        description={t.journal.description}
        actions={
          <>
            {/*
              A plain link, not a fetch-and-blob dance: the response already
              carries Content-Disposition, so the browser's own download
              machinery handles it — including resuming and the "where do you
              want this?" dialog that a JavaScript download cannot offer.
            */}
            <ButtonLink
              href={`/api/v1/entries?${new URLSearchParams({
                format: 'csv',
                ...(query.accountId ? { accountId: query.accountId } : {}),
                ...(query.search ? { search: query.search } : {}),
                ...(query.metadataKey && query.metadataValue
                  ? { metadataKey: query.metadataKey, metadataValue: query.metadataValue }
                  : {}),
              }).toString()}`}
            >
              <DownloadIcon />
              {t.misc.exportCsv}
            </ButtonLink>
            <ButtonLink href="/transfer" variant="primary">
              {t.journal.postEntry}
              <ArrowRightIcon />
            </ButtonLink>
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.journal.entries}</CardTitle>
            <CardDescription>{t.misc.entriesNote}</CardDescription>
          </div>
        </CardHeader>

        <JournalFilters
          labels={{
            search: t.forms.searchEntries,
            anyAccount: t.forms.anyAccount,
            noMatch: t.forms.noMatch,
            description: t.misc.filterDescription,
            account: t.misc.filterAccount,
            apply: t.misc.applyFilters,
            clear: t.misc.clearFilters,
            remove: t.forms.remove,
            matchNote: t.misc.filterMatchNote,
          }}
          accounts={accounts}
          accountId={query.accountId}
          search={query.search}
          metadataKey={query.metadataKey}
          metadataValue={query.metadataValue}
          resultCount={page.items.length}
        />

        {page.items.length === 0 ? (
          query.accountId || query.search || query.metadataKey ? (
            <EmptyState
              title={t.journal.noMatches}
              description={t.journal.noMatchesBody}
              action={<ButtonLink href="/journal">{t.journal.clearFilters}</ButtonLink>}
            />
          ) : (
            <EmptyState
              title={t.journal.empty}
              description={t.journal.emptyBody}
              action={<ButtonLink href="/transfer">{t.journal.postEntry}</ButtonLink>}
            />
          )
        ) : (
          <>
            <TableScroll>
              <Table caption={t.journal.caption}>
                <thead>
                  <tr>
                    <Th>{t.journal.date}</Th>
                    <Th>{t.journal.descriptionOrAccount}</Th>
                    <Th align="right">
                      <span className="sm:hidden">{t.journal.amount}</span>
                      <span className="hidden sm:inline">{t.journal.debit}</span>
                    </Th>
                    <Th align="right" className="hidden sm:table-cell">
                      {t.journal.credit}
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
                        {format.day(new Date(entry.occurredAt))}
                        <span className="block text-[11px] sm:inline sm:text-xs">
                          <span className="hidden sm:inline">, </span>
                          {format.time(new Date(entry.occurredAt))}
                        </span>
                      </Td>
                      <Td className="font-medium">
                        <Link href={`/journal/${entry.id}`} className="hover:underline">
                          {entry.description}
                        </Link>
                        <span className="text-ink-muted ml-2 text-[11px] font-normal">
                          {entry.currency}
                        </span>
                        {/*
                          Who wrote it. Shown on the row rather than only on
                          the entry's own page, because "who posted this" is
                          asked while scanning a list, not after opening one.
                          Left out when it was never recorded — a row older
                          than the audit columns, or one a script wrote without
                          saying: "Not recorded" under every one of those is
                          noise the eye learns to skip, and it then skips the
                          rows that do have something to say.
                        */}
                        {entry.createdVia === 'unknown' ? null : (
                          <span className="text-ink-muted block text-[11px] font-normal">
                            {viaLabel(entry.createdVia, t)}
                          </span>
                        )}
                      </Td>
                      <Td colSpan={2} align="right">
                        {entry.reversedByTransactionId ? (
                          <Badge tone="caution">{t.journal.reversed}</Badge>
                        ) : entry.reversesTransactionId ? (
                          <Badge tone="neutral">{t.journal.reversal}</Badge>
                        ) : (
                          <Badge tone="positive">
                            <CheckIcon width={11} height={11} />
                            {t.journal.balanced}
                          </Badge>
                        )}
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
              label={t.forms.pagination}
              basePath="/journal"
              nextCursor={page.nextCursor}
              previousCursor={page.previousCursor}
              showingLabel={t.misc.showingEntries(page.items.length)}
              newerLabel={t.misc.newer}
              olderLabel={t.misc.older}
              // Paging must not silently drop the filters the reader applied.
              preserve={{
                ...(query.accountId ? { accountId: query.accountId } : {}),
                ...(query.search ? { search: query.search } : {}),
                ...(query.metadataKey && query.metadataValue
                  ? { metadataKey: query.metadataKey, metadataValue: query.metadataValue }
                  : {}),
              }}
            />
          </>
        )}
      </Card>
    </>
  );
}

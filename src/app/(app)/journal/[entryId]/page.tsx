import type { Metadata } from 'next';
import { AttachmentsCard } from '@/app/(app)/documents/attachments-card';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { DirectionalAmount, Money } from '@/components/money';
import { ReverseEntry } from '@/components/reverse-entry';
import { ArrowLeftIcon, CheckIcon } from '@/components/icons';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { toMoneyDto } from '@/server/services/serialize';
import type { MinorUnits } from '@/lib/money';
import { reverseEntryAction } from './actions';
import { transitionEntryAction } from './settle-actions';
import { SettleEntry } from '@/components/settle-entry';

type PageProps = { params: Promise<{ entryId: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { entryId } = await params;
  const entry = await (await viewerServices()).services.journal.byId(entryId);
  return { title: entry?.description ?? 'Entry' };
}

export default async function EntryPage({ params }: PageProps) {
  const { locale, t } = await translations();
  const format = dateFormats(locale);
  const { entryId } = await params;
  const entry = await (await viewerServices()).services.journal.byId(entryId);
  if (!entry) notFound();

  // Summed in bigint and formatted by the same function the API uses. Going
  // through `Number` here would reintroduce exactly the floating-point error
  // the rest of the system exists to avoid — on the one screen that shows a
  // single entry's total.
  const totalDebits = toMoneyDto(
    entry.postings
      .filter((posting) => posting.direction === 'debit')
      .reduce((sum, posting) => sum + BigInt(posting.amount.minorUnits), 0n) as MinorUnits,
    entry.currency,
  );

  const reversed = entry.reversedByTransactionId !== null;
  const isReversal = entry.reversesTransactionId !== null;
  const isPending = entry.status === 'pending';
  const isArchived = entry.status === 'archived';

  // Entries the stock records wrote cannot be reversed here: the journal would
  // move the account and leave the lots behind. The service and a trigger
  // both refuse it, so the page says so up front and points to where the
  // correction belongs instead of offering a button that can only fail.
  const stockOwner = entry.metadata['sale']
    ? { href: `/sales/${entry.metadata['sale']}`, label: t.entry.openSale }
    : entry.metadata['landedCostCharge'] && entry.metadata['shipment']
      ? { href: `/stock/shipments/${entry.metadata['shipment']}`, label: t.shipments.title }
      : entry.metadata['inventoryMovement']
        ? { href: '/stock', label: t.stock.title }
        : null;

  return (
    <>
      <div className="space-y-1">
        <Link
          href="/journal"
          className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-xs transition-colors duration-150"
        >
          <ArrowLeftIcon width={13} height={13} />
          {t.journal.title}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{entry.description}</h1>
            <p className="text-ink-muted font-mono text-xs">{entry.id}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{entry.currency}</Badge>
            {isPending ? <Badge tone="caution">{t.entry.pending}</Badge> : null}
            {isArchived ? <Badge tone="neutral">{t.entry.cancelled}</Badge> : null}
            {reversed ? <Badge tone="caution">{t.entry.reversed}</Badge> : null}
            {isReversal ? <Badge tone="neutral">{t.entry.reversingEntry}</Badge> : null}
            {!reversed && !isReversal && !isPending && !isArchived ? (
              <Badge tone="positive">
                <CheckIcon width={11} height={11} />
                {t.misc.inEffect}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        The relationship to another entry is the first thing a reader needs, so
        it sits above the postings rather than below them. "Is this still in
        effect?" is not answerable from the amounts alone.
      */}
      {reversed || isReversal ? (
        <Card className="border-caution">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>{reversed ? t.entry.cancelledByReversal : t.entry.cancelsEarlier}</p>
            <Link
              href={`/journal/${entry.reversedByTransactionId ?? entry.reversesTransactionId}`}
              className="font-medium underline"
            >
              {reversed ? t.misc.viewReversal : t.entry.viewOriginal}
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-card border-line bg-surface border px-4 py-3.5">
          <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">
            {t.entry.amount}
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">
            <Money value={totalDebits} />
          </p>
          <p className="text-ink-muted mt-1 text-xs">
            {isPending
              ? t.entry.reservedNotMoved
              : isArchived
                ? t.entry.cancelledNeverMoved
                : t.entry.debitSideMatches}
          </p>
        </div>
        <div className="rounded-card border-line bg-surface border px-4 py-3.5">
          <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">
            {t.entry.occurred}
          </p>
          <p className="mt-1.5 text-sm font-medium">{format.full(new Date(entry.occurredAt))}</p>
          <p className="text-ink-muted mt-1 text-xs">
            {t.misc.recordedAt(format.full(new Date(entry.createdAt)))}
          </p>
        </div>
        <div className="rounded-card border-line bg-surface border px-4 py-3.5">
          <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">
            {t.entry.postings}
          </p>
          <p className="mt-1.5 text-sm font-medium">{entry.postings.length} lines</p>
          <p className="text-ink-muted mt-1 text-xs">{t.entry.sumsToZero}</p>
        </div>
      </div>

      {Object.keys(entry.metadata).length > 0 ? (
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>{t.entry.metadata}</CardTitle>
              <CardDescription>
                {t.entry.metadataHintBefore}{' '}
                <code className="font-mono text-[11px]">?metadataKey=&amp;metadataValue=</code>{' '}
                {t.entry.metadataHintAfter}
              </CardDescription>
            </div>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {Object.entries(entry.metadata).map(([key, value]) => (
              <Link
                key={key}
                href={`/journal?metadataKey=${encodeURIComponent(key)}&metadataValue=${encodeURIComponent(value)}`}
                className="border-line bg-surface-sunken hover:bg-surface-hover inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors duration-150"
              >
                <span className="text-ink-muted">{key}</span>
                <span className="text-ink">{value}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.entry.postings}</CardTitle>
            <CardDescription>{t.entry.postingsHint}</CardDescription>
          </div>
        </CardHeader>
        <TableScroll>
          <Table caption={`Postings for ${entry.description}`}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>{t.entry.account}</Th>
                <Th align="right">{t.journal.debit}</Th>
                <Th align="right">{t.journal.credit}</Th>
              </tr>
            </thead>
            <tbody>
              {entry.postings.map((posting) => (
                <Tr key={posting.id}>
                  <Td className="text-ink-muted numeric">{posting.sequence + 1}</Td>
                  <Td>
                    <Link href={`/accounts/${posting.accountId}`} className="hover:underline">
                      {posting.accountName}
                    </Link>
                  </Td>
                  <Td align="right" numeric>
                    <DirectionalAmount
                      value={posting.amount}
                      direction={posting.direction}
                      side="debit"
                    />
                  </Td>
                  <Td align="right" numeric>
                    <DirectionalAmount
                      value={posting.amount}
                      direction={posting.direction}
                      side="credit"
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <Card>
        <CardBody>
          {isPending ? (
            <SettleEntry
              transactionId={entry.id}
              action={transitionEntryAction}
              labels={{
                pending: t.misc.entryPending,
                cancel: t.misc.cancelIt,
                note: t.misc.settleNote,
                explain: t.misc.pendingExplain,
              }}
            />
          ) : isArchived ? (
            <p className="text-ink-muted text-xs">{t.misc.cancelledNote}</p>
          ) : reversed ? (
            <p className="text-ink-muted text-xs">{t.misc.alreadyReversedNote}</p>
          ) : stockOwner ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t.entry.ownedByStockTitle}</p>
              <p className="text-ink-secondary text-xs">{t.entry.ownedByStock}</p>
              <Link href={stockOwner.href} className="text-xs font-medium underline">
                {stockOwner.label}
              </Link>
            </div>
          ) : (
            <ReverseEntry
              transactionId={entry.id}
              action={reverseEntryAction}
              labels={{
                description: t.forms.reversalDescription,
                hint: t.forms.reversalHint,
                posting: t.forms.posting,
                submit: t.forms.postReversal,
                viewReversal: t.misc.viewReversal,
                noEditing: t.misc.noEditing,
                reverseThis: t.misc.reverseThis,
                note: t.misc.reverseNote,
                explain: t.misc.reverseExplain(entry.description),
                cancel: t.common.cancel,
              }}
            />
          )}
        </CardBody>
      </Card>

      <AttachmentsCard target={{ transactionId: entry.id }} path={`/journal/${entry.id}`} />
    </>
  );
}

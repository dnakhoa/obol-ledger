import type { Metadata } from 'next';
import { AttachmentsCard } from '@/app/(app)/documents/attachments-card';
import { EInvoiceCard } from '@/app/(app)/sales/einvoices/einvoice-card';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { StatTile } from '@/components/stat-tile';
import { MarginPercent } from '@/components/margin';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { toQuantityString, unitLabel } from '@/lib/quantity';
import { exponentOf, minorUnits, toDecimalString, type CurrencyCode } from '@/lib/money';
import { formatAmount } from '@/lib/format';
import type { SaleSummary } from '@/server/services/sales';
import type { AccountDto } from '@/server/services/dto';
import type { CreditableLine } from '@/server/services/credit-notes';
import { CreditNoteForm } from '@/components/credit-note-form';
import { issueCreditNoteAction } from './actions';

/** The invoice number is the title: it is what the person is looking for. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ saleId: string }>;
}): Promise<Metadata> {
  const { saleId } = await params;
  try {
    const sale = await (await viewerServices()).services.sales.get(saleId);
    if (sale) return { title: sale.reference };
  } catch {
    // The page renders the setup notice; a title is not worth failing on.
  }
  const { t } = await translations();
  return { title: t.sales.title };
}
export const dynamic = 'force-dynamic';

/**
 * One invoice, laid out the way the paper one is — plus the column the paper
 * one never had.
 *
 * Each line shows what it was sold for beside what it cost from the lots, and
 * names the lots. That last part is what lets a salesperson who quoted a price
 * against last month's container see that the stock actually shipped from the
 * dearer one that arrived since.
 */
export default async function SalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);

  let sale: SaleSummary | null;
  let accounts: AccountDto[] = [];
  let creditable: readonly CreditableLine[] = [];
  try {
    const { services } = await viewerServices();
    [sale, accounts, creditable] = await Promise.all([
      services.sales.get(saleId),
      services.accounts.list(),
      services.creditNotes.creditable(saleId),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }
  if (!sale) notFound();

  const credited = sale.credited.gross.minorUnits !== '0' || sale.credited.cost.minorUnits !== '0';
  const functional = sale.revenue.currency;
  // Where the revenue can come back out: any open revenue account in the
  // books' own currency. A contra account — 521 under Thông tư 200 — is the
  // usual choice, so it is offered first when the chart has one.
  const revenueAccounts = accounts.filter(
    (account) =>
      account.type === 'revenue' &&
      account.balance.currency === functional &&
      account.status === 'open',
  );
  const contra = revenueAccounts.find((account) => account.code?.startsWith('521'));
  const saleCurrency: CurrencyCode = sale.currency;
  const quantityOf = (value: string, precision: number) =>
    toQuantityString(BigInt(value), precision);
  const formLines = sale.lines.flatMap((line) => {
    const left = creditable.find((entry) => entry.saleMovementId === line.movementId);
    if (!left || (left.quantityMinor === '0' && left.amountMinor === '0')) return [];
    return [
      {
        movementId: line.movementId,
        sku: line.sku,
        name: line.itemName,
        unit: unitLabel(line.unit),
        precision: line.quantityPrecision,
        returnableText: quantityOf(left.quantityMinor, line.quantityPrecision),
        returnableMinor: left.quantityMinor,
        creditableMinor: left.amountMinor,
        creditableText: formatAmount(
          { amount: toDecimalString(minorUnits(BigInt(left.amountMinor)), saleCurrency) },
          locale,
        ),
      },
    ];
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={sale.reference}
        description={`${sale.customerName} · ${DATE.day(sale.occurredAt)}`}
        actions={
          <>
            <ButtonLink href={`/journal/${sale.transactionId}`}>{t.sales.viewEntry}</ButtonLink>
            <ButtonLink href="/sales">
              <ArrowLeftIcon />
              {t.sales.allSales}
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={t.sales.gross}
          value={<Money value={sale.gross} />}
          unit={sale.gross.currency}
          detail={
            credited ? (
              <>
                {t.creditNotes.credited} <Money value={sale.credited.gross} />
              </>
            ) : (
              <>
                {t.sales.net} <Money value={sale.net} /> · {t.sales.tax} <Money value={sale.tax} />
              </>
            )
          }
        />
        {/*
          Once anything is credited, every tile shows what the sale is worth
          now, and says what came off beneath it. Mixing invoiced revenue with
          a margin after credits would show three figures that do not add up.
        */}
        <StatTile
          label={t.sales.revenue}
          value={<Money value={credited ? sale.netRevenue : sale.revenue} />}
          unit={sale.revenue.currency}
          detail={
            credited ? (
              <>
                {t.creditNotes.credited} <Money value={sale.credited.revenue} />
              </>
            ) : undefined
          }
        />
        <StatTile
          label={t.sales.cost}
          value={<Money value={credited ? sale.netCost : sale.cost} />}
          unit={sale.cost.currency}
          detail={
            credited ? (
              <>
                {t.creditNotes.stockBack} <Money value={sale.credited.cost} />
              </>
            ) : undefined
          }
        />
        <StatTile
          label={credited ? `${t.sales.margin} · ${t.creditNotes.afterCredits}` : t.sales.margin}
          value={<Money value={credited ? sale.netMargin : sale.margin} signed />}
          unit={sale.margin.currency}
          tone={
            (credited ? sale.netMargin : sale.margin).amount.startsWith('-') ? 'caution' : 'neutral'
          }
          detail={
            <>
              <MarginPercent
                basisPoints={credited ? sale.netMarginBasisPoints : sale.marginBasisPoints}
                className="ml-0"
              />
              {' · '}
              {t.sales.due}:{' '}
              {sale.dueOn ? DATE.day(new Date(`${sale.dueOn}T12:00:00Z`)) : t.sales.onReceipt}
            </>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.sales.linesTitle}</CardTitle>
          <CardDescription>{t.sales.linesHint}</CardDescription>
        </CardHeader>
        <TableScroll>
          <Table caption={t.sales.linesCaption}>
            <thead>
              <tr>
                <Th>{t.sales.product}</Th>
                <Th align="right">{t.product.quantity}</Th>
                <Th hideBelow="md">{t.sales.shippedFrom}</Th>
                <Th hideBelow="md" align="right">
                  {t.sales.revenue}
                </Th>
                <Th hideBelow="md" align="right">
                  {t.sales.cost}
                </Th>
                <Th align="right">{t.sales.margin}</Th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((line) => {
                const quantity = (value: string) =>
                  toQuantityString(BigInt(value), line.quantityPrecision);
                return (
                  <Tr key={line.movementId}>
                    <Td>
                      <Link
                        href={`/stock/${line.itemId}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {line.itemName}
                      </Link>
                      <span className="text-ink-muted ml-2 text-xs">{line.sku}</span>
                    </Td>
                    <Td align="right" numeric>
                      {quantity(line.quantityMinor)}
                      <span className="text-ink-muted ml-1 text-[11px]">
                        {unitLabel(line.unit)}
                      </span>
                      {line.creditedQuantityMinor !== '0' ? (
                        <span className="text-caution block text-[11px]">
                          {t.creditNotes.returned(quantity(line.creditedQuantityMinor))}
                        </span>
                      ) : null}
                    </Td>
                    <Td hideBelow="md">
                      <span className="flex flex-wrap gap-1">
                        {line.drawnFrom.map((draw, index) => (
                          <Badge key={`${line.movementId}-${index}`}>
                            {draw.layerReference ?? t.product.delivery} ·{' '}
                            {quantity(draw.quantityMinor)}
                          </Badge>
                        ))}
                      </span>
                    </Td>
                    <Td hideBelow="md" align="right" numeric>
                      <Money value={line.revenue} />
                    </Td>
                    <Td hideBelow="md" align="right" numeric>
                      <Money value={line.cost} />
                    </Td>
                    <Td align="right" numeric>
                      <Money value={line.margin} signed />
                      <MarginPercent basisPoints={line.marginBasisPoints} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <Tr>
                {/* Cells rather than a colSpan: a span over a column hidden on
                    a phone would shift every total one to the right. */}
                <Td className="font-medium">{t.margins.total}</Td>
                <Td />
                <Td hideBelow="md" />
                <Td hideBelow="md" align="right" numeric className="font-semibold">
                  <Money value={sale.revenue} />
                </Td>
                <Td hideBelow="md" align="right" numeric className="font-semibold">
                  <Money value={sale.cost} />
                </Td>
                <Td align="right" numeric className="font-semibold">
                  <Money value={sale.margin} signed />
                  <MarginPercent basisPoints={sale.marginBasisPoints} />
                </Td>
              </Tr>
            </tfoot>
          </Table>
        </TableScroll>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.creditNotes.title}</CardTitle>
            <CardDescription>{t.creditNotes.description}</CardDescription>
          </div>
        </CardHeader>
        {sale.creditNotes.length > 0 ? (
          <TableScroll>
            <Table caption={t.creditNotes.title}>
              <thead>
                <tr>
                  <Th>{t.creditNotes.number}</Th>
                  <Th>{t.creditNotes.date}</Th>
                  <Th hideBelow="md">{t.creditNotes.reasonColumn}</Th>
                  <Th align="right">{t.creditNotes.creditedColumn}</Th>
                  <Th hideBelow="md" align="right">
                    {t.creditNotes.stockBack}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {sale.creditNotes.map((note) => (
                  <Tr key={note.id}>
                    <Td className="font-medium">{note.reference}</Td>
                    <Td>{DATE.day(note.occurredAt)}</Td>
                    <Td hideBelow="md" className="text-ink-secondary">
                      {note.reason ?? '—'}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={note.gross} showCurrency />
                    </Td>
                    <Td hideBelow="md" align="right" numeric>
                      <Money value={note.cost} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        ) : null}
        {formLines.length > 0 && revenueAccounts.length > 0 ? (
          <div className="border-line border-t px-4 py-4 sm:px-5">
            <CreditNoteForm
              saleId={sale.id}
              currency={sale.currency}
              exponent={exponentOf(saleCurrency)}
              lines={formLines}
              accounts={revenueAccounts.map((account) => ({
                id: account.id,
                label: account.code ? `${account.code} — ${account.name}` : account.name,
              }))}
              defaultAccountId={contra?.id ?? revenueAccounts[0]?.id ?? ''}
              suggestedReference={`CN-${sale.reference}${
                sale.creditNotes.length > 0 ? `-${sale.creditNotes.length + 1}` : ''
              }`}
              today={new Date().toISOString().slice(0, 10)}
              locale={locale}
              action={issueCreditNoteAction}
              labels={{
                open: t.creditNotes.open,
                intro: t.creditNotes.intro,
                reference: t.creditNotes.reference,
                date: t.creditNotes.date,
                account: t.creditNotes.account,
                accountHint: t.creditNotes.accountHint,
                reason: t.creditNotes.reason,
                reasonPlaceholder: t.creditNotes.reasonPlaceholder,
                product: t.creditNotes.product,
                canReturn: t.creditNotes.canReturn,
                quantityBack: t.creditNotes.quantityBack,
                credit: t.creditNotes.credit,
                total: t.creditNotes.total,
                taxNote: t.creditNotes.taxNote,
                submit: t.creditNotes.submit,
                working: t.creditNotes.working,
                cancel: t.creditNotes.cancel,
              }}
            />
          </div>
        ) : null}
      </Card>

      <EInvoiceCard
        saleId={sale.id}
        customerAccountId={sale.customerAccountId}
        creditNotes={sale.creditNotes.map((note) => ({ id: note.id, reference: note.reference }))}
      />

      <AttachmentsCard target={{ transactionId: sale.transactionId }} path={`/sales/${sale.id}`} />
    </div>
  );
}

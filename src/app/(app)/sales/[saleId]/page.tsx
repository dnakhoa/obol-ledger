import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { ArrowLeftIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { MarginPercent } from '@/components/margin';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { toQuantityString, unitLabel } from '@/lib/quantity';
import type { SaleSummary } from '@/server/services/sales';

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
  try {
    const { services } = await viewerServices();
    sale = await services.sales.get(saleId);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }
  if (!sale) notFound();

  const foreign = sale.currency !== sale.revenue.currency;

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.sales.gross}</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={sale.gross} showCurrency />
            </p>
            <p className="text-ink-muted text-[11px]">
              {t.sales.net} <Money value={sale.net} /> · {t.sales.tax} <Money value={sale.tax} />
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.sales.revenue}</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={sale.revenue} showCurrency={foreign} />
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.sales.cost}</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={sale.cost} showCurrency={foreign} />
            </p>
          </CardBody>
        </Card>
        <Card className={sale.margin.amount.startsWith('-') ? 'border-negative' : ''}>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.sales.margin}</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={sale.margin} signed showCurrency={foreign} />
              <MarginPercent basisPoints={sale.marginBasisPoints} className="text-sm" />
            </p>
            <p className="text-ink-muted text-[11px]">
              {t.sales.due}:{' '}
              {sale.dueOn ? DATE.day(new Date(`${sale.dueOn}T12:00:00Z`)) : t.sales.onReceipt}
            </p>
          </CardBody>
        </Card>
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
                <Th>{t.sales.shippedFrom}</Th>
                <Th align="right">{t.sales.revenue}</Th>
                <Th align="right">{t.sales.cost}</Th>
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
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {line.drawnFrom.map((draw, index) => (
                          <Badge key={`${line.movementId}-${index}`}>
                            {draw.layerReference ?? t.product.delivery} ·{' '}
                            {quantity(draw.quantityMinor)}
                          </Badge>
                        ))}
                      </span>
                    </Td>
                    <Td align="right" numeric>
                      <Money value={line.revenue} />
                    </Td>
                    <Td align="right" numeric>
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
                <Td colSpan={3} className="font-medium">
                  {t.margins.total}
                </Td>
                <Td align="right" numeric className="font-semibold">
                  <Money value={sale.revenue} />
                </Td>
                <Td align="right" numeric className="font-semibold">
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
    </div>
  );
}

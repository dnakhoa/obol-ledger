import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { ArrowLeftIcon } from '@/components/icons';
import { SellerForm } from '@/components/einvoice-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.einvoice.title };
}
export const dynamic = 'force-dynamic';

/**
 * The company as its invoices name it, and every e-invoice issued.
 *
 * Only for books kept under Vietnam's charts: an e-invoice in this format is
 * a Vietnamese legal document, and offering it elsewhere would be noise.
 */
export default async function EInvoicesPage() {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const day = (value: string) => DATE.day(new Date(`${value}T12:00:00Z`));

  let seller, issued, vietnamese, canWrite;
  try {
    const { services, viewer } = await viewerServices();
    [seller, issued, vietnamese] = await Promise.all([
      services.einvoices.seller(),
      services.einvoices.list(),
      services.statutory.forms().then((forms) => forms !== null),
    ]);
    canWrite = viewer.kind !== 'unenrolled' && viewer.canWrite;
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }
  const year = new Date().toISOString().slice(2, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.einvoice.title}
        description={t.einvoice.description}
        actions={
          <ButtonLink href="/sales">
            <ArrowLeftIcon />
            {t.sales.title}
          </ButtonLink>
        }
      />

      {vietnamese && canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.einvoice.companyTitle}</CardTitle>
            <CardDescription>{t.einvoice.companyHint}</CardDescription>
          </CardHeader>
          <CardBody>
            <SellerForm
              values={{
                legalName: seller.legalName ?? '',
                taxId: seller.taxId ?? '',
                address: seller.address ?? '',
                series: seller.series ?? '',
              }}
              seriesPlaceholder={`C${year}TAA`}
              labels={{
                legalName: t.einvoice.legalName,
                taxId: t.einvoice.taxId,
                address: t.einvoice.address,
                series: t.einvoice.series,
                save: t.einvoice.save,
                working: t.common.working,
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.einvoice.issuedTitle}</CardTitle>
          <CardDescription>{t.einvoice.providerNote}</CardDescription>
        </CardHeader>
        {issued.length === 0 ? (
          <EmptyState title={t.einvoice.none} description={t.einvoice.cardHint} />
        ) : (
          <TableScroll>
            <Table caption={t.einvoice.issuedTitle}>
              <thead>
                <tr>
                  <Th>{t.einvoice.number}</Th>
                  <Th>{t.einvoice.date}</Th>
                  <Th>{t.einvoice.kind}</Th>
                  <Th>{t.einvoice.sale}</Th>
                  <Th align="right">{t.einvoice.total}</Th>
                  <Th align="right">
                    <span className="sr-only">{t.einvoice.download}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {issued.map((invoice) => (
                  <Tr key={invoice.id}>
                    <Td numeric>
                      {invoice.series} · {invoice.printedNumber}
                    </Td>
                    <Td numeric>{day(invoice.issuedOn)}</Td>
                    <Td>
                      <Badge tone={invoice.kind === 'adjustment' ? 'caution' : 'neutral'}>
                        {invoice.kind === 'adjustment'
                          ? t.einvoice.adjustment
                          : t.einvoice.original}
                      </Badge>
                    </Td>
                    <Td>
                      <Link
                        href={`/sales/${invoice.saleId}`}
                        className="hover:text-action underline-offset-4 hover:underline"
                      >
                        {invoice.saleReference}
                      </Link>
                      <span className="text-ink-muted block text-xs">{invoice.buyer}</span>
                    </Td>
                    <Td align="right" numeric>
                      <Money value={invoice.gross} showCurrency />
                    </Td>
                    <Td align="right">
                      <a
                        href={`/einvoices/${invoice.id}`}
                        className="text-ink-secondary hover:text-ink text-xs underline-offset-4 hover:underline"
                      >
                        {t.einvoice.download}
                      </a>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </div>
  );
}

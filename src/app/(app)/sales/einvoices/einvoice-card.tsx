import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/money';
import { IssueAdjustmentButton, IssueEInvoiceForm } from '@/components/einvoice-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';

/**
 * The e-invoice for one sale: issued, or how to issue it; and for each credit
 * note against the sale, its adjustment invoice. Nothing outside Vietnam's
 * charts.
 */
export async function EInvoiceCard({
  saleId,
  customerAccountId,
  creditNotes,
}: {
  saleId: string;
  customerAccountId: string;
  creditNotes: readonly { readonly id: string; readonly reference: string }[];
}) {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const { services, viewer } = await viewerServices();
  const [forms, seller, issued, buyer] = await Promise.all([
    services.statutory.forms(),
    services.einvoices.seller(),
    services.einvoices.forSale(saleId),
    services.einvoices.buyer(customerAccountId),
  ]);
  if (!forms) return null;
  const canWrite = viewer.kind !== 'unenrolled' && viewer.canWrite;
  const ready = Boolean(seller.legalName && seller.taxId && seller.address && seller.series);
  const original = issued.find((invoice) => invoice.kind === 'original');
  const adjusted = new Set(issued.map((invoice) => invoice.creditNoteId));
  const pending = creditNotes.filter((note) => !adjusted.has(note.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.einvoice.cardTitle}</CardTitle>
        <CardDescription>{t.einvoice.cardHint}</CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        {issued.length > 0 ? (
          <ul className="divide-line border-line divide-y rounded-lg border">
            {issued.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
              >
                <Badge tone={invoice.kind === 'adjustment' ? 'caution' : 'neutral'}>
                  {invoice.kind === 'adjustment' ? t.einvoice.adjustment : t.einvoice.original}
                </Badge>
                <span className="numeric text-sm font-medium">
                  {invoice.template}
                  {invoice.series} · {invoice.printedNumber}
                </span>
                <span className="text-ink-muted text-xs">
                  {DATE.day(new Date(`${invoice.issuedOn}T12:00:00Z`))}
                </span>
                <span className="numeric ml-auto text-sm">
                  <Money value={invoice.gross} showCurrency />
                </span>
                <a
                  href={`/einvoices/${invoice.id}`}
                  className="text-ink-secondary hover:text-ink text-xs underline-offset-4 hover:underline"
                >
                  {t.einvoice.download}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {canWrite && !ready ? (
          <p className="text-ink-secondary text-sm">
            {t.einvoice.needsCompany}{' '}
            <Link href="/sales/einvoices" className="underline underline-offset-4">
              {t.einvoice.companyLink}
            </Link>
          </p>
        ) : null}

        {canWrite && ready && !original ? (
          <IssueEInvoiceForm
            saleId={saleId}
            customerAccountId={customerAccountId}
            buyer={{
              legalName: buyer?.legalName ?? buyer?.name ?? '',
              taxId: buyer?.taxId ?? '',
              address: buyer?.address ?? '',
            }}
            labels={{
              buyerName: t.einvoice.buyerName,
              buyerTaxId: t.einvoice.buyerTaxId,
              buyerTaxIdHint: t.einvoice.buyerTaxIdHint,
              buyerAddress: t.einvoice.buyerAddress,
              issue: t.einvoice.issue,
              working: t.common.working,
            }}
          />
        ) : null}

        {canWrite && ready && original && pending.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {pending.map((note) => (
              <IssueAdjustmentButton
                key={note.id}
                saleId={saleId}
                creditNoteId={note.id}
                label={t.einvoice.issueAdjustment(note.reference)}
                working={t.common.working}
              />
            ))}
          </div>
        ) : null}

        {issued.length > 0 ? (
          <p className="text-ink-muted text-xs">{t.einvoice.providerNote}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

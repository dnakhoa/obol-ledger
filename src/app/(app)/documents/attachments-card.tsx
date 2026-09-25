import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Attachments, type AttachmentItem } from '@/components/attachments';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats, type Messages } from '@/lib/i18n';
import type { DocumentKind } from '@/server/domain/document';

/**
 * The documents card, for any page that shows something a document supports.
 *
 * Loads its own list so a page adds it in one line; writing needs a member
 * who can write, and a visitor to the public demo sees the files but no form.
 */
export async function AttachmentsCard({
  target,
  path,
}: {
  target: { readonly transactionId: string } | { readonly shipmentId: string };
  path: string;
}) {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const { services, viewer } = await viewerServices();
  const attached = await services.documents.list(target);

  const items: AttachmentItem[] = attached.map((item) => ({
    id: item.id,
    documentId: item.documentId,
    filename: item.filename,
    kindLabel: kindLabel(item.kind, t),
    size: fileSize(item.sizeBytes, locale),
    note: item.note,
    attachedOn: DATE.day(item.attachedAt),
  }));

  const kinds = (
    [
      'invoice',
      'customs_declaration',
      'bill_of_lading',
      'receipt',
      'delivery_note',
      'contract',
      'other',
    ] as const
  ).map((value) => ({ value, label: kindLabel(value, t) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.documents.title}</CardTitle>
        <CardDescription>{t.documents.hint}</CardDescription>
      </CardHeader>
      <CardBody>
        <Attachments
          items={items}
          target={target}
          path={path}
          canWrite={viewer.kind !== 'unenrolled' && viewer.canWrite}
          labels={{
            none: t.documents.none,
            file: t.documents.file,
            kind: t.documents.kind,
            kinds,
            note: t.documents.note,
            attach: t.documents.attach,
            remove: t.documents.remove,
            download: t.documents.download,
            working: t.common.working,
          }}
        />
      </CardBody>
    </Card>
  );
}

function kindLabel(kind: DocumentKind, t: Messages): string {
  switch (kind) {
    case 'invoice':
      return t.documents.kindInvoice;
    case 'receipt':
      return t.documents.kindReceipt;
    case 'customs_declaration':
      return t.documents.kindCustomsDeclaration;
    case 'bill_of_lading':
      return t.documents.kindBillOfLading;
    case 'delivery_note':
      return t.documents.kindDeliveryNote;
    case 'contract':
      return t.documents.kindContract;
    case 'other':
      return t.documents.kindOther;
  }
}

function fileSize(bytes: number, locale: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${number.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${number.format(bytes / (1024 * 1024))} MB`;
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { DOCUMENT_KINDS } from '@/server/domain/document';
import { describeError, translations } from '@/server/i18n';

export type AttachmentState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const target = z.union([
  z.object({ transactionId: z.string().trim().min(1), shipmentId: z.literal('') }),
  z.object({ transactionId: z.literal(''), shipmentId: z.string().trim().min(1) }),
]);

/**
 * Attaches a file to an entry or a shipment, from the page that shows it.
 *
 * `path` is the page to refresh — the invoice, the entry or the shipment the
 * form sits on — and is only ever used to revalidate, never to redirect.
 */
export async function attachDocumentAction(
  _previous: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const on = target.safeParse({
    transactionId: formData.get('transactionId') ?? '',
    shipmentId: formData.get('shipmentId') ?? '',
  });
  const kind = z.enum(DOCUMENT_KINDS).safeParse(formData.get('kind'));
  const file = formData.get('file');
  if (!on.success || !kind.success) return { status: 'error', message: t.documents.chooseFile };
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: t.documents.chooseFile };
  }
  const note = formData.get('note');

  const result = await writer.services.documents.attach({
    ...(on.data.transactionId
      ? { transactionId: on.data.transactionId }
      : { shipmentId: on.data.shipmentId }),
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    kind: kind.data,
    note: typeof note === 'string' ? note : undefined,
    userId: writer.viewer.userId,
  });

  refresh(formData);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.documents.attached(result.value.filename) };
}

export async function detachDocumentAction(
  _previous: AttachmentState,
  formData: FormData,
): Promise<AttachmentState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const linkId = z.string().trim().min(1).safeParse(formData.get('linkId'));
  if (!linkId.success) return { status: 'error', message: t.documents.chooseFile };

  const result = await writer.services.documents.detach(linkId.data, writer.viewer.userId);
  refresh(formData);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.documents.removed };
}

/** Only the app's own pages: a path from the form that is not one is ignored. */
function refresh(formData: FormData): void {
  const path = String(formData.get('path') ?? '');
  if (/^\/(journal|sales|stock\/shipments)\/[A-Za-z0-9_]+$/u.test(path)) revalidatePath(path);
}

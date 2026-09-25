import { createHash } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import {
  MAX_DOCUMENT_BYTES,
  cleanFilename,
  sniffContentType,
  type DocumentContentType,
  type DocumentKind,
} from '@/server/domain/document';
import type { LedgerError } from '@/server/domain/errors';
import { documentLinks, documents, shipments, transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';

/**
 * The paper behind the entries: supplier invoices, customs declarations,
 * bills of lading.
 *
 * A file is stored once per tenant, named by its SHA-256, and linked to what
 * it supports — an entry, or a shipment. Uploading the same invoice twice
 * links the one document twice rather than storing two copies that could
 * later disagree. The content is never changed; a link attached by mistake
 * is marked removed, so what an entry was once supported by stays on record.
 * See `docs/adr/0024-documents.md`.
 */

export type AttachTarget =
  | { readonly transactionId: string; readonly shipmentId?: undefined }
  | { readonly shipmentId: string; readonly transactionId?: undefined };

export type AttachInput = AttachTarget & {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly kind: DocumentKind;
  readonly note?: string | undefined;
  readonly userId?: string | undefined;
};

export type AttachmentSummary = {
  /** The link: what is removed when the attachment is taken off. */
  readonly id: string;
  readonly documentId: string;
  readonly filename: string;
  readonly contentType: DocumentContentType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly kind: DocumentKind;
  readonly note: string | null;
  readonly transactionId: string | null;
  readonly shipmentId: string | null;
  readonly attachedAt: Date;
};

export type DocumentContent = {
  readonly filename: string;
  readonly contentType: DocumentContentType;
  readonly sha256: string;
  readonly bytes: Uint8Array;
};

export function createDocumentService(database: Database, orgId: string) {
  return {
    /**
     * Attaches a file to an entry or a shipment.
     *
     * Idempotent: the same file attached to the same thing again returns the
     * attachment it already has, so a retried upload does not show twice.
     */
    async attach(input: AttachInput): Promise<Result<AttachmentSummary, LedgerError>> {
      if (input.bytes.length === 0) return err({ code: 'document_empty' });
      if (input.bytes.length > MAX_DOCUMENT_BYTES) {
        return err({
          code: 'document_too_large',
          sizeBytes: input.bytes.length,
          limitBytes: MAX_DOCUMENT_BYTES,
        });
      }
      const contentType = sniffContentType(input.bytes);
      if (!contentType) {
        return err({
          code: 'document_type_not_allowed',
          filename: input.filename.split(/[\\/]/u).pop()?.slice(0, 120) || 'file',
        });
      }
      const sha256 = createHash('sha256').update(input.bytes).digest('hex');

      return withTenant(database, orgId, async (tx) => {
        const target = await vetTarget(tx, input);
        if (!target.ok) return target;

        // One copy per tenant. Taken under the unique index: two uploads of
        // the same file racing each other both land on the one row.
        await tx
          .insert(documents)
          .values({
            id: newId('document'),
            orgId,
            sha256,
            filename: cleanFilename(input.filename, contentType),
            contentType,
            sizeBytes: input.bytes.length,
            content: input.bytes,
            uploadedBy: input.userId ?? null,
          })
          .onConflictDoNothing({ target: [documents.orgId, documents.sha256] });
        const [document] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.sha256, sha256))
          .limit(1);
        if (!document) return err({ code: 'document_not_found', documentId: sha256 });

        const live = and(
          eq(documentLinks.documentId, document.id),
          isNull(documentLinks.removedAt),
          input.transactionId
            ? eq(documentLinks.transactionId, input.transactionId)
            : eq(documentLinks.shipmentId, input.shipmentId ?? ''),
        );
        const [existing] = await tx
          .select({ id: documentLinks.id })
          .from(documentLinks)
          .where(live)
          .limit(1);

        const linkId = existing?.id ?? newId('documentLink');
        if (!existing) {
          await tx.insert(documentLinks).values({
            id: linkId,
            orgId,
            documentId: document.id,
            transactionId: input.transactionId ?? null,
            shipmentId: input.shipmentId ?? null,
            kind: input.kind,
            note: input.note?.trim() ? input.note.trim().slice(0, 280) : null,
            linkedBy: input.userId ?? null,
          });
        }

        const summary = await describe(tx, linkId);
        return summary ? ok(summary) : err({ code: 'document_link_not_found', linkId });
      });
    },

    /** What an entry or a shipment is supported by, in the order it was attached. */
    async list(target: AttachTarget): Promise<readonly AttachmentSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({ id: documentLinks.id })
          .from(documentLinks)
          .where(
            and(
              isNull(documentLinks.removedAt),
              target.transactionId
                ? eq(documentLinks.transactionId, target.transactionId)
                : eq(documentLinks.shipmentId, target.shipmentId ?? ''),
            ),
          )
          .orderBy(asc(documentLinks.createdAt), asc(documentLinks.id));
        const out: AttachmentSummary[] = [];
        for (const row of rows) {
          const summary = await describe(tx, row.id);
          if (summary) out.push(summary);
        }
        return out;
      });
    },

    async attachment(linkId: string): Promise<AttachmentSummary | null> {
      return withTenant(database, orgId, (tx) => describe(tx, linkId));
    },

    /** The file itself. Row-level security decides whose it is. */
    async content(documentId: string): Promise<DocumentContent | null> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .select({
            filename: documents.filename,
            contentType: documents.contentType,
            sha256: documents.sha256,
            content: documents.content,
          })
          .from(documents)
          .where(eq(documents.id, documentId))
          .limit(1);
        return row
          ? {
              filename: row.filename,
              contentType: row.contentType,
              sha256: row.sha256,
              bytes: row.content,
            }
          : null;
      });
    },

    /** Takes an attachment off. The document and the record that it was attached stay. */
    async detach(linkId: string, userId?: string): Promise<Result<AttachmentSummary, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const summary = await describe(tx, linkId);
        if (!summary) return err({ code: 'document_link_not_found', linkId });
        const updated = await tx
          .update(documentLinks)
          .set({ removedAt: new Date(), removedBy: userId ?? null })
          .where(and(eq(documentLinks.id, linkId), isNull(documentLinks.removedAt)))
          .returning({ id: documentLinks.id });
        return updated.length === 1
          ? ok(summary)
          : err({ code: 'document_link_not_found', linkId });
      });
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;

async function vetTarget(
  tx: Transactional,
  target: AttachTarget,
): Promise<Result<true, LedgerError>> {
  if (target.transactionId) {
    const [row] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, target.transactionId))
      .limit(1);
    return row ? ok(true) : err({ code: 'entry_not_found', transactionId: target.transactionId });
  }
  const shipmentId = target.shipmentId ?? '';
  const [row] = await tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  return row ? ok(true) : err({ code: 'shipment_not_found', shipmentId });
}

/** A live attachment, without its bytes. */
async function describe(tx: Transactional, linkId: string): Promise<AttachmentSummary | null> {
  const [row] = await tx
    .select({
      id: documentLinks.id,
      documentId: documents.id,
      filename: documents.filename,
      contentType: documents.contentType,
      sizeBytes: documents.sizeBytes,
      sha256: documents.sha256,
      kind: documentLinks.kind,
      note: documentLinks.note,
      transactionId: documentLinks.transactionId,
      shipmentId: documentLinks.shipmentId,
      attachedAt: documentLinks.createdAt,
    })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.documentId))
    .where(and(eq(documentLinks.id, linkId), isNull(documentLinks.removedAt)))
    .limit(1);
  return row ?? null;
}

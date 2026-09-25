import { defineRoute, json } from '@/server/http/route';
import { problem, problemFor, problemResponse } from '@/server/http/problem';
import { DOCUMENT_KINDS, MAX_DOCUMENT_BYTES, type DocumentKind } from '@/server/domain/document';

type Params = { entryId: string };

/** What an entry is supported by: supplier invoices, customs declarations, receipts. */
export const GET = defineRoute<Params>(
  { name: 'entries.documents.list' },
  async ({ params, requestId, services }) => {
    const entry = await services.journal.byId(params.entryId);
    if (!entry) {
      return problemResponse(
        problemFor({ code: 'entry_not_found', transactionId: params.entryId }, requestId),
      );
    }
    const attached = await services.documents.list({ transactionId: entry.id });
    return json({ data: attached });
  },
);

/**
 * Attaches a file, sent as `multipart/form-data` with `file`, `kind` and an
 * optional `note`.
 *
 * The type is decided from the file's content: a PDF, a PNG, JPEG or WebP
 * photo, or a plain XML e-invoice, and nothing else. The same file attached
 * twice to one entry is the one attachment, so a retried upload is safe
 * without an idempotency key.
 */
export const POST = defineRoute<Params>(
  { name: 'entries.documents.create', auth: true },
  async ({ params, request, requestId, services }) => {
    // Refused before the body is read: a declared size over the limit is not
    // worth buffering to find out.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) {
      return problemResponse(
        problemFor(
          { code: 'document_too_large', sizeBytes: declared, limitBytes: MAX_DOCUMENT_BYTES },
          requestId,
        ),
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return problemResponse({
        ...problem(
          400,
          'malformed-upload',
          'Upload could not be read',
          'Send the file as multipart/form-data, in a field named "file".',
        ),
        requestId,
      });
    }

    const file = form.get('file');
    const kind = String(form.get('kind') ?? 'other');
    if (!(file instanceof File) || !(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      return problemResponse({
        ...problem(
          422,
          'unprocessable-upload',
          'Upload is missing a file or a kind',
          `Include a file in "file", and "kind" as one of ${DOCUMENT_KINDS.join(', ')}.`,
          { field: file instanceof File ? 'kind' : 'file' },
        ),
        requestId,
      });
    }
    const note = form.get('note');

    const attached = await services.documents.attach({
      transactionId: params.entryId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      kind: kind as DocumentKind,
      note: typeof note === 'string' ? note : undefined,
    });
    if (!attached.ok) return problemResponse(problemFor(attached.error, requestId));
    return json(
      { data: attached.value },
      {
        status: 201,
        headers: { location: `/api/v1/documents/${attached.value.documentId}/content` },
      },
    );
  },
);

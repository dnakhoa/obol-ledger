import { defineRoute } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { einvoiceId: string };

/** The e-invoice document, byte for byte as issued — what a provider signs. */
export const GET = defineRoute<Params>(
  { name: 'einvoices.xml' },
  async ({ params, requestId, services }) => {
    const document = await services.einvoices.document(params.einvoiceId);
    if (!document) {
      return problemResponse(
        problemFor({ code: 'einvoice_not_found', einvoiceId: params.einvoiceId }, requestId),
      );
    }
    return new Response(document.xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'content-disposition': `attachment; filename="${document.filename}"`,
        'x-content-type-options': 'nosniff',
        etag: `"${document.sha256}"`,
      },
    });
  },
);

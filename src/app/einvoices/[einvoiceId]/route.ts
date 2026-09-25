import { viewerServices } from '@/server/container';

type Params = { einvoiceId: string };

/**
 * An e-invoice's XML, for the person whose books it belongs to — to keep,
 * or to upload to the provider that signs it.
 *
 * Always a download: shown in a browser, an XML document is one it will
 * render, and there is nothing to gain from rendering this one.
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  const { einvoiceId } = await context.params;
  const { services } = await viewerServices();
  const document = await services.einvoices.document(einvoiceId);
  if (!document) return new Response('Not found', { status: 404 });
  return new Response(document.xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename="${document.filename}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, max-age=0, must-revalidate',
      etag: `"${document.sha256}"`,
    },
  });
}

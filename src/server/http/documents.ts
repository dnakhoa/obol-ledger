import { displayInline, type DocumentContentType } from '@/server/domain/document';
import type { DocumentContent } from '@/server/services/documents';

/**
 * A stored document, sent back to a browser without letting it become a page.
 *
 * The type is the one decided from the bytes when the file was stored, and
 * `nosniff` stops the browser guessing another. PDFs and photos are shown;
 * XML is always saved, because shown it is a document a browser will run.
 * Anything rendered is sandboxed, so even a file that slipped past the check
 * could not run script on this origin or read its cookies. Nothing is cached
 * by a shared cache: it is somebody's paperwork.
 */
export function documentResponse(content: DocumentContent, request: Request): Response {
  const asked = new URL(request.url).searchParams.get('download') === '1';
  const inline = !asked && displayInline(content.contentType);
  const body = new Uint8Array(content.bytes).buffer;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': content.contentType,
      'content-length': String(content.bytes.byteLength),
      'content-disposition': disposition(inline, content.filename),
      'x-content-type-options': 'nosniff',
      'content-security-policy': policyFor(content.contentType),
      'cache-control': 'private, max-age=0, must-revalidate',
      etag: `"${content.sha256}"`,
    },
  });
}

/**
 * `filename*` carries the name in UTF-8 — "Tờ khai hải quan.pdf" arrives as
 * itself — and the ASCII `filename` beside it is for the clients that ignore
 * the other one.
 */
function disposition(inline: boolean, filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/gu, '')
    .replace(/["\\]/gu, '');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii || 'document'}"; filename*=UTF-8''${encoded}`;
}

function policyFor(type: DocumentContentType): string {
  // Chrome will not open its PDF viewer inside a sandboxed document, so a PDF
  // gets the strictest policy that still lets it be read.
  return type === 'application/pdf'
    ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
    : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";
}

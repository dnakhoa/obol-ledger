/**
 * A request body, read no further than `limit` bytes.
 *
 * Checking `Content-Length` first is worth doing and not enough: a chunked
 * request declares no length at all, and `request.json()`, `text()` and
 * `formData()` will buffer whatever arrives. On Vercel the platform caps a
 * body at 4.5 MB; anywhere else nothing would. So the bytes are counted as
 * they come, and reading stops at the first one over.
 */
export async function readBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | 'too_large'> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return 'too_large';

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** A JSON body is a few kilobytes; a megabyte is room for any honest one. */
export const MAX_JSON_BYTES = 1024 * 1024;

import { attachment, csvRow, UTF8_BOM } from '@/lib/csv';

/**
 * Streamed CSV.
 *
 * An export that builds the whole file in memory works until the day someone
 * with a real ledger uses it, and then it fails as an out-of-memory crash
 * rather than as a slow download. Paging into a `ReadableStream` keeps the
 * working set at one page no matter how large the export is, and the browser
 * starts saving bytes immediately instead of waiting for the last row.
 *
 * `Content-Length` is deliberately absent: it cannot be known without
 * materialising the file, which is the thing being avoided. Chunked transfer
 * is the correct answer, and a progress bar of unknown length is a fair price.
 */

/** A hard stop, so one request cannot read a tenant's entire history. */
const MAX_ROWS = 50_000;

export type CsvPage<T> = {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
};

export function streamCsv<T>(options: {
  filename: string;
  header: readonly string[];
  /** Fetches one page. Called until it returns no cursor, or the cap is hit. */
  page: (cursor: string | undefined) => Promise<CsvPage<T>>;
  /** One row per item; return several for an item that spans lines. */
  rows: (item: T) => readonly (readonly (string | number | null | undefined)[])[];
}): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${UTF8_BOM}${csvRow(options.header)}\r\n`));

      let cursor: string | undefined;
      let written = 0;

      try {
        do {
          const page = await options.page(cursor);
          for (const item of page.items) {
            for (const row of options.rows(item)) {
              controller.enqueue(encoder.encode(`${csvRow(row)}\r\n`));
              written += 1;
            }
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor && written < MAX_ROWS);
      } catch (error) {
        // The status line is long gone, so a failure cannot become a 500.
        // Erroring the stream truncates the download, which at least tells the
        // client something went wrong rather than handing them a short file
        // that looks complete.
        controller.error(error);
        return;
      }

      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': attachment(options.filename),
      'cache-control': 'no-store',
    },
  });
}

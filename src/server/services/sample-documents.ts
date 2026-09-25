/**
 * Paperwork for the sample company, generated rather than shipped as files.
 *
 * A prospect opening the Carrara container should find the commercial
 * invoice and the customs declaration attached to it, the way their own
 * would be. These are one-page PDFs built by hand — a few hundred bytes each,
 * standard fonts, no dependency — marked as samples on the page itself so
 * nobody mistakes one for a real document.
 */

export type SamplePage = {
  readonly title: string;
  readonly lines: readonly string[];
};

/**
 * A single-page PDF of plain text.
 *
 * The standard fonts carry no Vietnamese, so text is reduced to ASCII —
 * "Cảng Cát Lái" prints as "Cang Cat Lai" — which is what a scan of a
 * foreign supplier's invoice looks like anyway. Offsets in the cross-reference
 * table are computed from the bytes, so the file opens in any reader.
 */
export function samplePdf(page: SamplePage): Uint8Array {
  const content = [
    'BT /F2 16 Tf 56 780 Td',
    `(${pdfText(page.title)}) Tj ET`,
    'BT /F1 8 Tf 56 764 Td (SAMPLE DOCUMENT - generated for the Obol demo ledger) Tj ET',
    'BT /F1 10 Tf 56 736 Td 15 TL',
    ...page.lines.map((line, index) => `${index === 0 ? '' : 'T* '}(${pdfText(line)}) Tj`),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is ASCII by construction, so string length is byte length.
  return new TextEncoder().encode(body);
}

function pdfText(value: string): string {
  return value
    .replace(/[đĐ]/gu, (c) => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/gu, '')
    .replace(/[\\()]/gu, (c) => `\\${c}`);
}

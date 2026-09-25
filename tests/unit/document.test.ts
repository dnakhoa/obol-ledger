import { describe, expect, it } from 'vitest';
import { cleanFilename, displayInline, sniffContentType } from '@/server/domain/document';
import { samplePdf } from '@/server/services/sample-documents';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffContentType', () => {
  it('recognises the five formats by their first bytes', () => {
    expect(sniffContentType(text('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffContentType(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffContentType(text('<?xml version="1.0"?><HDon/>'))).toBe('application/xml');
  });

  it('refuses what a browser would run, whatever it is called', () => {
    expect(sniffContentType(text('<!doctype html><script>'))).toBeNull();
    expect(sniffContentType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffContentType(text('<?xml version="1.0"?><x:html xmlns:x="a"/>'))).toBeNull();
    expect(sniffContentType(text('<?xml version="1.0"?><!DOCTYPE HDon><HDon/>'))).toBeNull();
    expect(sniffContentType(text('GIF89a'))).toBeNull();
    // Not valid UTF-8: not an XML document this ledger will hold.
    expect(sniffContentType(bytes(0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0xff, 0xfe))).toBeNull();
  });

  it('is not fooled by where the dangerous part is put', () => {
    // A tag inside a comment is not the root.
    expect(sniffContentType(text('<?xml version="1.0"?><!-- <a> --><svg/>'))).toBeNull();
    // An XHTML script below an innocent root.
    expect(
      sniffContentType(
        text(
          '<?xml version="1.0"?><HDon><h:script xmlns:h="http://www.w3.org/1999/xhtml">x</h:script></HDon>',
        ),
      ),
    ).toBeNull();
    // A DOCTYPE after a long comment, past where a prefix check stops.
    expect(
      sniffContentType(text(`<?xml version="1.0"?><!--${'x'.repeat(5000)}--><!DOCTYPE a><a/>`)),
    ).toBeNull();
    // The namespace spelled with a character reference, which a parser decodes.
    expect(
      sniffContentType(
        text('<?xml version="1.0"?><HDon xmlns:h="http://www.w3.org/1999/xh&#116;ml"/>'),
      ),
    ).toBeNull();
    // A namespace that merely mentions the address is not the namespace.
    expect(
      sniffContentType(
        text('<?xml version="1.0"?><HDon><Note>see www.w3.org/2000/svg</Note></HDon>'),
      ),
    ).toBe('application/xml');
    // A comment nested so that stripping the inner one leaves a new opener.
    expect(sniffContentType(text('<?xml version="1.0"?><!<!---->-- <a> --><svg/>'))).toBeNull();
    // A stylesheet, which a browser applies to turn XML into a page.
    expect(
      sniffContentType(text('<?xml version="1.0"?><?xml-stylesheet href="x.xsl"?><HDon/>')),
    ).toBeNull();
  });
});

describe('cleanFilename', () => {
  it('keeps the name the accountant will look for, and nothing that could be a path', () => {
    expect(cleanFilename('C:\\scans\\Tờ khai hải quan 2207.PDF', 'application/pdf')).toBe(
      'Tờ khai hải quan 2207.pdf',
    );
    expect(cleanFilename('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(cleanFilename('請求書"<x>".pdf', 'application/pdf')).toBe('請求書x.pdf');
    expect(cleanFilename('...', 'image/png')).toBe('document.png');
  });

  it('gives the file the extension of what it really is', () => {
    expect(cleanFilename('invoice.pdf', 'image/jpeg')).toBe('invoice.jpg');
    expect(cleanFilename('hoadon', 'application/xml')).toBe('hoadon.xml');
  });
});

describe('displayInline', () => {
  it('saves XML rather than showing it', () => {
    expect(displayInline('application/xml')).toBe(false);
    expect(displayInline('application/pdf')).toBe(true);
  });
});

describe('samplePdf', () => {
  it('writes a PDF whose cross-reference table points at its objects', () => {
    const bytes = samplePdf({ title: 'Tờ khai (sample)', lines: ['Cảng Cát Lái', 'a \\ b'] });
    const body = new TextDecoder().decode(bytes);
    expect(sniffContentType(bytes)).toBe('application/pdf');
    expect(body).toContain('(To khai \\(sample\\)) Tj');
    expect(body).toContain('(Cang Cat Lai) Tj');

    const startxref = Number(/startxref\n(\d+)/u.exec(body)?.[1]);
    expect(body.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...body.matchAll(/^(\d{10}) 00000 n $/gmu)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => {
      expect(body.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });
});

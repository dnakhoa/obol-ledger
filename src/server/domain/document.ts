/** The content types a document may have — decided from its bytes, never from the browser. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/xml',
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

export const DOCUMENT_KINDS = [
  'invoice',
  'receipt',
  'customs_declaration',
  'bill_of_lading',
  'delivery_note',
  'contract',
  'other',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * What a file is, decided from its bytes.
 *
 * The browser's claim is not evidence: a page renamed `invoice.pdf` is still
 * a page, and a ledger that serves it back as whatever it was told turns its
 * document store into a way to run script on its own origin. So the type is
 * read from the first bytes, and anything that is not one of five plain
 * formats is refused — including SVG, which is an image that can carry
 * script, and HTML however it is labelled.
 */

/** 4 MiB: comfortably a scanned invoice, and under the 4.5 MB a serverless request body allows. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((byte, index) => bytes[at + index] === byte);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
}

export function sniffContentType(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return isPlainXml(bytes) ? 'application/xml' : null;
}

/**
 * An XML document of the kind an e-invoice is, and nothing that renders.
 *
 * It must open with an XML declaration, carry no DOCTYPE — which is how
 * entity expansion and external entities get in, and which no e-invoice
 * schema uses — and its root must not be an SVG or XHTML document, the two
 * XML vocabularies a browser will execute.
 */
function isPlainXml(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 4096));
  } catch {
    return false;
  }
  text = text.replace(/^﻿/u, '').trimStart();
  if (!text.startsWith('<?xml')) return false;
  if (/<!DOCTYPE/iu.test(text)) return false;

  const root = /<(?![?!])([A-Za-z_][\w.:-]*)/u.exec(text)?.[1];
  if (!root) return false;
  const local = (root.split(':').pop() ?? '').toLowerCase();
  return local !== 'svg' && local !== 'html' && local !== 'xhtml';
}

const EXTENSION: Record<DocumentContentType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/xml': 'xml',
};

/**
 * The name a file keeps: what the person called it, less anything that could
 * be a path or a control character, and with an extension that agrees with
 * what it actually is.
 *
 * Vietnamese and Japanese names are kept as they are — "Tờ khai hải quan
 * 2207.pdf" is the name the accountant will look for.
 */
export function cleanFilename(name: string, type: DocumentContentType): string {
  const base = (name.split(/[\\/]/u).pop() ?? '')
    .normalize('NFC')
    // Controls, and the characters that mean something in a header or a shell.
    .replace(/[\p{Cc}\p{Cf}"<>|:*?]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '');
  const extension = EXTENSION[type];
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/u, '').slice(0, 180) || 'document';
  return `${stem}.${extension}`;
}

/** Whether a browser should show it or save it. XML is saved: shown, it can run. */
export function displayInline(type: DocumentContentType): boolean {
  return type !== 'application/xml';
}

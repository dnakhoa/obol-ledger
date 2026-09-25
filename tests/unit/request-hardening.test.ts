import { describe, expect, it } from 'vitest';
import { clientAddress } from '@/server/http/client-address';
import { isInternalPath } from '@/lib/internal-path';
import { contentSecurityPolicy } from '@/lib/csp';
import { readBody } from '@/server/http/body';

describe('clientAddress', () => {
  it('counts the address the nearest proxy wrote, not the one the client claimed', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    expect(clientAddress(headers)).toBe('203.0.113.9');
  });

  it('reads a single address, and falls back when there is none', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientAddress(new Headers())).toBe('unknown');
  });
});

describe('isInternalPath', () => {
  it.each(['/', '/journal', '/journal?search=a', '/sales/sale_1'])('accepts %j', (path) => {
    expect(isInternalPath(path)).toBe(true);
  });

  it.each([
    '//evil.test',
    '/\\evil.test',
    '/\t/evil.test',
    '/\n/evil.test',
    'https://evil.test',
    '',
  ])('refuses %j', (path) => {
    expect(isInternalPath(path)).toBe(false);
  });
});

describe('contentSecurityPolicy', () => {
  it('runs only scripts carrying the nonce, and frames nothing', () => {
    const policy = contentSecurityPolicy('abc');
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('allows eval only in development', () => {
    expect(contentSecurityPolicy('abc', true)).toContain("'unsafe-eval'");
  });
});

describe('readBody', () => {
  const chunked = (size: number) =>
    new Request('https://ledger.test/', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          for (let sent = 0; sent < size; sent += 1024) controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
      }),
      // @ts-expect-error -- required by undici for a streamed body
      duplex: 'half',
    });

  it('stops at the limit when no length was declared', async () => {
    expect(await readBody(chunked(64 * 1024), 16 * 1024)).toBe('too_large');
  });

  it('refuses a declared length over the limit without reading', async () => {
    const request = new Request('https://ledger.test/', {
      method: 'POST',
      body: 'x'.repeat(10),
      headers: { 'content-length': '999999' },
    });
    expect(await readBody(request, 1024)).toBe('too_large');
  });

  it('returns a body within the limit whole', async () => {
    const body = await readBody(chunked(4096), 16 * 1024);
    expect(body).toBeInstanceOf(Uint8Array);
    expect((body as Uint8Array).byteLength).toBe(4096);
  });
});

import { describe, expect, it } from 'vitest';
import { generateSecret, signedHeaders, verify } from '@/server/services/webhook-signature';

/**
 * A signature scheme nobody has verified independently has been exercised, not
 * tested. These run the receiving half against the sending half and, more
 * usefully, against a series of forgeries.
 */
describe('webhook signatures', () => {
  const secret = generateSecret();
  const payload = JSON.stringify({ id: 'evt_1', type: 'entry.posted' });
  const now = 1_700_000_000;

  function sign(overrides: { payload?: string; timestamp?: number; secret?: string } = {}) {
    return signedHeaders({
      secret: overrides.secret ?? secret,
      id: 'evt_1',
      payload: overrides.payload ?? payload,
      timestamp: overrides.timestamp ?? now,
    });
  }

  it('verifies what it signed', () => {
    expect(verify({ secret, headers: sign(), payload, now })).toEqual({ valid: true });
  });

  it('rejects a body edited in flight', () => {
    const headers = sign();
    const tampered = JSON.stringify({ id: 'evt_1', type: 'entry.reversed' });
    expect(verify({ secret, headers, payload: tampered, now })).toMatchObject({ valid: false });
  });

  it('rejects a signature made with a different secret', () => {
    const headers = sign({ secret: generateSecret() });
    expect(verify({ secret, headers, payload, now })).toMatchObject({ valid: false });
  });

  it('rejects a replay of a delivery from an hour ago', () => {
    // The whole point of signing the timestamp: an attacker who captured a
    // valid delivery cannot resend it later, because editing the timestamp
    // invalidates the signature and keeping it puts the request outside the
    // tolerance window.
    const headers = sign({ timestamp: now - 3600 });
    expect(verify({ secret, headers, payload, now })).toMatchObject({
      valid: false,
      reason: 'timestamp outside tolerance',
    });
  });

  it('rejects a timestamp edited to look fresh', () => {
    const headers = { ...sign({ timestamp: now - 3600 }), 'webhook-timestamp': String(now) };
    expect(verify({ secret, headers, payload, now })).toMatchObject({
      valid: false,
      reason: 'no matching signature',
    });
  });

  it('rejects a delivery with no signature at all', () => {
    expect(verify({ secret, headers: {}, payload, now })).toMatchObject({ valid: false });
  });

  it('accepts either key while a secret is being rotated', () => {
    // Two v1 signatures in one space-delimited header is how the spec supports
    // rotation without a flag day.
    const next = generateSecret();
    const combined = {
      ...sign(),
      'webhook-signature': `${sign()['webhook-signature']} ${signedHeaders({ secret: next, id: 'evt_1', payload, timestamp: now })['webhook-signature']}`,
    };
    expect(verify({ secret, headers: combined, payload, now })).toEqual({ valid: true });
    expect(verify({ secret: next, headers: combined, payload, now })).toEqual({ valid: true });
  });
});

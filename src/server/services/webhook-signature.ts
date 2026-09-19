import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signing and verification, to the Standard Webhooks specification.
 *
 * Implementing an existing spec rather than inventing a scheme is the whole
 * decision here. Subscribers already have libraries for this one; a bespoke
 * header format means every integrator writes their own verifier, and a
 * verifier written in a hurry is how signatures end up compared with `===`.
 *
 * Three properties the naive version misses:
 *
 *  - **The timestamp is signed, not just sent.** Signing the body alone lets
 *    an attacker who captured one delivery replay it forever. The timestamp
 *    is inside the signed content, so it cannot be edited, and the verifier
 *    rejects anything outside a tolerance window.
 *  - **The id is signed too**, which binds the signature to one delivery and
 *    gives the receiver its deduplication key in the same breath.
 *  - **Comparison is constant-time.** A byte-by-byte `===` leaks, through
 *    timing, how much of a forged signature was correct — which turns forgery
 *    from 2^256 guesses into a few thousand.
 */

const PREFIX = 'whsec_';
const VERSION = 'v1';

/** How far a delivery's timestamp may be from the verifier's clock. */
export const TOLERANCE_SECONDS = 5 * 60;

export type SignedHeaders = {
  readonly 'webhook-id': string;
  readonly 'webhook-timestamp': string;
  readonly 'webhook-signature': string;
};

export function generateSecret(): string {
  return `${PREFIX}${randomBytes(24).toString('base64')}`;
}

function keyOf(secret: string): Buffer {
  // The prefix is a human affordance — it makes a leaked secret identifiable
  // in a log or a paste — and is not part of the key material.
  const raw = secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret;
  return Buffer.from(raw, 'base64');
}

function sign(secret: string, id: string, timestamp: number, payload: string): string {
  return createHmac('sha256', keyOf(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
}

export function signedHeaders(input: {
  secret: string;
  id: string;
  payload: string;
  timestamp?: number;
}): SignedHeaders {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    'webhook-id': input.id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `${VERSION},${sign(input.secret, input.id, timestamp, input.payload)}`,
  };
}

export type VerificationResult =
  { readonly valid: true } | { readonly valid: false; readonly reason: string };

/**
 * The receiving half, shipped so integrators do not have to write it.
 *
 * Exported mainly because it is what the test suite verifies against: a
 * signature scheme nobody has independently verified is a scheme that has not
 * been tested, only exercised.
 */
export function verify(input: {
  secret: string;
  headers: Headers | Record<string, string>;
  payload: string;
  now?: number;
}): VerificationResult {
  const get = (name: string): string | undefined =>
    input.headers instanceof Headers ? (input.headers.get(name) ?? undefined) : input.headers[name];

  const id = get('webhook-id');
  const rawTimestamp = get('webhook-timestamp');
  const header = get('webhook-signature');
  if (!id || !rawTimestamp || !header) return { valid: false, reason: 'missing signature headers' };

  const timestamp = Number(rawTimestamp);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'malformed timestamp' };

  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) {
    return { valid: false, reason: 'timestamp outside tolerance' };
  }

  const expected = Buffer.from(sign(input.secret, id, timestamp, input.payload));

  // Space-delimited, because the spec allows several signatures in one header
  // so a secret can be rotated without a flag day: the sender signs with both
  // the old and the new key for a window, and either verifies.
  for (const candidate of header.split(' ')) {
    const [version, signature] = candidate.split(',');
    if (version !== VERSION || !signature) continue;
    const actual = Buffer.from(signature);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return { valid: true };
    }
  }

  return { valid: false, reason: 'no matching signature' };
}

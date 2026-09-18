import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys in sorted order, all the way down.
 *
 * Two requests that differ only in key order are the same request, so they must
 * hash the same. Without this, a client that serialises `{a,b}` on the first
 * attempt and `{b,a}` on the retry would be told its idempotency key had been
 * reused with a different body — a confusing failure for a correct client.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);

  return `{${entries.join(',')}}`;
}

/** Stable fingerprint of a request body, used to detect idempotency-key misuse. */
export function fingerprintOf(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

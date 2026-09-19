import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Server-side request forgery is the risk this file exists for.
 *
 * A webhook endpoint is a URL chosen by the caller which this server then
 * fetches, with credentials of a sort (its own network position) and from
 * inside the trust boundary. Left unchecked, that is a general-purpose proxy:
 * point an endpoint at `http://169.254.169.254/latest/meta-data/` and the
 * delivery log helpfully returns the cloud instance's credentials.
 *
 * Two checks, because either alone is bypassable:
 *
 *  - The literal host is rejected if it is a private, loopback, link-local or
 *    otherwise reserved address.
 *  - The hostname is *resolved* and the resulting address checked, because
 *    `evil.example.com` is free to have an A record of `127.0.0.1`.
 *
 * A determined attacker can still win the race between this resolution and
 * the one `fetch` performs (DNS rebinding). Closing that properly means
 * pinning the resolved address into the connection, which Node's fetch does
 * not expose; the honest mitigation at this layer is to narrow the window and
 * to run deliveries somewhere with no interesting network neighbours.
 */

const BLOCKED_V4 = [
  /^0\./, // "this network"
  /^10\./, // RFC 1918
  /^127\./, // loopback
  /^169\.254\./, // link-local, and the cloud metadata endpoint
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918
  /^192\.168\./, // RFC 1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^(22[4-9]|2[3-5]\d)\./, // multicast and reserved
];

function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return BLOCKED_V4.some((pattern) => pattern.test(address));
  if (version !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized)) return true;
  // IPv4-mapped: ::ffff:127.0.0.1 is still loopback.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  return mapped?.[1] ? isBlockedAddress(mapped[1]) : false;
}

export type TargetCheck = { readonly allowed: true } | { readonly allowed: false; reason: string };

export async function checkTarget(
  rawUrl: string,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<TargetCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'malformed url' };
  }

  // Enforced by a CHECK constraint too; repeated here because a delivery must
  // never depend on the schema being the only thing that noticed.
  if (url.protocol !== 'https:') return { allowed: false, reason: 'only https is delivered to' };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { allowed: false, reason: 'address is in a reserved range' }
      : { allowed: true };
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { allowed: false, reason: 'hostname does not resolve' };
  }

  if (addresses.length === 0) return { allowed: false, reason: 'hostname does not resolve' };
  // Every address, not just the first: a host that resolves to one public and
  // one loopback address is a bypass, not a coincidence.
  if (addresses.some(isBlockedAddress)) {
    return { allowed: false, reason: 'hostname resolves into a reserved range' };
  }

  return { allowed: true };
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

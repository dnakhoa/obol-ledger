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
  /^192\.0\.[02]\./, // IETF protocol assignments; documentation
  /^198\.1[89]\./, // benchmarking
  /^198\.51\.100\./, // documentation
  /^203\.0\.113\./, // documentation
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^(22[4-9]|2[3-5]\d)\./, // multicast and reserved
];

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return BLOCKED_V4.some((pattern) => pattern.test(address));
  if (version !== 6) return true;

  const bytes = ipv6Bytes(address);
  if (!bytes) return true;

  // An IPv4 address wearing IPv6 clothes is judged as the IPv4 address it
  // reaches. `URL` rewrites [::ffff:127.0.0.1] to ::ffff:7f00:1, so matching
  // the dotted spelling alone let loopback through.
  const embedded = embeddedV4(bytes);
  if (embedded) return isBlockedAddress(embedded);

  // Otherwise only global unicast (2000::/3) is a place a subscriber lives,
  // less the parts of it that are tunnels or documentation: 2001::/23
  // (Teredo and protocol assignments), 2001:db8::/32, and 6to4's 2002::/16.
  const first = (bytes[0] ?? 0) * 256 + (bytes[1] ?? 0);
  const second = (bytes[2] ?? 0) * 256 + (bytes[3] ?? 0);
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2001 && second < 0x0200) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  return first === 0x2002;
}

/** Sixteen bytes, or null for anything `isIP` accepted that this cannot read. */
function ipv6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/u, '');
  // A dotted tail (::ffff:1.2.3.4) becomes two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!/^[0-9a-f]{1,4}$/u.test(group) || Number.isNaN(value)) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

/**
 * The IPv4 address inside an IPv4-mapped (::ffff:0:0/96), IPv4-compatible
 * (::/96) or NAT64 (64:ff9b::/96) address, or null for a native one.
 */
function embeddedV4(bytes: number[]): string | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  const tail = bytes.slice(12).join('.');
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return tail;
  if (zeros(0, 12)) return tail;
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return tail;
  }
  return null;
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

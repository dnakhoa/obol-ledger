import { describe, expect, it } from 'vitest';
import { checkTarget, isBlockedAddress } from '@/server/services/webhook-target';

/**
 * These are the SSRF cases. A webhook target is a URL a caller chooses and
 * this server then fetches from inside the trust boundary, which — unguarded —
 * is a general-purpose proxy into the private network.
 */
describe('delivery targets', () => {
  const resolvesTo =
    (...addresses: string[]) =>
    async () =>
      addresses;

  it('allows an ordinary public https endpoint', async () => {
    await expect(
      checkTarget('https://hooks.example.com/ledger', resolvesTo('93.184.216.34')),
    ).resolves.toEqual({ allowed: true });
  });

  it('refuses plaintext http', async () => {
    await expect(
      checkTarget('http://hooks.example.com', resolvesTo('93.184.216.34')),
    ).resolves.toMatchObject({ allowed: false });
  });

  it.each([
    ['https://127.0.0.1/hook', 'loopback'],
    ['https://10.1.2.3/hook', 'RFC 1918'],
    ['https://192.168.0.5/hook', 'RFC 1918'],
    ['https://172.16.4.4/hook', 'RFC 1918'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://[::1]/hook', 'IPv6 loopback'],
    ['https://[fd00::1]/hook', 'IPv6 unique-local'],
  ])('refuses a literal address in a reserved range: %s (%s)', async (url) => {
    await expect(checkTarget(url, resolvesTo())).resolves.toMatchObject({ allowed: false });
  });

  it('refuses a public hostname that resolves to loopback', async () => {
    // The bypass a literal-address check alone misses: nothing stops
    // evil.example.com from having an A record of 127.0.0.1.
    await expect(
      checkTarget('https://evil.example.com/hook', resolvesTo('127.0.0.1')),
    ).resolves.toMatchObject({ allowed: false, reason: 'hostname resolves into a reserved range' });
  });

  it('refuses a hostname with one public and one private address', async () => {
    // Checking only the first record would let this through half the time.
    await expect(
      checkTarget('https://split.example.com/hook', resolvesTo('93.184.216.34', '10.0.0.1')),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('refuses an IPv4-mapped IPv6 loopback', async () => {
    await expect(
      checkTarget('https://sneaky.example.com/hook', resolvesTo('::ffff:127.0.0.1')),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('refuses a hostname that does not resolve', async () => {
    await expect(
      checkTarget('https://nowhere.example.com/hook', () => Promise.reject(new Error('ENOTFOUND'))),
    ).resolves.toMatchObject({ allowed: false });
  });

  it.each([
    // What `URL` turns [::ffff:127.0.0.1] into: the hex spelling the old
    // dotted-only check never matched.
    ['https://[::ffff:127.0.0.1]/hook', 'IPv4-mapped loopback'],
    ['https://[::ffff:a00:5]:8443/hook', 'IPv4-mapped RFC 1918'],
    ['https://[::7f00:1]/hook', 'IPv4-compatible loopback'],
    ['https://[64:ff9b::a9fe:a9fe]/hook', 'NAT64 to cloud metadata'],
    ['https://[fec0::1]/hook', 'site-local'],
    ['https://[ff02::1]/hook', 'multicast'],
    ['https://[2002:7f00:1::1]/hook', '6to4'],
    ['https://[2001::1]/hook', 'Teredo'],
    ['https://[2001:db8::1]/hook', 'documentation'],
    ['https://198.18.0.1/hook', 'benchmarking'],
    ['https://192.0.0.8/hook', 'IETF protocol assignments'],
  ])('refuses %s (%s)', async (url) => {
    await expect(checkTarget(url, resolvesTo())).resolves.toMatchObject({ allowed: false });
  });

  it('allows global unicast IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
    expect(isBlockedAddress('::ffff:93.184.216.34')).toBe(false);
  });
});

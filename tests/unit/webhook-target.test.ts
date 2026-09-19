import { describe, expect, it } from 'vitest';
import { checkTarget } from '@/server/services/webhook-target';

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
});

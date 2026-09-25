/**
 * The address a rate limit counts requests against.
 *
 * `X-Forwarded-For` is a list each proxy appends to, so its *first* entry is
 * whatever the client chose to send — a limiter keyed on it gives every
 * request a fresh allowance for the price of a made-up header. The last entry
 * is the one the nearest proxy wrote, which the client cannot forge. On
 * Vercel the platform overwrites the header with the one address it saw, so
 * first and last are the same; behind a single reverse proxy that appends,
 * the last is the client. Only a chain of several trusted proxies would need
 * more than this, and then the count to skip is configuration, not a guess.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || headers.get('x-real-ip')?.trim() || 'unknown';
}

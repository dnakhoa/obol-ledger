import { createHash, timingSafeEqual } from 'node:crypto';
import { problem, type Problem } from './problem';

/**
 * Bearer-token authentication for the write endpoints.
 *
 * Reads are open because this is a public demonstration ledger; writes are not,
 * because anyone could otherwise fill it with noise. Comparison is
 * constant-time: `a === b` on secrets leaks their length and a prefix of their
 * content through timing, and the fix costs nothing.
 */
export function authorize(request: Request): Problem | undefined {
  const expected = process.env['LEDGER_API_TOKEN'];
  if (!expected) {
    return problem(
      503,
      'not-configured',
      'Service not configured',
      'LEDGER_API_TOKEN is not set, so write endpoints are disabled.',
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const [scheme, presented] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !presented) {
    return problem(
      401,
      'unauthorized',
      'Authentication required',
      'Supply a bearer token: Authorization: Bearer <token>.',
    );
  }

  if (!constantTimeEquals(presented, expected)) {
    return problem(
      401,
      'unauthorized',
      'Authentication required',
      'The bearer token is not valid.',
    );
  }

  return undefined;
}

/**
 * Compares two secrets without leaking anything through timing.
 *
 * `timingSafeEqual` throws on a length mismatch, so comparing the raw strings
 * would require a length check first — and that check is itself a timing signal
 * that tells an attacker how long the token is. Hashing both to a fixed 32
 * bytes removes the branch entirely: every comparison does the same work
 * regardless of what was presented.
 */
function constantTimeEquals(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

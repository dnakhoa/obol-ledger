import { timingSafeEqual } from 'node:crypto';
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

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal; hashing to a fixed width first keeps the comparison uniform.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

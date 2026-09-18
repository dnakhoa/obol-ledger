import { problem, type Problem } from './problem';

/**
 * A fixed-window rate limiter held in process memory.
 *
 * Its limits are worth stating plainly rather than discovering in production:
 * the counter lives in one serverless instance, so N instances allow N times
 * the quota, and a cold start resets it. That is an acceptable trade for a
 * demonstration ledger whose goal is to blunt accidental floods — a real
 * deployment moves the counter to Redis or the platform's own edge limiter, and
 * only this module changes.
 */
export type RateLimitDecision =
  | { readonly allowed: true; readonly remaining: number; readonly resetAt: number }
  | { readonly allowed: false; readonly retryAfterSeconds: number; readonly resetAt: number };

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

const windows = new Map<string, Window>();

export function rateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = MAX_REQUESTS,
): RateLimitDecision {
  // Opportunistic sweep: without it the map grows with every distinct client
  // for the lifetime of the instance.
  if (windows.size > 10_000) {
    for (const [existing, window] of windows) {
      if (window.resetAt <= now) windows.delete(existing);
    }
  }

  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    const window = { count: 1, resetAt: now + WINDOW_MS };
    windows.set(key, window);
    return { allowed: true, remaining: limit - 1, resetAt: window.resetAt };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  return { allowed: true, remaining: limit - current.count, resetAt: current.resetAt };
}

export function rateLimitProblem(
  decision: Extract<RateLimitDecision, { allowed: false }>,
): Problem {
  return problem(
    429,
    'rate-limited',
    'Too many requests',
    `Rate limit exceeded. Retry in ${decision.retryAfterSeconds}s.`,
    { retryAfterSeconds: decision.retryAfterSeconds },
  );
}

/** Test seam: the window map is module state and must be resettable. */
export function resetRateLimits(): void {
  windows.clear();
}

export const RATE_LIMIT = { windowMs: WINDOW_MS, maxRequests: MAX_REQUESTS } as const;

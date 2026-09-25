import { problem, type Problem } from './problem';

/**
 * A fixed-window counter held in process memory, used as a *pre-check*.
 *
 * On its own this is wrong in a specific way: the counter lives in one
 * serverless instance, so N instances allow N times the quota and a cold start
 * hands a client a fresh allowance. `durable-rate-limit.ts` is the authority;
 * this exists in front of it for two reasons.
 *
 * It can reject without a round trip. A local count is a subset of the shared
 * one, so "already over here" implies "over there" — the implication only runs
 * that way, which is why this may refuse but never grant. Under a flood that
 * bounds database work at roughly `limit` writes per client per window.
 *
 * And it is what the system falls back to when the shared counter is
 * unreachable, so a database blip degrades the limiter rather than removing it.
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
  windowMs: number = WINDOW_MS,
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
    const window = { count: 1, resetAt: now + windowMs };
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

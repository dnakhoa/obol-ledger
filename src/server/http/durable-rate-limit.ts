import { sql } from 'drizzle-orm';
import type { Database } from '@/server/db/types';
import { rateLimit, type RateLimitDecision, RATE_LIMIT } from './rate-limit';

/**
 * A rate limiter shared by every instance, counted in Postgres.
 *
 * ## Why not in memory
 *
 * The in-process counter is wrong in a specific way: N serverless instances
 * allow N times the quota, and a cold start hands an attacker a fresh
 * allowance. It blunts accidental floods and nothing more.
 *
 * ## Why not Redis
 *
 * Because Postgres is already here and this is one integer per client. Adding
 * a second datastore buys atomic increments the database already provides, and
 * costs an operational dependency, a second failure mode and a second thing to
 * provision in every environment.
 *
 * ## Why this is not one round trip per request
 *
 * It is, in the ordinary case — and the ordinary case is a handful of requests.
 * Under an actual flood the local counter also trips, and a local count can
 * only be *lower* than the shared one, so rejecting from it is always sound.
 * That bounds database work at roughly `limit` writes per client per window,
 * which is exactly the regime where the bound matters.
 *
 * ## Sliding window
 *
 * A fixed window lets a client spend its whole quota in the last second of one
 * window and again in the first second of the next — double the intended rate,
 * at precisely the moment a limiter is supposed to hold. The previous window's
 * count is kept and weighted by how far into the current window we are, which
 * is the approximation Cloudflare popularised: one row, one statement, and an
 * error well under a percent at these volumes.
 */

export type DurableDecision = RateLimitDecision & {
  /** True when the shared counter could not be reached and local state decided. */
  readonly degraded?: boolean;
};

type Row = { count: number; previous_count: number; window_start: string };

export async function durableRateLimit(
  database: Database,
  key: string,
  options: { limit?: number; now?: number; windowMs?: number } = {},
): Promise<DurableDecision> {
  const limit = options.limit ?? RATE_LIMIT.maxRequests;
  const now = options.now ?? Date.now();
  // A key keeps one window length for its life; the length is part of what
  // the key means, so callers that want an hourly quota use their own key.
  const windowMs = options.windowMs ?? RATE_LIMIT.windowMs;

  // The local pre-check. It can only reject, never grant: a local count is a
  // subset of the shared one, so "already over here" implies "over there".
  const local = rateLimit(key, now, limit, windowMs);
  if (!local.allowed) return local;

  const currentStart = new Date(Math.floor(now / windowMs) * windowMs);
  const previousStart = new Date(currentStart.getTime() - windowMs);

  let row: Row | undefined;
  try {
    /*
     * One statement, so the read-modify-write cannot interleave.
     *
     * The window roll is inside the UPDATE rather than decided in JavaScript
     * from a prior SELECT, which is the version that looks obvious and loses
     * increments under concurrency: two instances read the same count, both
     * add one, and one of the increments is gone.
     */
    const result = (await database.execute(sql`
      INSERT INTO rate_limits (key, window_start, count, previous_count, updated_at)
      VALUES (${key}, ${currentStart}, 1, 0, now())
      ON CONFLICT (key) DO UPDATE SET
        window_start = ${currentStart},
        count = CASE
          WHEN rate_limits.window_start = ${currentStart} THEN rate_limits.count + 1
          ELSE 1
        END,
        previous_count = CASE
          WHEN rate_limits.window_start = ${currentStart} THEN rate_limits.previous_count
          WHEN rate_limits.window_start = ${previousStart} THEN rate_limits.count
          ELSE 0
        END,
        updated_at = now()
      RETURNING count, previous_count, window_start
    `)) as { rows: Row[] };
    row = result.rows[0];
  } catch {
    /*
     * Fail open, to the local limiter's answer.
     *
     * Failing closed would turn a database blip into a total outage: every
     * request 429s, including the ones that would have succeeded. A limiter
     * exists to protect the system from load, and refusing all traffic because
     * the counter is unreachable inflicts the outage it was meant to prevent.
     * The local counter still applies, so this degrades to the old behaviour
     * rather than to no limit at all.
     */
    return { ...local, degraded: true };
  }

  if (!row) return { ...local, degraded: true };

  // Weight the previous window by the part of it still inside the last
  // `windowMs`: at 25% into the current window, 75% of the previous still
  // counts.
  const elapsed = (now - currentStart.getTime()) / windowMs;
  const estimate = row.count + row.previous_count * (1 - elapsed);
  const resetAt = currentStart.getTime() + windowMs;

  if (estimate > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      resetAt,
    };
  }

  return { allowed: true, remaining: Math.max(0, Math.floor(limit - estimate)), resetAt };
}

/**
 * Removes counters nobody has touched for two days — the longest window any
 * caller uses is a day, and its previous window still counts.
 *
 * Called from the webhook dispatch cron rather than given a schedule of its
 * own: a second cron entry to delete a few rows is a second thing that can
 * fail silently, and the sweep is cheap enough to ride along with work that
 * already runs.
 */
export async function sweepRateLimits(database: Database): Promise<number> {
  const result = (await database.execute(
    sql`DELETE FROM rate_limits WHERE updated_at < now() - interval '2 days'`,
  )) as { rowCount?: number };
  return result.rowCount ?? 0;
}

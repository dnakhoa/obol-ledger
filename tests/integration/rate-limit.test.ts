import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { durableRateLimit, sweepRateLimits } from '@/server/http/durable-rate-limit';
import { resetRateLimits, RATE_LIMIT } from '@/server/http/rate-limit';

/**
 * The shared counter.
 *
 * The in-process limiter this replaces was wrong in a way no single-instance
 * test can show: N instances allow N times the quota. These exercise the SQL
 * that makes the count shared, and the window arithmetic that stops a client
 * spending its quota twice across a window boundary.
 */
describe('durable rate limiting', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    resetRateLimits();
  });

  afterEach(async () => {
    await db.$close();
  });

  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it('allows up to the limit and then refuses', async () => {
    for (let i = 0; i < 5; i += 1) {
      const decision = await durableRateLimit(db, 'client-a', { limit: 5, now });
      expect(decision.allowed, `request ${i + 1}`).toBe(true);
    }

    const over = await durableRateLimit(db, 'client-a', { limit: 5, now });
    expect(over.allowed).toBe(false);
    expect(over.allowed === false && over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each key separately', async () => {
    await durableRateLimit(db, 'client-a', { limit: 1, now });
    const other = await durableRateLimit(db, 'client-b', { limit: 1, now });
    expect(other.allowed).toBe(true);
  });

  it('reports what is left', async () => {
    const first = await durableRateLimit(db, 'client-a', { limit: 10, now });
    expect(first.allowed === true && first.remaining).toBe(9);
  });

  describe('the sliding window', () => {
    it('does not let a client spend its quota twice across the boundary', async () => {
      // The failure a fixed window has: spend everything in the last moment of
      // one window, then everything again in the first moment of the next —
      // double the intended rate, exactly when a limiter should hold.
      const endOfWindow = now + RATE_LIMIT.windowMs - 1;
      for (let i = 0; i < 5; i += 1) {
        const decision = await durableRateLimit(db, 'burst', { limit: 5, now: endOfWindow });
        expect(decision.allowed).toBe(true);
      }

      // One millisecond later, in the next window. A fixed window would reset
      // to zero here and allow five more.
      resetRateLimits();
      const startOfNext = endOfWindow + 1;
      const decision = await durableRateLimit(db, 'burst', { limit: 5, now: startOfNext });
      expect(decision.allowed).toBe(false);
    });

    it('lets the previous window decay as the current one elapses', async () => {
      const first = now;
      for (let i = 0; i < 5; i += 1) {
        await durableRateLimit(db, 'decaying', { limit: 5, now: first });
      }

      resetRateLimits();
      // 90% of the way into the next window, only 10% of the previous count
      // still weighs — so there is room again.
      const late = now + RATE_LIMIT.windowMs + Math.floor(RATE_LIMIT.windowMs * 0.9);
      const decision = await durableRateLimit(db, 'decaying', { limit: 5, now: late });
      expect(decision.allowed).toBe(true);
    });

    it('forgets a window older than the previous one entirely', async () => {
      await durableRateLimit(db, 'stale', { limit: 1, now });

      resetRateLimits();
      const muchLater = now + RATE_LIMIT.windowMs * 10;
      const decision = await durableRateLimit(db, 'stale', { limit: 1, now: muchLater });
      expect(decision.allowed).toBe(true);
    });
  });

  describe('failure', () => {
    it('degrades to the local answer rather than refusing everything', async () => {
      // A limiter exists to protect the system from load. Failing closed on a
      // database blip inflicts the outage it was meant to prevent.
      const broken = {
        execute: () => Promise.reject(new Error('connection terminated')),
      } as unknown as TestDatabase;

      const decision = await durableRateLimit(broken, 'client-a', { limit: 5, now });
      expect(decision.allowed).toBe(true);
      expect(decision.degraded).toBe(true);
    });

    it('still refuses a client the local counter has already seen too often', async () => {
      const broken = {
        execute: () => Promise.reject(new Error('connection terminated')),
      } as unknown as TestDatabase;

      for (let i = 0; i < 5; i += 1) {
        await durableRateLimit(broken, 'noisy', { limit: 5, now });
      }
      const over = await durableRateLimit(broken, 'noisy', { limit: 5, now });
      expect(over.allowed).toBe(false);
    });
  });

  it('sweeps counters nobody has touched', async () => {
    await durableRateLimit(db, 'old', { limit: 5, now });
    await db.execute(sql`UPDATE rate_limits SET updated_at = now() - interval '2 hours'`);

    expect(await sweepRateLimits(db)).toBe(1);

    const remaining = (await db.execute(
      sql`SELECT count(*)::int AS count FROM rate_limits`,
    )) as unknown as { rows: { count: number }[] };
    expect(remaining.rows[0]?.count).toBe(0);
  });
});

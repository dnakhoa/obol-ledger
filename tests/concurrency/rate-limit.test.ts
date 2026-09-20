import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLivePostgres, LIVE_DATABASE_URL, type LivePostgres } from '../helpers/live-postgres';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { resetRateLimits } from '@/server/http/rate-limit';

/**
 * The claim the old limiter could not make.
 *
 * An in-process counter is wrong in a way no single-instance test can show:
 * every instance allows the full quota, and a cold start hands an attacker a
 * fresh allowance. Proving the fix needs real connections racing, which PGlite
 * cannot express.
 *
 * `resetRateLimits()` before each call simulates that cold start — it clears
 * the local pre-check, so the shared counter in Postgres is the only thing
 * deciding. Against the old limiter every one of these requests is allowed.
 */
const suite = LIVE_DATABASE_URL ? describe : describe.skip;

suite('rate limiting across instances', () => {
  let live: LivePostgres;

  const LIMIT = 10;
  const ATTEMPTS = 40;

  beforeAll(async () => {
    live = await createLivePostgres();
  });

  afterAll(async () => {
    await live.close();
  });

  beforeEach(async () => {
    await live.database.execute(sql`DELETE FROM rate_limits`);
    resetRateLimits();
  });

  it('holds one quota no matter how many instances ask', async () => {
    const now = Date.now();
    let allowed = 0;

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      // Every request arrives at a freshly started instance.
      resetRateLimits();
      const decision = await durableRateLimit(live.database, 'shared-client', {
        limit: LIMIT,
        now,
      });
      if (decision.allowed) allowed += 1;
      expect(decision.degraded ?? false).toBe(false);
    }

    expect(allowed).toBe(LIMIT);
  });

  it('loses no increments when requests race', async () => {
    // The version that reads, decides in JavaScript, then writes drops
    // increments here: two connections read the same count, both add one, and
    // one of them is gone. The roll is inside the UPDATE for exactly this.
    const now = Date.now();
    await Promise.all(
      Array.from({ length: ATTEMPTS }, async () => {
        resetRateLimits();
        await durableRateLimit(live.database, 'racing-client', { limit: LIMIT, now });
      }),
    );

    const result = (await live.database.execute(
      sql`SELECT count FROM rate_limits WHERE key = 'racing-client'`,
    )) as unknown as { rows: { count: number }[] };

    expect(result.rows[0]?.count).toBe(ATTEMPTS);
  });

  it('keeps separate clients on separate budgets under load', async () => {
    const now = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: ATTEMPTS }, async (_, index) => {
        resetRateLimits();
        const decision = await durableRateLimit(live.database, `client-${index % 4}`, {
          limit: LIMIT,
          now,
        });
        return decision.allowed;
      }),
    );

    // Four clients, ten attempts each, all within one quota.
    expect(outcomes.filter(Boolean)).toHaveLength(ATTEMPTS);
  });
});

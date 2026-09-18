import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { defineRoute, json } from '@/server/http/route';

/**
 * Liveness *and* readiness in one probe.
 *
 * A health check that only proves the process is running is close to useless —
 * the interesting failure is a Lambda that starts fine and cannot reach its
 * database. Running a trivial query answers the question a load balancer is
 * really asking, and reports `degraded` rather than throwing so the response
 * body itself says which dependency is unhappy.
 */
export const GET = defineRoute({ name: 'health', rateLimit: false }, async ({ logger }) => {
  const startedAt = performance.now();
  try {
    await db().execute(sql`select 1`);
    return json({
      status: 'ok',
      database: { reachable: true, latencyMs: Math.round(performance.now() - startedAt) },
    });
  } catch (error) {
    logger.error('health.database_unreachable', { error });
    return json(
      { status: 'degraded', database: { reachable: false } },
      { status: 503, headers: { 'retry-after': '5' } },
    );
  }
});

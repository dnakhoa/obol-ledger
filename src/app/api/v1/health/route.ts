import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { defineRoute, json } from '@/server/http/route';

/**
 * Liveness *and* readiness in one probe.
 *
 * A health check that only proves the process is running is close to useless —
 * the interesting failure is an instance that starts fine and cannot reach its
 * database. Running a trivial query answers the question a load balancer is
 * really asking.
 *
 * When it fails, the response says *why*, because "degraded" alone sends an
 * operator to the logs for something the probe already knows. Two facts are
 * enough to separate the usual causes without leaking anything:
 *
 *  - `configured` distinguishes "nobody set DATABASE_URL" from "the database
 *    refused us", which are different problems with different fixes.
 *  - `code` is the driver or Postgres error code — `ENOTFOUND` for DNS,
 *    `ECONNREFUSED` for a closed port, `28P01` for bad credentials. Codes are a
 *    closed vocabulary; the *message* can carry a host or a user name, so it
 *    stays in the logs.
 */
export const GET = defineRoute({ name: 'health', rateLimit: false }, async ({ logger }) => {
  const configured = Boolean(process.env['DATABASE_URL']);
  const startedAt = performance.now();

  try {
    await db().execute(sql`select 1`);
    return json({
      status: 'ok',
      database: {
        configured,
        reachable: true,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    });
  } catch (error) {
    logger.error('health.database_unreachable', { error });
    return json(
      { status: 'degraded', database: { configured, reachable: false, code: errorCodeOf(error) } },
      { status: 503, headers: { 'retry-after': '5' } },
    );
  }
});

/**
 * Walks the `cause` chain for a driver or Postgres error code.
 *
 * drizzle wraps driver failures, so the code that identifies the fault is
 * rarely on the outermost error.
 */
export function errorCodeOf(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    current = current.cause;
  }
  return 'unknown';
}

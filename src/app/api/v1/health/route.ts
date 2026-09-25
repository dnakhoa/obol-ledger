import { sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { checkTenantIsolation } from '@/server/db/tenancy';
import { checkSchemaVersion } from '@/server/db/schema-version';
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
export const GET = defineRoute(
  // Limited like any other route: a probe calls it a few times a minute, and
  // unlimited it would be a free way to make the database do work.
  { name: 'health', tenantless: true },
  async ({ logger }) => {
    const configured = Boolean(process.env['DATABASE_URL']);
    const startedAt = performance.now();

    try {
      await db().execute(sql`select 1`);

      // Tenant isolation is checked, not assumed. A connection whose role
      // bypasses row-level security would leave every policy inert while the
      // application carried on looking healthy, so the probe reports it as a
      // degraded state rather than waiting for someone to notice.
      const isolation = await checkTenantIsolation(db());

      // Schema drift is reported for the same reason isolation is: the
      // failure is silent from here and catastrophic from outside. Code that
      // reads a column the database lacks answers 500 with a Postgres error
      // naming the column, which says nothing about *why* it is missing. This
      // says the migration has not run, which is the actionable fact.
      const schema = await checkSchemaVersion(db());

      // An unreadable bookkeeping table is a configuration gap, not a
      // migration gap, and reporting it as pending work would send an
      // operator to run migrations that have already run.
      const healthy = isolation.enforced && (schema.upToDate || !schema.readable);

      return json(
        {
          status: healthy ? 'ok' : 'degraded',
          database: {
            configured,
            reachable: true,
            latencyMs: Math.round(performance.now() - startedAt),
          },
          tenantIsolation: isolation,
          schema,
        },
        healthy ? {} : { status: 503 },
      );
    } catch (error) {
      logger.error('health.database_unreachable', { error });
      return json(
        {
          status: 'degraded',
          database: { configured, reachable: false, code: errorCodeOf(error) },
        },
        { status: 503, headers: { 'retry-after': '5' } },
      );
    }
  },
);

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

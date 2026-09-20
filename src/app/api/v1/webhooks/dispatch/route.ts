import { timingSafeEqual } from 'node:crypto';
import { defineRoute, json } from '@/server/http/route';
import { problem, problemResponse } from '@/server/http/problem';
import { authentication } from '@/server/container';
import { createDispatcher } from '@/server/services/webhook-dispatcher';
import { sweepRateLimits } from '@/server/http/durable-rate-limit';
import { db } from '@/server/db/client';

/**
 * Drains the outbox. Triggered by a scheduled job, not by a person.
 *
 * Delivery runs on a cron rather than inline with the write for the same
 * reason the outbox exists at all: a POST that must reach a stranger's server
 * before it can return has coupled the ledger's availability to the
 * subscriber's. An entry should commit in single-digit milliseconds whether
 * or not the webhook target is awake.
 *
 * Every tenant is drained in turn. Isolation is enforced per connection, so
 * there is no way to claim across tenants even if that were desirable — and it
 * is not, because a single loop per tenant is what stops one busy tenant's
 * backlog from crowding everyone else out of the batch.
 */
export const POST = defineRoute(
  { name: 'webhooks.dispatch', tenantless: true, rateLimit: false },
  async ({ request, requestId, logger }) => {
    if (!authorized(request)) {
      return problemResponse({
        ...problem(
          401,
          'unauthorized',
          'Unauthorized',
          'The dispatch endpoint is triggered by the scheduler, not by clients.',
        ),
        requestId,
      });
    }

    const database = db();
    const orgs = await authentication().organizations();

    const totals = { claimed: 0, succeeded: 0, failed: 0, retrying: 0 };
    for (const org of orgs) {
      const result = await createDispatcher(database, org.id).dispatch();
      totals.claimed += result.claimed;
      totals.succeeded += result.succeeded;
      totals.failed += result.failed;
      totals.retrying += result.retrying;
    }

    // Rides along rather than taking a schedule of its own: a second cron
    // entry to delete a few rows is a second thing that can fail silently.
    const sweptCounters = await sweepRateLimits(database);

    logger.info('webhooks.dispatched', { ...totals, tenants: orgs.length, sweptCounters });
    return json({ data: { ...totals, tenants: orgs.length, sweptCounters } });
  },
);

/**
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`.
 *
 * Compared in constant time, because this is a bearer token like any other and
 * the fact that only the platform is supposed to call the endpoint is not a
 * reason to compare it carelessly. When no secret is configured — a local
 * checkout — the endpoint is open, which is the correct trade for a machine
 * with no scheduler and no production data.
 */
function authorized(request: Request): boolean {
  const expected = process.env['CRON_SECRET'];
  if (!expected) return true;

  const presented = request.headers.get('authorization')?.replace(/^Bearer /u, '') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

import { and, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { LedgerError } from '@/server/domain/errors';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/server/domain/webhook';
import { webhookDeliveries, webhookEndpoints } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database } from '@/server/db/types';
import { generateSecret } from './webhook-signature';

export type EndpointDto = {
  readonly id: string;
  readonly url: string;
  readonly description: string | null;
  readonly eventTypes: readonly string[];
  readonly enabled: boolean;
  readonly consecutiveFailures: number;
  readonly disabledAt: string | null;
  readonly createdAt: string;
};

/** Returned once, at creation. The secret is never readable again. */
export type CreatedEndpointDto = EndpointDto & { readonly secret: string };

export type DeliveryDto = {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly payload: unknown;
};

type EndpointRow = typeof webhookEndpoints.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

function toEndpointDto(row: EndpointRow): EndpointDto {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes: row.eventTypes,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDeliveryDto(row: DeliveryRow): DeliveryDto {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    payload: row.payload,
  };
}

export function createWebhookService(database: Database, orgId: string) {
  return {
    async register(input: {
      url: string;
      description?: string | undefined;
      eventTypes?: readonly WebhookEventType[] | undefined;
    }): Promise<Result<CreatedEndpointDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [existing] = await tx
          .select({ id: webhookEndpoints.id })
          .from(webhookEndpoints)
          .where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.url, input.url)))
          .limit(1);
        if (existing) return err({ code: 'endpoint_url_taken', url: input.url });

        // Generated here, never supplied by the caller. A secret a client can
        // choose is a secret a client can reuse across services, and one that
        // ends up in a config file in a git repository.
        const secret = generateSecret();
        const [row] = await tx
          .insert(webhookEndpoints)
          .values({
            id: newId('webhookEndpoint'),
            orgId,
            url: input.url,
            description: input.description ?? null,
            secret,
            eventTypes: [...(input.eventTypes ?? [])],
          })
          // The check above answers the ordinary case; this answers two
          // registrations of one URL racing past it, which would otherwise
          // surface as a 500 carrying the losing insert's secret in its log.
          .onConflictDoNothing({ target: [webhookEndpoints.orgId, webhookEndpoints.url] })
          .returning();
        if (!row) return err({ code: 'endpoint_url_taken', url: input.url });

        // The only time the secret leaves the system. Showing it again later
        // would mean a read-only credential could exfiltrate the ability to
        // forge deliveries; if it is lost, it is rotated, not recovered.
        return ok({ ...toEndpointDto(row), secret });
      });
    },

    async list(): Promise<EndpointDto[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.orgId, orgId))
          .orderBy(desc(webhookEndpoints.createdAt));
        return rows.map(toEndpointDto);
      });
    },

    async get(endpointId: string): Promise<Result<EndpointDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.id, endpointId))
          .limit(1);
        return row ? ok(toEndpointDto(row)) : err({ code: 'endpoint_not_found', endpointId });
      });
    },

    /** Re-enable an endpoint the circuit breaker opened, clearing the count. */
    async setEnabled(
      endpointId: string,
      enabled: boolean,
    ): Promise<Result<EndpointDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .update(webhookEndpoints)
          .set({
            enabled,
            consecutiveFailures: 0,
            disabledAt: enabled ? null : new Date(),
          })
          .where(eq(webhookEndpoints.id, endpointId))
          .returning();
        return row ? ok(toEndpointDto(row)) : err({ code: 'endpoint_not_found', endpointId });
      });
    },

    async remove(endpointId: string): Promise<Result<{ id: string }, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .delete(webhookEndpoints)
          .where(eq(webhookEndpoints.id, endpointId))
          .returning({ id: webhookEndpoints.id });
        return row ? ok(row) : err({ code: 'endpoint_not_found', endpointId });
      });
    },

    /**
     * The delivery log.
     *
     * Kept because "did you send it?" is the first question every integration
     * asks, and an answer of "check your logs" is how a support thread turns
     * into a day. Each row carries the attempt count, the last status code and
     * the last error, so the subscriber can usually see that the failure is
     * theirs without anyone reading a log at all.
     */
    async deliveries(options: {
      endpointId?: string | undefined;
      status?: string | undefined;
      limit?: number | undefined;
    }): Promise<DeliveryDto[]> {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      return withTenant(database, orgId, async (tx) => {
        const conditions = [eq(webhookDeliveries.orgId, orgId)];
        if (options.endpointId) {
          conditions.push(eq(webhookDeliveries.endpointId, options.endpointId));
        }
        if (options.status) {
          conditions.push(sql`${webhookDeliveries.status}::text = ${options.status}`);
        }

        const rows = await tx
          .select()
          .from(webhookDeliveries)
          .where(and(...conditions))
          .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
          .limit(limit);
        return rows.map(toDeliveryDto);
      });
    },

    /**
     * Put a finished delivery back in the queue.
     *
     * Deliberately a new row rather than a reset of the old one. The log is
     * evidence — "we tried five times and your server returned 502" is an
     * answer to a dispute — and mutating it in place to try again destroys
     * exactly the record that was worth keeping. The replay carries the same
     * `event_id`, so a subscriber that already handled it deduplicates.
     */
    async replay(deliveryId: string): Promise<Result<DeliveryDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [original] = await tx
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, deliveryId))
          .limit(1);
        if (!original) return err({ code: 'delivery_not_found', deliveryId });

        // A replay is a genuinely new delivery of the same event, so it gets
        // its own event id — the unique (event_id, endpoint_id) index exists
        // to stop accidental duplicates, not deliberate ones. The original id
        // travels in the payload for correlation.
        const payload = original.payload as Record<string, unknown>;
        const [row] = await tx
          .insert(webhookDeliveries)
          .values({
            id: newId('webhookDelivery'),
            orgId,
            endpointId: original.endpointId,
            eventId: newId('event'),
            eventType: original.eventType,
            payload: { ...payload, replayOf: original.eventId },
          })
          .returning();
        if (!row) throw new Error('INSERT ... RETURNING produced no delivery row');
        return ok(toDeliveryDto(row));
      });
    },

    /** Counts for the dashboard, one round trip. */
    async summary(): Promise<{
      endpoints: number;
      byStatus: Record<string, number>;
    }> {
      return withTenant(database, orgId, async (tx) => {
        const [endpointCount] = await tx
          .select({ count: sql<string>`count(*)::text` })
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.orgId, orgId));

        const statuses = await tx
          .select({
            status: webhookDeliveries.status,
            count: sql<string>`count(*)::text`,
          })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.orgId, orgId))
          .groupBy(webhookDeliveries.status);

        return {
          endpoints: Number(endpointCount?.count ?? 0),
          byStatus: Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)])),
        };
      });
    },

    eventTypes: WEBHOOK_EVENT_TYPES,
  };
}

export type WebhookService = ReturnType<typeof createWebhookService>;

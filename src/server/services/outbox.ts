import { and, eq } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { subscribes, type WebhookEventType } from '@/server/domain/webhook';
import { webhookDeliveries, webhookEndpoints } from '@/server/db/schema';
import type { Transactional } from '@/server/db/types';

/**
 * The transactional outbox.
 *
 * `enqueue` takes the *transaction handle*, not the database, and that is the
 * entire design. It is called from inside the same transaction as the ledger
 * write it announces, so the delivery rows commit with the entry or not at
 * all. There is no window in which the books have moved and the outbox has
 * not, which means there is no way for a subscriber to miss an event without
 * the entry also having failed.
 *
 * The usual alternative — publish after COMMIT — has a gap exactly one process
 * death wide, and the failure is silent on both ends: the sender believes it
 * published, and the receiver cannot notice the absence of a message it was
 * never told to expect.
 *
 * Fan-out happens here rather than at delivery time, so the payload is stored
 * once per endpoint. That costs storage and buys three things: an endpoint
 * registered after the fact never receives history it was not subscribed to,
 * a single endpoint can be retried or replayed without touching the others,
 * and the claim query needs no join. See `docs/adr/0009-webhooks.md`.
 */
export type LedgerEvent = {
  readonly type: WebhookEventType;
  readonly data: Record<string, unknown>;
  /**
   * Supplied by the caller so that one ledger change produces one event id
   * across every endpoint. The receiver's deduplication key.
   */
  readonly id?: string;
};

export async function enqueue(
  tx: Transactional,
  orgId: string,
  event: LedgerEvent,
): Promise<number> {
  const endpoints = await tx
    .select({
      id: webhookEndpoints.id,
      eventTypes: webhookEndpoints.eventTypes,
    })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.enabled, true)));

  const targets = endpoints.filter((endpoint) => subscribes(endpoint.eventTypes, event.type));
  if (targets.length === 0) return 0;

  const eventId = event.id ?? newId('event');
  const occurredAt = new Date().toISOString();

  await tx.insert(webhookDeliveries).values(
    targets.map((endpoint) => ({
      id: newId('webhookDelivery'),
      orgId,
      endpointId: endpoint.id,
      eventId,
      eventType: event.type,
      // The envelope is what the subscriber verifies the signature over, so it
      // is frozen here rather than rebuilt at send time. A payload that could
      // change between attempts would make a retry a different message.
      payload: {
        id: eventId,
        type: event.type,
        occurredAt,
        data: event.data,
      },
    })),
  );

  return targets.length;
}

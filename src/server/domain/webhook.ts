/**
 * Webhook policy: what can be announced, and how hard we try to announce it.
 *
 * Pure decisions, deliberately separated from the code that opens sockets.
 * "How long until the next attempt" is the kind of rule that is easy to get
 * subtly wrong and impossible to test when it is tangled up with `fetch`.
 */

export const WEBHOOK_EVENT_TYPES = [
  'entry.posted',
  'entry.pending',
  'entry.settled',
  'entry.archived',
  'entry.reversed',
  'account.opened',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * `webhook_deliveries.event_type` is `text`, not this enum.
 *
 * A new event type should not require a migration, and — more importantly —
 * a delivery from six months ago should still say what it actually was even
 * after that type is retired. History records what happened; the enum
 * constrains what may happen next. Conflating the two rewrites the past.
 */
export const DELIVERY_STATUSES = [
  'pending',
  /** Claimed by a worker. A row stuck here past the lease is re-claimable. */
  'delivering',
  'succeeded',
  /** Retries exhausted, or the endpoint refused in a way retrying cannot fix. */
  'failed',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Attempts after which a delivery is abandoned. */
export const MAX_ATTEMPTS = 8;

/** Consecutive failures after which an endpoint is disabled. */
export const FAILURE_THRESHOLD = 20;

/**
 * How long a claimed row may stay `delivering` before another worker may take
 * it. Longer than any plausible request (the client timeout is 10s), short
 * enough that a worker killed mid-flight does not strand the delivery.
 */
export const CLAIM_LEASE_MS = 60_000;

/**
 * Exponential backoff with full jitter, capped at six hours.
 *
 * The jitter is not decoration. Deliveries are created in bursts — one entry
 * fans out to every endpoint at once — so a deterministic schedule would
 * retry them in a synchronised wave and hit a recovering subscriber with the
 * same thundering herd that knocked it over. Full jitter spreads the wave
 * across the whole window.
 *
 *   attempt 1 → up to 10s      attempt 5 → up to 27m
 *   attempt 2 → up to 40s      attempt 6 → up to 1h48m
 *   attempt 3 → up to 2m40s    attempt 7 → up to 6h (capped)
 *   attempt 4 → up to 10m40s   attempt 8 → up to 6h (capped)
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 10_000 * 4 ** Math.max(0, attempt - 1);
  return Math.round(random() * Math.min(base, 6 * 60 * 60 * 1000));
}

/**
 * Whether a response code is worth trying again.
 *
 * 4xx means the subscriber understood and refused: a 404 endpoint will still
 * be a 404 in six hours, and retrying it for a day wastes both sides' budget.
 * The exceptions are the codes that explicitly mean *not now*: 408, 425, and
 * 429. Everything 5xx is the subscriber having a bad day, which is precisely
 * the case retries exist for.
 */
export function isRetryable(status: number): boolean {
  if (status >= 500) return true;
  return status === 408 || status === 425 || status === 429;
}

/** Whether an endpoint's subscription covers an event. Empty means all. */
export function subscribes(eventTypes: readonly string[], eventType: string): boolean {
  return eventTypes.length === 0 || eventTypes.includes(eventType);
}

'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { db } from '@/server/db/client';
import { createEndpointSchema } from '@/server/http/schemas';
import { createDispatcher } from '@/server/services/webhook-dispatcher';
import { logger } from '@/server/observability/logger';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';

export type EndpointFormState = {
  readonly status: 'idle' | 'error' | 'created';
  readonly message?: string;
  /** Shown once, and only in the response to the request that created it. */
  readonly secret?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
};

export async function registerEndpointAction(
  _previous: EndpointFormState,
  formData: FormData,
): Promise<EndpointFormState> {
  const requestHeaders = await headers();
  const client = clientAddress(requestHeaders);
  const decision = await durableRateLimit(db(), `webhook:${client}`, { limit: 10 });
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many endpoints registered. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const selected = formData.getAll('eventTypes').map(String);
  const parsed = createEndpointSchema.safeParse({
    url: formData.get('url'),
    description: formData.get('description') || undefined,
    eventTypes: selected,
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'The endpoint could not be registered. Check the highlighted fields.',
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    };
  }

  const writer = await requireWriter();
  if (!writer.allowed) {
    return { status: 'error', message: await refusalMessage(writer.reason, 'en') };
  }

  const result = await writer.services.webhooks.register(parsed.data);
  if (!result.ok) {
    return {
      status: 'error',
      message:
        result.error.code === 'endpoint_url_taken'
          ? 'That URL is already registered. Every event would be delivered to it twice.'
          : 'The endpoint could not be registered.',
      fieldErrors: [{ field: 'url', message: 'Already registered' }],
    };
  }

  revalidatePath('/webhooks');
  return {
    status: 'created',
    message: `Registered ${result.value.url}.`,
    // The one and only time it is readable. Returned through the action's own
    // state rather than stored anywhere, so a page refresh loses it — which is
    // the correct behaviour for a secret, not an oversight.
    secret: result.value.secret,
  };
}

export async function setEndpointEnabledAction(formData: FormData): Promise<void> {
  const endpointId = String(formData.get('endpointId'));
  const enabled = formData.get('enabled') === 'true';
  const writer = await requireWriter();
  if (!writer.allowed) return;
  await writer.services.webhooks.setEnabled(endpointId, enabled);
  revalidatePath('/webhooks');
}

export async function removeEndpointAction(formData: FormData): Promise<void> {
  const writer = await requireWriter();
  if (!writer.allowed) return;
  await writer.services.webhooks.remove(String(formData.get('endpointId')));
  revalidatePath('/webhooks');
}

export async function replayDeliveryAction(formData: FormData): Promise<void> {
  const writer = await requireWriter();
  if (!writer.allowed) return;
  await writer.services.webhooks.replay(String(formData.get('deliveryId')));
  revalidatePath('/webhooks');
}

/**
 * Runs the delivery worker now, rather than waiting for the scheduler.
 *
 * Deliveries are drained by a cron job, which on this deployment's plan runs
 * once a day — fine for a real integration, useless for someone reading the
 * page and wanting to see what happens. This is the same dispatcher the cron
 * calls, invoked directly, so the demo shows real behaviour rather than a
 * simulation of it.
 */
export async function dispatchNowAction(): Promise<void> {
  // Draining a queue sends real HTTP to real endpoints, so it is a write in
  // every sense that matters even though it changes no ledger row.
  const writer = await requireWriter();
  if (!writer.allowed) return;

  const result = await createDispatcher(db(), writer.viewer.orgId).dispatch();
  logger.info('webhooks.dispatched.manual', { ...result });
  revalidatePath('/webhooks');
}

import { defineRoute, json, readJson } from '@/server/http/route';
import { updateEndpointSchema } from '@/server/http/schemas';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { endpointId: string };

export const GET = defineRoute<Params>(
  { name: 'webhooks.endpoints.get' },
  async ({ params, requestId, services }) => {
    const result = await services.webhooks.get(params.endpointId);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

/**
 * Enables or disables an endpoint.
 *
 * Re-enabling also clears the consecutive-failure count, because the operator
 * pressing this button is asserting that whatever was broken is fixed. Leaving
 * the count would trip the circuit breaker again on the next single failure.
 */
export const PATCH = defineRoute<Params>(
  { name: 'webhooks.endpoints.update', auth: true },
  async ({ request, params, requestId, services }) => {
    const body = await readJson(request, updateEndpointSchema, requestId);
    if (!body.ok) return body.response;

    const result = await services.webhooks.setEnabled(params.endpointId, body.data.enabled);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

/**
 * Removes an endpoint, and its deliveries with it.
 *
 * A DELETE here is honest — unlike a journal entry, an endpoint is
 * configuration rather than history, and there is nothing to preserve once a
 * subscriber has gone. Its delivery log goes too, by `ON DELETE CASCADE`:
 * keeping orphaned rows pointing at a URL nobody owns is a data-retention
 * liability, not an audit trail.
 */
export const DELETE = defineRoute<Params>(
  { name: 'webhooks.endpoints.delete', auth: true },
  async ({ params, requestId, services }) => {
    const result = await services.webhooks.remove(params.endpointId);
    return result.ok
      ? new Response(null, { status: 204 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

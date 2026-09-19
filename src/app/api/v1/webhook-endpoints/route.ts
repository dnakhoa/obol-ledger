import { defineRoute, json, readJson } from '@/server/http/route';
import { createEndpointSchema } from '@/server/http/schemas';
import { problemFor, problemResponse } from '@/server/http/problem';

export const GET = defineRoute({ name: 'webhooks.endpoints.list' }, async ({ services }) => {
  // Secrets are not in `EndpointDto` at all, rather than being stripped here.
  // A field that does not exist cannot be leaked by a future handler that
  // forgets to remove it.
  return json({ data: await services.webhooks.list() });
});

/**
 * Registers an endpoint and returns its signing secret — once.
 *
 * The secret is in the 201 body and in no subsequent response. That is the
 * same bargain as an API key: a credential that can be re-read is a credential
 * that a read-only compromise turns into the ability to forge deliveries.
 */
export const POST = defineRoute(
  { name: 'webhooks.endpoints.create', auth: true },
  async ({ request, requestId, services }) => {
    const body = await readJson(request, createEndpointSchema, requestId);
    if (!body.ok) return body.response;

    const result = await services.webhooks.register({
      url: body.data.url,
      description: body.data.description,
      eventTypes: body.data.eventTypes,
    });
    if (!result.ok) return problemResponse(problemFor(result.error, requestId));

    return json(
      { data: result.value },
      {
        status: 201,
        headers: { location: `/api/v1/webhook-endpoints/${result.value.id}` },
      },
    );
  },
);

import { defineRoute, json, readJson } from '@/server/http/route';
import { createApiKeySchema } from '@/server/http/schemas';

export const GET = defineRoute({ name: 'api-keys.list', auth: true }, async ({ services }) => {
  // Digests are not in `ApiKeyDto`, so no handler can leak one by forgetting
  // to strip it. Only the identifying prefix is ever returned.
  return json({ data: await services.apiKeys.list() });
});

/**
 * Issues a key, returning the token once.
 *
 * Minting a credential requires an existing credential — which makes the
 * first key a bootstrap problem, solved by the seed rather than by an
 * unauthenticated endpoint that would let anyone mint one.
 */
export const POST = defineRoute(
  { name: 'api-keys.create', auth: true },
  async ({ request, requestId, services }) => {
    const body = await readJson(request, createApiKeySchema, requestId);
    if (!body.ok) return body.response;

    const issued = await services.apiKeys.issue(body.data.name);
    return json({ data: issued }, { status: 201 });
  },
);

import { openApiDocument } from '@/server/http/openapi';
import { defineRoute } from '@/server/http/route';

/**
 * The published API contract.
 *
 * Served rather than committed as a static file so it can never describe a
 * previous version of the code: it is assembled from the live zod schemas on
 * every request, and cached at the edge because it only changes on deploy.
 */
export const GET = defineRoute({ name: 'openapi', rateLimit: false }, async () => {
  return new Response(JSON.stringify(openApiDocument(), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
    },
  });
});

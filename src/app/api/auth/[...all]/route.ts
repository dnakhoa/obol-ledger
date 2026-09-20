import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth/config';

/**
 * The OAuth callback and session endpoints.
 *
 * Outside `/api/v1` deliberately: that surface is a versioned contract with a
 * generated OpenAPI document, and these routes belong to the auth library's
 * own protocol. Publishing them as part of the ledger's API would promise a
 * shape this project does not control.
 *
 * The handler is built per request rather than at module scope, and that is
 * not a style choice. `auth()` opens a database connection, and Next collects
 * route configuration at *build* time — so constructing it here would make
 * `next build` fail on any machine without a database, which is every CI
 * runner. `auth()` memoises, so this costs one construction in total.
 */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).POST(request);
}

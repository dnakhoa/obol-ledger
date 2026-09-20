import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth/config';

/**
 * The OAuth callback and session endpoints.
 *
 * Outside `/api/v1` deliberately: that surface is a versioned contract with a
 * generated OpenAPI document, and these routes belong to the auth library's
 * own protocol. Publishing them as part of the ledger's API would promise a
 * shape this project does not control.
 */
const handler = toNextJsHandler(auth());

export const POST = handler.POST;
export const GET = handler.GET;

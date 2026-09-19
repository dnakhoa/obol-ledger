import { defineRoute, json } from '@/server/http/route';
import { problem, problemResponse } from '@/server/http/problem';

type Params = { keyId: string };

/**
 * Revokes a key.
 *
 * DELETE, but the row stays: `revoked_at` is set and the resolve path filters
 * on it. A deleted row answers "who had access, and until when?" with silence,
 * which is the one question the audit trail exists for.
 *
 * Revoking an already-revoked key is a 404 rather than a silent success — the
 * caller believes they are closing a hole that someone else already closed,
 * and that distinction matters during an incident.
 */
export const DELETE = defineRoute<Params>(
  { name: 'api-keys.revoke', auth: true },
  async ({ params, requestId, services }) => {
    const revoked = await services.apiKeys.revoke(params.keyId);
    if (!revoked) {
      return problemResponse({
        ...problem(
          404,
          'api-key-not-found',
          'API key not found',
          'No active key with that id belongs to this tenant. It may already have been revoked.',
        ),
        requestId,
      });
    }
    return json({ data: revoked });
  },
);

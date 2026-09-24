'use server';

import { headers } from 'next/headers';
import { viewerServices } from '@/server/container';
import { db } from '@/server/db/client';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { logger } from '@/server/observability/logger';
import { isAttackId, type AttackResult } from '@/server/services/attacks';

export type AttackActionResult =
  | { readonly ok: true; readonly result: AttackResult }
  | { readonly ok: false; readonly reason: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly ok: false; readonly reason: 'failed' };

/**
 * Fires one attack at the viewer's own ledger — the published demo, for a
 * visitor who has not signed in.
 *
 * Open to anyone, deliberately: the point of the page is that a stranger can
 * try. That is safe because nothing an attack writes is ever committed, and
 * what a stranger *can* spend is database time, which the shared limiter
 * bounds. Counted in Postgres rather than in this process, because "run all
 * nine" from a script against a fleet of cold starts is exactly the case an
 * in-memory counter waves through.
 */
export async function runAttackAction(id: string): Promise<AttackActionResult> {
  if (!isAttackId(id)) return { ok: false, reason: 'failed' };

  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = await durableRateLimit(db(), `attack:${client}`, { limit: 45 });
  if (!decision.allowed) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  try {
    const { services } = await viewerServices();
    const result = await services.attacks.run(id);
    // A breach is the one outcome worth hearing about from a log: it means
    // a guard the README promises is missing from this database.
    if (result.verdict === 'breached') logger.error('attack.breached', { attack: id });
    return { ok: true, result };
  } catch (error) {
    logger.error('attack.failed', { attack: id, error });
    return { ok: false, reason: 'failed' };
  }
}

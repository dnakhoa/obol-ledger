'use server';

import { headers } from 'next/headers';
import { currentViewer } from '@/server/auth/viewer';
import { db } from '@/server/db/client';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { logger } from '@/server/observability/logger';
import { translations } from '@/server/i18n';
import { createSampleLedger } from '@/server/services/onboarding';

export type SampleLedgerState =
  { readonly status: 'done' } | { readonly status: 'error'; readonly message: string };

/**
 * Gives a visitor who has just started an anonymous session a sample ledger
 * of their own.
 *
 * Idempotent from the visitor's side: a second click, or a refresh halfway
 * through, finds the ledger already there and simply continues. Rate-limited
 * per address, because each call writes a quarter of books — cheap for a
 * person, and not something a script should be able to do in a loop.
 */
export async function startSampleLedgerAction(): Promise<SampleLedgerState> {
  const { t } = await translations();
  const viewer = await currentViewer();
  if (viewer.kind === 'member') return { status: 'done' };
  if (viewer.kind === 'guest') return { status: 'error', message: t.sample.failed };

  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = await durableRateLimit(db(), `sample-ledger:${client}`, { limit: 3 });
  if (!decision.allowed) {
    return { status: 'error', message: t.sample.tooMany(decision.retryAfterSeconds) };
  }

  try {
    await createSampleLedger({ userId: viewer.userId, name: t.sample.companyName });
    return { status: 'done' };
  } catch (error) {
    logger.error('sample_ledger.failed', { error });
    return { status: 'error', message: t.sample.failed };
  }
}

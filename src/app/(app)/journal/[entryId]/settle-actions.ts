'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { demoServices } from '@/server/container';
import { describe as describeError } from '@/server/domain/errors';
import { rateLimit } from '@/server/http/rate-limit';
import { logger } from '@/server/observability/logger';

export type SettleFormState = {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
};

/**
 * Settling or cancelling a pending entry from the UI.
 *
 * One action for both transitions, because they are the same decision seen
 * from two sides — did this authorisation complete, or not — and splitting
 * them would duplicate the rate limiting and error handling for no gain.
 */
export async function transitionEntryAction(
  _previous: SettleFormState,
  formData: FormData,
): Promise<SettleFormState> {
  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = rateLimit(`settle:${client}`, Date.now(), 30);
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many requests. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const transactionId = String(formData.get('transactionId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (!transactionId || (intent !== 'post' && intent !== 'archive')) {
    return { status: 'error', message: 'That action is not available for this entry.' };
  }

  const services = await demoServices();
  const result =
    intent === 'post'
      ? await services.journal.postPending(transactionId)
      : await services.journal.archivePending(transactionId);

  if (!result.ok) {
    logger.warn('ui.transition_rejected', { code: result.error.code, transactionId, intent });
    return { status: 'error', message: describeError(result.error) };
  }

  revalidatePath('/', 'layout');
  return {
    status: 'success',
    message: intent === 'post' ? 'Entry settled.' : 'Entry cancelled; nothing moved.',
  };
}

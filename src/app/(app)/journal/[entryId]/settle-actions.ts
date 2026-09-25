'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describeError, translations } from '@/server/i18n';
import { logger } from '@/server/observability/logger';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { db } from '@/server/db/client';

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
  const { locale, t } = await translations();
  const requestHeaders = await headers();
  const client = clientAddress(requestHeaders);
  const decision = await durableRateLimit(db(), `settle:${client}`, { limit: 30 });
  if (!decision.allowed) {
    return {
      status: 'error',
      message: t.forms.tooManyTransitions(decision.retryAfterSeconds),
    };
  }

  const transactionId = String(formData.get('transactionId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (!transactionId || (intent !== 'post' && intent !== 'archive')) {
    return { status: 'error', message: t.forms.transitionUnavailable };
  }

  const writer = await requireWriter();
  if (!writer.allowed) {
    return { status: 'error', message: await refusalMessage(writer.reason) };
  }
  const services = writer.services;
  const result =
    intent === 'post'
      ? await services.journal.postPending(transactionId)
      : await services.journal.archivePending(transactionId);

  if (!result.ok) {
    logger.warn('ui.transition_rejected', { code: result.error.code, transactionId, intent });
    return { status: 'error', message: describeError(result.error, locale) };
  }

  revalidatePath('/', 'layout');
  return {
    status: 'success',
    message: intent === 'post' ? t.forms.settled : t.forms.cancelledNothingMoved,
  };
}

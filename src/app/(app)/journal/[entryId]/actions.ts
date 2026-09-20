'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describe as describeError } from '@/server/domain/errors';
import { rateLimit } from '@/server/http/rate-limit';
import { logger } from '@/server/observability/logger';

export type ReverseFormState = {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  readonly reversalId?: string;
};

const reasonSchema = z.string().trim().min(1).max(280).optional();

/**
 * Posts a reversing entry from the UI.
 *
 * Deliberately not called "delete". Nothing is removed — a second entry is
 * written that cancels the first, and both stay on the record. Naming the
 * action after what it does is the difference between a user who understands
 * the ledger and one who is surprised by it later.
 */
export async function reverseEntryAction(
  _previous: ReverseFormState,
  formData: FormData,
): Promise<ReverseFormState> {
  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = rateLimit(`reverse:${client}`, Date.now(), 20);
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many reversals. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const transactionId = String(formData.get('transactionId') ?? '');
  if (!transactionId) return { status: 'error', message: 'No entry was specified.' };

  const reason = reasonSchema.safeParse(formData.get('reason')).data;

  const writer = await requireWriter();
  if (!writer.allowed) {
    return { status: 'error', message: refusalMessage(writer.reason) };
  }
  const services = writer.services;
  const result = await services.journal.reverseEntry({
    transactionId,
    ...(reason ? { description: reason } : {}),
  });

  if (!result.ok) {
    logger.warn('ui.reversal_rejected', { code: result.error.code, transactionId });
    return { status: 'error', message: describeError(result.error) };
  }

  revalidatePath('/', 'layout');

  return {
    status: 'success',
    message: `Reversed by ${result.value.transaction.id}.`,
    reversalId: result.value.transaction.id,
  };
}

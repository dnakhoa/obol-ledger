'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { createEntrySchema } from '@/server/http/schemas';
import { toDraftPostings } from '@/server/http/entries';
import { describeError, translations } from '@/server/i18n';
import { logger } from '@/server/observability/logger';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { db } from '@/server/db/client';

/**
 * Posting an entry from the UI.
 *
 * A Server Action rather than a `fetch` to our own API: the mutation is
 * triggered by our own form, so there is no reason to pay for a network hop,
 * and `revalidatePath` can refresh the affected pages as part of the same round
 * trip. Both paths funnel into the identical service call, so the rules cannot
 * differ between a browser and an API client.
 *
 * The form is submitted as repeated `accountId` / `direction` / `amount`
 * fields. FormData preserves their order, which keeps the composer working with
 * JavaScript disabled — no hidden JSON blob to serialise.
 */
export type EntryFormState = {
  readonly status: 'idle' | 'success' | 'error';
  readonly message?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
  readonly entryId?: string;
};

const textSchema = z.string().trim().min(1, 'Required');

export async function postEntryAction(
  _previous: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const { locale, t } = await translations();

  // Server Actions are a public endpoint like any other, so they get the same
  // abuse protection the HTTP routes have.
  const requestHeaders = await headers();
  const client = clientAddress(requestHeaders);
  const decision = await durableRateLimit(db(), `action:${client}`, { limit: 20 });
  if (!decision.allowed) {
    return {
      status: 'error',
      message: t.transfer.tooMany(decision.retryAfterSeconds),
    };
  }

  const accountIds = formData.getAll('accountId').map(String);
  const directions = formData.getAll('direction').map(String);
  const amounts = formData.getAll('amount').map(String);

  const candidate = {
    description: textSchema.safeParse(formData.get('description')).data ?? '',
    currency: String(formData.get('currency') ?? 'USD'),
    postings: accountIds
      .map((accountId, index) => ({
        accountId,
        direction: directions[index] ?? 'debit',
        amount: (amounts[index] ?? '').trim(),
      }))
      // Blank rows are the composer's empty slots, not an attempt to post zero.
      .filter((posting) => posting.accountId !== '' || posting.amount !== ''),
  };

  const parsed = createEntrySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      status: 'error',
      message: t.transfer.checkFields,
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    };
  }

  const converted = toDraftPostings(parsed.data, parsed.data.currency);
  if (!converted.ok) {
    return {
      status: 'error',
      message: t.transfer.notAnAmount(converted.index + 1, converted.amount, parsed.data.currency),
      fieldErrors: [
        {
          field: `postings.${converted.index}.amount`,
          message: t.transfer.notRepresentable(parsed.data.currency),
        },
      ],
    };
  }

  const writer = await requireWriter();
  if (!writer.allowed) {
    return { status: 'error', message: await refusalMessage(writer.reason) };
  }

  const result = await writer.services.journal.postEntry({
    // The layer that knows whose request this is, is the layer that says so.
    actor: { userId: writer.viewer.userId, via: 'ui' },
    description: parsed.data.description,
    currency: parsed.data.currency,
    postings: converted.postings,
  });

  if (!result.ok) {
    logger.warn('ui.entry_rejected', { code: result.error.code });
    return { status: 'error', message: describeError(result.error, locale) };
  }

  // Balances, the journal and the dashboard all moved; drop their caches.
  revalidatePath('/', 'layout');

  return {
    status: 'success',
    message: t.transfer.posted(result.value.transaction.id),
    entryId: result.value.transaction.id,
  };
}

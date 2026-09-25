'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { createApiKeySchema } from '@/server/http/schemas';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';
import { db } from '@/server/db/client';

export type ApiKeyFormState = {
  readonly status: 'idle' | 'error' | 'issued';
  readonly message?: string;
  /** Shown once, in the response to the request that created it. */
  readonly token?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
};

/**
 * Issues a key for the signed-in member's own ledger.
 *
 * Only a member who may write gets one — a guest looking at the demo is
 * refused by `requireWriter`. The quota is deliberately much tighter than the
 * rest, and counted across every instance: a key is a credential, and a
 * signed-in session that has been taken over should not be able to mint them
 * in bulk.
 */
const HOURLY_QUOTA = 5;

export async function issueApiKeyAction(
  _previous: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const requestHeaders = await headers();
  const client = clientAddress(requestHeaders);
  const decision = await durableRateLimit(db(), `apikey:${client}`, {
    limit: HOURLY_QUOTA,
    windowMs: 60 * 60 * 1000,
  });
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many keys issued from here. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const parsed = createApiKeySchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'The key needs a name you will recognise later.',
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    };
  }

  const writer = await requireWriter();
  if (!writer.allowed) {
    return { status: 'error', message: await refusalMessage(writer.reason, 'en') };
  }

  const issued = await writer.services.apiKeys.issue(parsed.data.name);
  revalidatePath('/settings');
  return {
    status: 'issued',
    message: `Issued “${issued.name}”.`,
    token: issued.token,
  };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const writer = await requireWriter();
  if (!writer.allowed) return;
  await writer.services.apiKeys.revoke(String(formData.get('keyId')));
  revalidatePath('/settings');
}

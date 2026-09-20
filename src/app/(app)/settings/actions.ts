'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { createApiKeySchema } from '@/server/http/schemas';
import { rateLimit } from '@/server/http/rate-limit';

export type ApiKeyFormState = {
  readonly status: 'idle' | 'error' | 'issued';
  readonly message?: string;
  /** Shown once, in the response to the request that created it. */
  readonly token?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
};

/**
 * Issues a key for the published demo tenant.
 *
 * Over the API this needs an existing key — minting a credential should
 * require one. The dashboard is the deliberate exception, because the demo
 * tenant's ledger already accepts writes from any visitor through these same
 * server actions; requiring a key to get a key would only mean nobody could
 * try the API. The quota is deliberately much tighter than the rest.
 */
const HOURLY_QUOTA = 5;

export async function issueApiKeyAction(
  _previous: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = rateLimit(`apikey:${client}`, Date.now(), HOURLY_QUOTA);
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
    return { status: 'error', message: refusalMessage(writer.reason) };
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

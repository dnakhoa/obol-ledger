'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { demoServices } from '@/server/container';
import { createAccountSchema } from '@/server/http/schemas';
import { rateLimit } from '@/server/http/rate-limit';
import { logger } from '@/server/observability/logger';

export type AccountFormState = {
  readonly status: 'idle' | 'error';
  readonly message?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
};

export async function createAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = rateLimit(`account:${client}`, Date.now(), 20);
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many accounts created. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const parsed = createAccountSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    currency: formData.get('currency'),
    overdraftAllowed: formData.get('overdraftAllowed') === 'on',
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'The account could not be opened. Check the highlighted fields.',
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    };
  }

  let accountId: string;
  try {
    const account = await (await demoServices()).accounts.create(parsed.data);
    accountId = account.id;
  } catch (error) {
    // `(org_id, name, currency)` is unique so a tenant cannot end up with two
    // accounts a human would read as the same one.
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: `An account named “${parsed.data.name}” already exists in ${parsed.data.currency}.`,
        fieldErrors: [{ field: 'name', message: 'Already in use' }],
      };
    }
    logger.error('ui.account_create_failed', { error });
    throw error;
  }

  revalidatePath('/', 'layout');
  // Redirect on success rather than returning a state the form has to render:
  // the useful next screen is the account that was just opened.
  redirect(`/accounts/${accountId}`);
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}

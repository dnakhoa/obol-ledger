'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { createAccountSchema } from '@/server/http/schemas';
import { rateLimit } from '@/server/http/rate-limit';
import { logger } from '@/server/observability/logger';
import { translations } from '@/server/i18n';

export type AccountFormState = {
  readonly status: 'idle' | 'error';
  readonly message?: string;
  readonly fieldErrors?: readonly { field: string; message: string }[];
};

export async function createAccountAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { t } = await translations();
  const requestHeaders = await headers();
  const client = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const decision = rateLimit(`account:${client}`, Date.now(), 20);
  if (!decision.allowed) {
    return {
      status: 'error',
      message: t.forms.tooManyAccounts(decision.retryAfterSeconds),
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
      message: t.forms.accountCheckFields,
      fieldErrors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'form',
        message: issue.message,
      })),
    };
  }

  let accountId: string;
  try {
    const writer = await requireWriter();
    if (!writer.allowed) {
      return { status: 'error', message: await refusalMessage(writer.reason) };
    }

    const account = await writer.services.accounts.create(parsed.data);
    accountId = account.id;
  } catch (error) {
    // `(org_id, name, currency)` is unique so a tenant cannot end up with two
    // accounts a human would read as the same one.
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: t.forms.accountExists(parsed.data.name, parsed.data.currency),
        fieldErrors: [{ field: 'name', message: t.forms.alreadyInUse }],
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

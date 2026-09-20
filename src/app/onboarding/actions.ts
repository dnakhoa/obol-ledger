'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentViewer } from '@/server/auth/viewer';
import { createLedger } from '@/server/services/onboarding';
import { SUPPORTED_CURRENCIES } from '@/lib/money';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  functionalCurrency: z.enum(SUPPORTED_CURRENCIES),
});

export type OnboardingState = {
  readonly status: 'idle' | 'error';
  readonly message?: string;
};

export async function createLedgerAction(
  _previous: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const viewer = await currentViewer();

  // A member already has a ledger. Creating a second here would be a
  // different feature with a different question attached ("which one am I
  // looking at?"), so this refuses rather than quietly making one.
  if (viewer.kind !== 'unenrolled') {
    return { status: 'error', message: 'This account already has a ledger.' };
  }

  const parsed = schema.safeParse({
    name: formData.get('name'),
    functionalCurrency: formData.get('functionalCurrency'),
  });

  if (!parsed.success) {
    return {
      status: 'error',
      message: 'A ledger needs a name and a currency to keep its books in.',
    };
  }

  await createLedger({
    userId: viewer.userId,
    name: parsed.data.name,
    functionalCurrency: parsed.data.functionalCurrency,
  });

  redirect('/');
}

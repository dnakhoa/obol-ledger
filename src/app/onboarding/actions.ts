'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentViewer } from '@/server/auth/viewer';
import { createLedger } from '@/server/services/onboarding';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { CHART_TEMPLATES } from '@/server/domain/chart';
import { viewerLocale } from '@/server/i18n';
import { db } from '@/server/db/client';
import { clientAddress } from '@/server/http/client-address';
import { durableRateLimit } from '@/server/http/durable-rate-limit';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  functionalCurrency: z.enum(SUPPORTED_CURRENCIES),
  chartTemplate: z.enum(CHART_TEMPLATES).default('generic'),
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

  // A sample session gets its books from the sample button, which is rate
  // limited; this path would otherwise hand an anonymous script a new empty
  // ledger per sign-in, as fast as it could ask.
  if (viewer.sample) {
    return { status: 'error', message: 'Sign in to set up a ledger of your own.' };
  }

  const decision = await durableRateLimit(db(), `ledger:${clientAddress(await headers())}`, {
    limit: 5,
  });
  if (!decision.allowed) {
    return {
      status: 'error',
      message: `Too many ledgers set up from here. Try again in ${decision.retryAfterSeconds} seconds.`,
    };
  }

  const parsed = schema.safeParse({
    name: formData.get('name'),
    functionalCurrency: formData.get('functionalCurrency'),
    chartTemplate: formData.get('chartTemplate') ?? 'generic',
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
    chartTemplate: parsed.data.chartTemplate,
    // The books are kept in the language the person set them up in; see the
    // note on `CreateLedgerInput.locale`.
    locale: await viewerLocale(),
  });

  redirect('/');
}

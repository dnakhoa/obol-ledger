import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentViewer } from '@/server/auth/viewer';
import { OnboardingForm } from '@/components/onboarding-form';
import { createLedgerAction } from './actions';
import { ScaleIcon } from '@/components/icons';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { CHART_TEMPLATE_DEFINITIONS } from '@/server/domain/chart';

export const metadata: Metadata = { title: 'Create your ledger' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const viewer = await currentViewer();
  if (viewer.kind === 'guest') redirect('/sign-in');
  if (viewer.kind === 'member') redirect('/');

  const firstName = viewer.name.split(' ')[0] ?? 'there';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <span className="bg-action text-action-ink mx-auto flex size-10 items-center justify-center rounded-xl">
          <ScaleIcon width={20} height={20} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        <p className="text-ink-secondary text-sm">
          One question before you start, because it is the one that cannot be changed later.
        </p>
      </div>

      <OnboardingForm
        action={createLedgerAction}
        currencies={SUPPORTED_CURRENCIES}
        templates={Object.values(CHART_TEMPLATE_DEFINITIONS).map((template) => ({
          id: template.id,
          label: template.label,
          summary: template.summary,
          statutory: template.statutory,
        }))}
        suggestedName={`${firstName}'s books`}
      />
    </main>
  );
}

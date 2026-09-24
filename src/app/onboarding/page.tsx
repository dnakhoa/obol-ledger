import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentViewer } from '@/server/auth/viewer';
import { OnboardingForm } from '@/components/onboarding-form';
import { translations } from '@/server/i18n';
import { createLedgerAction } from './actions';
import { ScaleIcon } from '@/components/icons';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { CHART_TEMPLATE_DEFINITIONS } from '@/server/domain/chart';

export const metadata: Metadata = { title: 'Create your ledger' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const { t } = await translations();
  const viewer = await currentViewer();
  if (viewer.kind === 'guest') redirect('/sign-in');
  if (viewer.kind === 'member') redirect('/');

  const firstName = viewer.name.split(' ')[0] ?? '';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <span className="bg-action text-action-ink mx-auto flex size-10 items-center justify-center rounded-xl">
          <ScaleIcon width={20} height={20} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{t.misc.welcome(firstName)}</h1>
        <p className="text-ink-secondary text-sm">{t.misc.onboardingIntro}</p>
      </div>

      <OnboardingForm
        labels={{
          yourLedger: t.forms.yourLedger,
          starterChart: t.misc.starterChartNote,
          name: t.forms.ledgerName,
          nameHint: t.forms.ledgerNameHint,
          chartOfAccounts: t.forms.chartOfAccounts,
          currency: t.forms.functionalCurrency,
          currencyHint: t.forms.functionalCurrencyHint,
          creating: t.forms.creating,
          submit: t.forms.createLedger,
          failed: t.forms.somethingWrong,
          chartIsAStart: t.misc.chartIsAStart,
        }}
        action={createLedgerAction}
        currencies={SUPPORTED_CURRENCIES}
        templates={Object.values(CHART_TEMPLATE_DEFINITIONS).map((template) => ({
          id: template.id,
          label: template.label,
          summary: template.summary,
          statutory: template.statutory,
        }))}
        suggestedName={t.misc.suggestedLedgerName(firstName)}
      />
    </main>
  );
}

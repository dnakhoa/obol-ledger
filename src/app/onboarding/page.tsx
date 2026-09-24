import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentViewer } from '@/server/auth/viewer';
import { OnboardingForm } from '@/components/onboarding-form';
import { translations } from '@/server/i18n';
import { createLedgerAction } from './actions';
import { ScaleIcon } from '@/components/icons';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/money';
import type { Locale } from '@/lib/i18n';
import { CHART_TEMPLATE_DEFINITIONS, type ChartTemplate } from '@/server/domain/chart';

export const metadata: Metadata = { title: 'Create your ledger' };
export const dynamic = 'force-dynamic';

/**
 * What a person reading in each language most likely keeps books under, first.
 *
 * A Vietnamese small business is on Thông tư 133 far more often than 200, a
 * Japanese one on the Japanese chart, and an English reader — this product's
 * first market being Australia and New Zealand — on AU/NZ. The first option
 * is the preselected one, so the common case is one click; every option is
 * still there.
 */
const CHART_ORDER: Record<Locale, readonly ChartTemplate[]> = {
  vi: ['vn_tt133', 'vn_tt200', 'generic', 'au_nz', 'jp', 'us_gaap'],
  ja: ['jp', 'generic', 'au_nz', 'us_gaap', 'vn_tt133', 'vn_tt200'],
  en: ['au_nz', 'generic', 'us_gaap', 'jp', 'vn_tt133', 'vn_tt200'],
};

const DEFAULT_CURRENCY: Record<Locale, CurrencyCode> = { vi: 'VND', ja: 'JPY', en: 'AUD' };

export default async function OnboardingPage() {
  const { locale, t } = await translations();
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
          statutory: t.onboarding.statutory,
        }}
        action={createLedgerAction}
        currencies={SUPPORTED_CURRENCIES}
        templates={CHART_ORDER[locale].map((id) => ({
          id,
          label: CHART_TEMPLATE_DEFINITIONS[id].label,
          summary: t.onboarding.charts[id],
          statutory: CHART_TEMPLATE_DEFINITIONS[id].statutory,
        }))}
        defaultCurrency={DEFAULT_CURRENCY[locale]}
        suggestedName={t.misc.suggestedLedgerName(firstName)}
      />
    </main>
  );
}

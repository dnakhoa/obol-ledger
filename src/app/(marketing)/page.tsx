import type { Metadata } from 'next';
import type { StaticImageData } from 'next/image';
import { redirect } from 'next/navigation';
import { translations } from '@/server/i18n';
import { signedInViewer } from '@/server/auth/viewer';
import { landingRedirect } from '@/server/auth/landing';
import { TrySample } from '@/components/try-sample';
import { LandingNav } from '@/components/landing/landing-nav';
import { Hero } from '@/components/landing/hero';
import { Features, type FeatureKey } from '@/components/landing/features';
import { MoreFeatures } from '@/components/landing/more-features';
import { Trust } from '@/components/landing/trust';
import { Developers } from '@/components/landing/developers';
import { ClosingCta } from '@/components/landing/closing-cta';
import { LandingFooter } from '@/components/landing/landing-footer';
import { startSampleLedgerAction } from '@/server/actions/sample-ledger';
import overview from './_assets/overview-dark.png';
import sales from './_assets/sales-dark.png';
import stock from './_assets/stock-dark.png';
import bank from './_assets/bank-dark.png';
import tax from './_assets/tax-dark.png';

/** The demo's own screens, taken from the seeded sample company in dark mode. */
const SCREENSHOTS: Record<FeatureKey, StaticImageData> = { sales, stock, bank, tax };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return {
    // Absolute: the layout's "%s · Obol Ledger" would name the product twice.
    title: { absolute: t.landing.metaTitle },
    description: t.landing.metaDescription,
  };
}

// Per request: the words come from the locale cookie, and a signed-in
// visitor is sent on to their books.
export const dynamic = 'force-dynamic';
// The sample-ledger button on this page writes a quarter of books.
export const maxDuration = 60;

/**
 * The landing page.
 *
 * A Server Component that does three things: steps aside for anyone with
 * somewhere better to be (`landingRedirect`), picks the words for this
 * visitor's language, and hands each section the slice of them it shows.
 * Every section is a Server Component too; the only JavaScript this page
 * ships is the language toggle and the sample button.
 *
 * In the order a visitor's questions come: what is it, what does it do, why
 * should I believe the numbers, can I run it myself, how do I try it.
 */
export default async function LandingPage() {
  const elsewhere = landingRedirect(await signedInViewer());
  if (elsewhere) redirect(elsewhere);

  const { locale, t } = await translations();
  const copy = t.landing;

  // Built once and placed twice. Each placement is its own instance with its
  // own pending state; they share only the action they call.
  const trySample = (
    <TrySample
      start={startSampleLedgerAction}
      variant="brand"
      className="w-full sm:w-auto"
      labels={{ start: t.sample.start, working: t.sample.working, failed: t.sample.failed }}
    />
  );

  return (
    <div data-theme-lock="dark" className="bg-canvas text-ink min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only-focusable bg-action text-action-ink fixed top-3 left-3 z-50 rounded-lg px-3 py-2 text-sm font-medium"
      >
        {t.common.skipToContent}
      </a>
      <LandingNav copy={copy.nav} locale={locale} languageLabel={t.common.language} />

      <main id="main">
        <Hero copy={copy.hero} primaryAction={trySample} screenshot={overview} />
        <Features copy={copy.features} screenshots={SCREENSHOTS} />
        <MoreFeatures copy={copy.more} />
        <Trust copy={copy.trust} />
        <Developers copy={copy.developers} />
        <ClosingCta copy={copy.closing} primaryAction={trySample} />
      </main>

      <LandingFooter copy={copy.footer} locale={locale} languageLabel={t.common.language} />
    </div>
  );
}

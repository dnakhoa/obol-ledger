import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { translations } from '@/server/i18n';
import { signedInViewer } from '@/server/auth/viewer';
import { landingRedirect } from '@/server/auth/landing';
import { LOCALES } from '@/lib/i18n';
import { TrySample } from '@/components/try-sample';
import { LandingNav } from '@/components/landing/landing-nav';
import { Hero } from '@/components/landing/hero';
import { ProofStats, type Figure } from '@/components/landing/proof-stats';
import { ProductReveal } from '@/components/landing/product-reveal';
import { BalanceSection } from '@/components/landing/balance-section';
import { Guarantees } from '@/components/landing/guarantees';
import { Capabilities } from '@/components/landing/capabilities';
import { Engineering } from '@/components/landing/engineering';
import { ClosingCta } from '@/components/landing/closing-cta';
import { LandingFooter } from '@/components/landing/landing-footer';
import { startSampleLedgerAction } from '@/server/actions/sample-ledger';
import overview from './_assets/overview-dark.png';

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
 * The two numbers on the page nothing in the code can count: the suite's
 * total (README, "Tests that run the real schema"), rounded down, and the
 * files in `docs/adr/`. The rest are derived below from what they describe,
 * so they cannot drift from it.
 */
const TESTS = 1100;
const DECISIONS = 27;

/**
 * The landing page.
 *
 * A Server Component that does three things: steps aside for anyone with
 * somewhere better to be (`landingRedirect`), picks the words for this visitor's language, and hands each
 * section the slice of them it shows. Every section is a Server Component
 * too; the only JavaScript this page ships is the terminal, the balance
 * check, the card spotlight, the language toggle and the sample button.
 */
export default async function LandingPage() {
  const elsewhere = landingRedirect(await signedInViewer());
  if (elsewhere) redirect(elsewhere);

  const { locale, t } = await translations();
  const copy = t.landing;
  const count = new Intl.NumberFormat(locale);
  const attacks = Object.keys(t.breakIt.attacks).length;

  const figures: readonly Figure[] = [
    { key: 'tests', value: `${count.format(TESTS)}+` },
    // Every attack the attack page lists, refused: the page's own promise.
    { key: 'attacks', value: `${attacks}/${attacks}` },
    { key: 'decisions', value: count.format(DECISIONS) },
    { key: 'languages', value: count.format(LOCALES.length) },
    // Every attack ends in ROLLBACK, including one that gets through.
    { key: 'rowsKept', value: count.format(0) },
  ];

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
        <Hero copy={copy.hero} primaryAction={trySample} />
        <ProofStats copy={copy.stats} figures={figures} />
        <ProductReveal copy={copy.product} screenshot={overview} />
        <BalanceSection copy={copy.balance} locale={locale} />
        <Guarantees
          copy={copy.guarantees}
          attacks={t.breakIt.attacks}
          verdicts={{ refused: t.breakIt.verdictRefused, held: t.breakIt.verdictHeld }}
        />
        <Capabilities copy={copy.features} />
        <Engineering copy={copy.engineering} />
        <ClosingCta copy={copy.closing} primaryAction={trySample} />
      </main>

      <LandingFooter copy={copy.footer} locale={locale} languageLabel={t.common.language} />
    </div>
  );
}

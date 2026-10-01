import Link from 'next/link';
import type { Locale, Messages } from '@/lib/i18n';
import { ButtonLink } from '@/components/ui/button';
import { LanguageToggle } from '@/components/language-toggle';
import { Wordmark } from './wordmark';

/** In-page anchors: plain `<a>`, since they leave neither the page nor the router. */
const ANCHORS = ['guarantees', 'features', 'engineering'] as const;

/**
 * The bar across the top: where you are, where to jump, and the way in.
 *
 * Floating and translucent so the hero's light runs under it. The section
 * links fold away on a phone, where the page is one thumb-scroll and the
 * only thing worth a tap in the bar is the demo.
 */
export function LandingNav({
  copy,
  locale,
  languageLabel,
}: {
  copy: Messages['landing']['nav'];
  locale: Locale;
  languageLabel: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-4">
      <nav
        aria-label={copy.label}
        className="border-line/70 bg-canvas/70 mx-auto flex h-14 w-full max-w-6xl items-center gap-6 rounded-2xl border pr-2 pl-4 shadow-[var(--shadow-raised)] backdrop-blur-xl"
      >
        <Link href="/" className="shrink-0 rounded-md">
          <Wordmark />
        </Link>

        <ul className="text-ink-secondary hidden items-center gap-1 text-sm md:flex">
          {ANCHORS.map((anchor) => (
            <li key={anchor}>
              <a
                href={`#${anchor}`}
                className="hover:text-ink hover:bg-surface-hover rounded-md px-3 py-2 transition-colors duration-150"
              >
                {copy[anchor]}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LanguageToggle current={locale} label={languageLabel} />
          </div>
          <ButtonLink href="/overview" variant="primary">
            {copy.openDemo}
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

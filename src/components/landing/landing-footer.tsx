import Link from 'next/link';
import type { Locale, Messages } from '@/lib/i18n';
import { LanguageToggle } from '@/components/language-toggle';
import { Wordmark } from './wordmark';

const SOURCE = 'https://github.com/dnakhoa/obol-ledger';

export function LandingFooter({
  copy,
  locale,
  languageLabel,
}: {
  copy: Messages['landing']['footer'];
  locale: Locale;
  languageLabel: string;
}) {
  const links = [
    { href: '/overview', label: copy.demo },
    { href: '/break', label: copy.breakIt },
    { href: '/api-reference', label: copy.api },
  ] as const;

  return (
    <footer className="border-line border-t px-4 py-12 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Wordmark />
          <p className="text-ink-secondary max-w-xs text-sm">{copy.tagline}</p>
          <p className="text-ink-muted text-xs">{copy.licence}</p>
        </div>

        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-16">
          <ul className="text-ink-secondary space-y-1 text-sm">
            {links.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="hover:text-ink inline-block py-1.5 transition-colors duration-150"
                >
                  {label}
                </Link>
              </li>
            ))}
            <li>
              {/* Leaves the site, so a plain anchor rather than the router's Link. */}
              <a
                href={SOURCE}
                rel="noopener noreferrer"
                className="hover:text-ink inline-block py-1.5 transition-colors duration-150"
              >
                {copy.source}
              </a>
            </li>
          </ul>
          <LanguageToggle current={locale} label={languageLabel} />
        </div>
      </div>
    </footer>
  );
}

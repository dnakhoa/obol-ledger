'use client';

import { usePathname } from 'next/navigation';
import { LOCALES, LOCALE_NAMES, LOCALE_SHORT, type Locale } from '@/lib/i18n';
import { setLocaleAction } from '@/server/actions/locale';
import { cn } from '@/lib/cn';

/**
 * The language switch, as two buttons rather than a dropdown.
 *
 * Two languages do not need a menu, and a menu hides the fact that the other
 * one exists — which, for somebody who cannot read the language currently on
 * screen, is the whole problem. Each option is labelled in its own language,
 * because "Vietnamese" is not a word a Vietnamese reader is looking for.
 *
 * A plain `<form>` posting to a server action, so it works before any
 * JavaScript arrives. The only reason this is a Client Component at all is
 * `usePathname`: the action has to send the viewer back to the page they were
 * reading, and a Server Component cannot see which page that is.
 *
 * Why a redirect rather than `revalidatePath` alone: every page's text came
 * from the cookie this just changed, so the whole router cache is stale, and
 * revalidating it does not make the client throw away a payload it already
 * holds. Navigating does.
 */
export function LanguageToggle({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname();

  return (
    <div
      role="group"
      aria-label={label}
      className="border-line bg-surface-sunken inline-flex rounded-lg border p-0.5"
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <form key={locale} action={setLocaleAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={pathname} />
            <button
              type="submit"
              // `aria-pressed` rather than `aria-current`: this is a setting
              // being toggled, not a position within a set of pages.
              aria-pressed={active}
              title={LOCALE_NAMES[locale]}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150',
                active ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
              )}
            >
              <span aria-hidden="true">{LOCALE_SHORT[locale]}</span>
              <span className="sr-only">{LOCALE_NAMES[locale]}</span>
            </button>
          </form>
        );
      })}
    </div>
  );
}

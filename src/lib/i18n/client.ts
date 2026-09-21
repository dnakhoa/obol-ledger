import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locales';

/**
 * The viewer's language, read in the browser.
 *
 * Exists for exactly one caller: the error boundary. Next gives an
 * `error.tsx` only `{ error, reset }` — it cannot receive a prop from the
 * layout, and it is a Client Component so it cannot read the cookie the way
 * every other component here does.
 *
 * The alternative was to leave the one string on that page in English, which
 * is the page a person reaches when something has already gone wrong and is
 * the worst moment to stop speaking their language.
 *
 * Deliberately not used anywhere else. Every other component takes its words
 * from the server, which is what keeps the dictionaries out of the bundle.
 */
export function browserLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;

  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);

  return isLocale(match) ? match : DEFAULT_LOCALE;
}

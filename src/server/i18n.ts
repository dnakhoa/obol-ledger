import 'server-only';

import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  messagesFor,
  negotiate,
  type Locale,
  type Messages,
} from '@/lib/i18n';

/**
 * The viewer's language, resolved on the server.
 *
 * On the server rather than in the browser, which is the one structural
 * difference from the theme switcher beside it — and the reason the two use
 * different storage. A theme is a handful of CSS variables, so getting it
 * wrong for one frame is a flash of the wrong colour that a blocking script in
 * `<head>` can fix from `localStorage`. Language is the *text*, rendered into
 * the HTML on the server. Sending English and swapping it after hydration
 * would mean shipping every dictionary to every visitor and watching the whole
 * page re-word itself. So it is a cookie, which arrives with the request.
 *
 * See `docs/adr/0014-two-locales.md`.
 */
export async function viewerLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;

  // Nobody has chosen yet, so guess from the browser and let the toggle — which
  // is always visible — correct a bad guess in one click.
  const header = await headers();
  return negotiate(header.get('accept-language'));
}

/** The messages for this request, with the locale that produced them. */
export async function translations(): Promise<{ locale: Locale; t: Messages }> {
  const locale = await viewerLocale();
  return { locale, t: messagesFor(locale) };
}

export { DEFAULT_LOCALE };

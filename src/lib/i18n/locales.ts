/**
 * The languages the interface speaks, which is not the same question as the
 * language a set of books is kept in.
 *
 * Those two are independent and conflating them is the bug this module exists
 * to avoid. A Vietnamese exporter keeps their accounts in Vietnamese — `632
 * Giá vốn hàng bán` is what the account is *called*, by law and by habit — and
 * an auditor from their Australian customer reading those books wants the
 * buttons and column headings in English. Neither of them wants a name like
 * "Giá vốn hàng bán — cost of goods sold", which is not a name in either
 * language.
 *
 * So: the **viewer's** locale picks the interface language, and the
 * **tenant's** locale decides what language the ledger writes in when it
 * generates a description for itself. See `docs/adr/0014-two-locales.md`.
 */

export const LOCALES = ['en', 'vi', 'ja'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language named in itself, which is the only name its speakers recognise. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
  ja: '日本語',
};

/** Short label for a toggle that has to fit beside a theme switcher. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  vi: 'VI',
  ja: 'JA',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The cookie, read on the server so the first paint is already in the right language. */
export const LOCALE_COOKIE = 'obol-locale';

/**
 * The best match for an `Accept-Language` header, for somebody who has never
 * chosen.
 *
 * Deliberately crude: the primary subtag only, first match wins. Quality
 * values and regional variants would let this pick `vi-VN` over `vi`, which
 * are the same language for our purposes, and getting the default slightly
 * wrong costs one click on a toggle that is always visible.
 */
export function negotiate(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase().split('-')[0];
    if (isLocale(tag)) return tag;
  }

  return DEFAULT_LOCALE;
}

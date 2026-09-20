import type { Locale } from './locales';

/**
 * Dates, in the form each language actually writes them.
 *
 * Not `Intl.DateTimeFormat(locale)` with a style and a shrug. Vietnamese
 * `dateStyle: 'medium'` produces `17 thg 3, 2026` — correct by CLDR and not
 * what anybody writes on a delivery note, which is `17/03/2026`. A date
 * someone has to stop and parse is a date they will eventually misread, and
 * this is an application where misreading a date moves a figure into the wrong
 * month.
 *
 * Day-first in both languages, deliberately. Every market this ledger ships a
 * chart of accounts for — Vietnam, Australia, New Zealand, the EU — writes the
 * day first, and the one that does not is the one whose readers are most
 * likely to be looking at somebody else's books. `10/01/2026` is the tenth of
 * January here, on screen and in the spreadsheet importer alike.
 */

const TAGS: Record<Locale, string> = { en: 'en-GB', vi: 'vi-VN' };

const VI_MONTH = (month: number) => `Tháng ${month}`;

export type DateFormats = {
  /** `17 Mar 2026` / `17/03/2026` — a row in a table. */
  readonly day: (value: Date) => string;
  /** `March 2026` / `Tháng 3/2026` — an accounting period. */
  readonly month: (value: Date) => string;
  /** `17 March 2026` / `17/03/2026` — a heading. */
  readonly full: (value: Date) => string;
  /** `14:05` in both; a 24-hour clock needs no translating. */
  readonly time: (value: Date) => string;
  /** `2026` */
  readonly year: (value: Date) => string;
  /** Thousands separators, which differ: `1,234,567` against `1.234.567`. */
  readonly number: (value: number | bigint) => string;
};

export function dateFormats(locale: Locale): DateFormats {
  const tag = TAGS[locale] ?? TAGS.en;
  const utc = { timeZone: 'UTC' } as const;

  const dayEn = new Intl.DateTimeFormat(tag, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...utc,
  });
  const fullEn = new Intl.DateTimeFormat(tag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...utc,
  });
  const monthEn = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', ...utc });
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...utc,
  });
  const year = new Intl.DateTimeFormat(tag, { year: 'numeric', ...utc });
  const number = new Intl.NumberFormat(tag);

  if (locale !== 'vi') {
    return {
      day: (value) => dayEn.format(value),
      month: (value) => monthEn.format(value),
      full: (value) => fullEn.format(value),
      time: (value) => time.format(value),
      year: (value) => year.format(value),
      number: (value) => number.format(value),
    };
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const numeric = (value: Date) =>
    `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;

  return {
    day: numeric,
    // `Tháng 3/2026`, which is how a Vietnamese accountant writes a period —
    // not `tháng 3, 2026`, which is how CLDR writes a month in a sentence.
    month: (value) => `${VI_MONTH(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`,
    full: numeric,
    time: (value) => time.format(value),
    year: (value) => String(value.getUTCFullYear()),
    number: (value) => number.format(value),
  };
}

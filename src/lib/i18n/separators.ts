import { DEFAULT_LOCALE, type Locale } from './locales';

/**
 * How a language writes a large number.
 *
 * `71.605.457.995` and `71,605,457,995` are the same figure, and a Vietnamese
 * reader shown the second one has to stop and check which mark means what. In
 * an application whose entire argument is that a misread figure is the enemy,
 * that is not a cosmetic difference.
 *
 * Given as *marks* rather than as an `Intl.NumberFormat`, because money here
 * is an exact decimal string and must never go through a JavaScript `number`
 * to get formatted. `Intl` takes a number; by the time it has one, the
 * precision the whole backend exists to protect is already gone. So the
 * grouping is done as text and this supplies the two characters it needs.
 */
export type Separators = {
  /** Between groups of three digits. */
  readonly group: string;
  /** Before the fractional part. */
  readonly decimal: string;
};

const SEPARATORS: Record<Locale, Separators> = {
  en: { group: ',', decimal: '.' },
  // Vietnamese uses the marks the other way round, which is also why a CSV
  // exported there is semicolon-separated — the comma is already taken.
  vi: { group: '.', decimal: ',' },
  // Japanese groups in thousands with commas, like English. The 万/億 grouping
  // people read aloud is not how a figure is written on a ledger.
  ja: { group: ',', decimal: '.' },
};

export function separatorsFor(locale: Locale): Separators {
  return SEPARATORS[locale] ?? SEPARATORS[DEFAULT_LOCALE];
}

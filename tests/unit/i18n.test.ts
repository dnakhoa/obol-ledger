import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/messages/en';
import { vi } from '@/lib/i18n/messages/vi';
import { ja } from '@/lib/i18n/messages/ja';
import { dateFormats, negotiate, isLocale, LOCALES } from '@/lib/i18n';
import { ledgerMessages } from '@/lib/i18n/ledger';

/**
 * The type checker already guarantees that every key is present in every
 * language and that a message taking an argument takes it everywhere. What it
 * cannot see is whether a translation was left as the English, or whether a
 * date comes out in the form the reader expects.
 */
describe('message catalogues', () => {
  /** Every leaf of the tree, as a path plus its value in each language. */
  function leaves(
    a: unknown,
    b: unknown,
    path: string[] = [],
  ): { path: string; en: string; vi: string }[] {
    if (typeof a === 'string' && typeof b === 'string') {
      return [{ path: path.join('.'), en: a, vi: b }];
    }
    if (typeof a === 'function' && typeof b === 'function') {
      // Called with filler arguments so the surrounding sentence is compared,
      // not just the placeholder.
      const args = Array.from({ length: a.length }, (_, i) => (i === 0 ? 'X' : 1));
      return [
        {
          path: path.join('.'),
          en: String((a as (...x: unknown[]) => string)(...args)),
          vi: String((b as (...x: unknown[]) => string)(...args)),
        },
      ];
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      return Object.keys(a as object).flatMap((key) =>
        leaves((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], [
          ...path,
          key,
        ]),
      );
    }
    return [];
  }

  /** Every translated language, checked against English the same way. */
  const TRANSLATIONS = { vi, ja } as const;

  it('has something to compare', () => {
    expect(leaves(en, vi).length).toBeGreaterThan(150);
  });

  /**
   * Identical strings are where an untranslated key hides.
   *
   * A handful are identical on purpose — `Obol` is a name, `API` and
   * `Webhook` are used as-is in Vietnamese — so they are listed rather than
   * the rule being dropped. Adding a key and forgetting to translate it fails
   * here instead of shipping an English word into a Vietnamese sentence.
   */
  const DELIBERATELY_IDENTICAL = new Set([
    'common.appName',
    'nav.api',
    'nav.webhooks',
    // The file format's own name, the same in every language.
    'einvoice.download',
    'stock.methodAverageOption',
    'stockImport.colProductCodeHint',
    'stockImport.colQuantityHint',
  ]);

  it.each(Object.keys(TRANSLATIONS))(
    'translates everything in %s that is not a proper noun',
    (language) => {
      const untranslated = leaves(en, TRANSLATIONS[language as keyof typeof TRANSLATIONS])
        .filter((pair) => pair.en === pair.vi && !DELIBERATELY_IDENTICAL.has(pair.path))
        .map((pair) => `${pair.path}: ${pair.en}`);

      expect(untranslated).toEqual([]);
    },
  );

  it.each(Object.keys(TRANSLATIONS))('leaves no placeholder unfilled in %s', (language) => {
    // A translator copying the English `${count}` literally is a common slip
    // and renders as the source text on screen.
    const broken = leaves(en, TRANSLATIONS[language as keyof typeof TRANSLATIONS])
      .filter((pair) => /\$\{|\{\{/u.test(pair.vi))
      .map((pair) => pair.path);
    expect(broken).toEqual([]);
  });
});

describe('dates', () => {
  const when = new Date(Date.UTC(2026, 0, 10, 14, 5));

  it('writes a Vietnamese date the way a delivery note does', () => {
    // Not `10 thg 1, 2026`, which is what CLDR produces and what nobody
    // writes by hand.
    expect(dateFormats('vi').day(when)).toBe('10/01/2026');
    expect(dateFormats('vi').month(when)).toBe('Tháng 1/2026');
  });

  it('is day-first in English too', () => {
    // Every market this ledger ships a chart for writes the day first, and
    // the reader most likely to be looking at somebody else's books is the
    // one whose own convention is month-first.
    expect(dateFormats('en').day(when)).toBe('10 Jan 2026');
  });

  it('writes a Japanese date largest unit first', () => {
    expect(dateFormats('ja').day(when)).toBe('2026/01/10');
    expect(dateFormats('ja').month(when)).toBe('2026年1月');
    expect(dateFormats('ja').full(when)).toBe('2026年1月10日');
  });

  it('groups thousands the way each language does', () => {
    expect(dateFormats('en').number(1234567)).toBe('1,234,567');
    expect(dateFormats('vi').number(1234567)).toBe('1.234.567');
    // Japanese groups in thousands with commas, like English — the 万/億
    // grouping people read aloud is not how a figure is written on a ledger.
    expect(dateFormats('ja').number(1234567)).toBe('1,234,567');
  });

  it('uses a 24-hour clock in both, which needs no translating', () => {
    expect(dateFormats('en').time(when)).toBe('14:05');
    expect(dateFormats('vi').time(when)).toBe('14:05');
  });
});

describe('the language the books are kept in', () => {
  it('names the costing entry as Thông tư 200 does', () => {
    // `Giá vốn hàng bán` is account 632's name in the circular. A literal
    // translation of "cost of goods sold" would be understood and would still
    // read as something a foreign system wrote.
    expect(ledgerMessages('vi').costOfGoodsSold('Đá lát granite', 'CONT-4417')).toBe(
      'Giá vốn hàng bán: Đá lát granite (CONT-4417)',
    );
    expect(ledgerMessages('en').costOfGoodsSold('Granite paver')).toBe(
      'Cost of goods sold: Granite paver',
    );
    // 売上原価 is the account name, and the reference sits in full-width
    // parentheses because those are what pair correctly with full-width text.
    expect(ledgerMessages('ja').costOfGoodsSold('御影石平板', 'CONT-4417')).toBe(
      '売上原価：御影石平板（CONT-4417）',
    );
  });
});

describe('negotiation', () => {
  it('reads the primary subtag and ignores the region', () => {
    expect(negotiate('vi-VN,vi;q=0.9,en;q=0.8')).toBe('vi');
    expect(negotiate('en-AU,en;q=0.9')).toBe('en');
    expect(negotiate('ja-JP,ja;q=0.9,en;q=0.8')).toBe('ja');
  });

  it('falls back rather than guessing at a language we do not have', () => {
    expect(negotiate('fr-FR,fr;q=0.9')).toBe('en');
    expect(negotiate(null)).toBe('en');
    expect(negotiate('')).toBe('en');
  });

  it('accepts exactly the locales it ships', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('th')).toBe(false);
  });
});

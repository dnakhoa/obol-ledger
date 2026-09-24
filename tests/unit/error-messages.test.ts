import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n';
import { describe as describeInEnglish, type LedgerError } from '@/server/domain/errors';
import { describeError } from '@/server/i18n';
import { EVERY_VARIANT } from '../helpers/ledger-errors';

/**
 * The ledger's refusals, as the dashboard shows them.
 *
 * The type checker already refuses a variant with no Vietnamese or Japanese
 * entry. What it cannot see is an entry that is the English pasted in to make
 * the build pass, or one that renders a figure the reader will misread.
 */

const variants = Object.values(EVERY_VARIANT);
const cases = LOCALES.flatMap((locale) => variants.map((error) => ({ locale, error })));

describe('ledger errors in the reader’s language', () => {
  it.each(cases)('renders $error.code in $locale', ({ locale, error }) => {
    const text = describeError(error, locale);

    expect(text.trim().length).toBeGreaterThan(10);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('[object');
  });

  it.each(variants)('keeps the API’s own sentence for $code in English', (error) => {
    expect(describeError(error, 'en')).toBe(describeInEnglish(error));
  });

  it.each(LOCALES.filter((locale) => locale !== 'en'))(
    'translates every refusal into %s rather than passing the English through',
    (locale) => {
      const untranslated = variants
        .filter((error) => describeError(error, locale) === describeInEnglish(error))
        .map((error) => error.code);

      expect(untranslated).toEqual([]);
    },
  );

  it('writes money with the reader’s separators, as the rest of the page does', () => {
    const funds = EVERY_VARIANT.insufficient_funds;

    expect(describeError(funds, 'vi')).toContain('10,00 USD');
    expect(describeError(funds, 'vi')).toContain('25,00 USD');
    expect(describeError(funds, 'ja')).toContain('10.00 USD');
  });

  it('writes quantities as the stock screens do, whatever the language', () => {
    // The stock pages show `24.687` in every language, so an error beside them
    // must too. Grouping it as Vietnamese money would turn 24.687 tonnes into
    // something that reads as twenty-four thousand.
    for (const locale of LOCALES) {
      const text = describeError(EVERY_VARIANT.insufficient_stock, locale);
      expect(text).toContain('12.000');
      expect(text).toContain('24.687');
    }
  });

  it('names a period the way the month-end screen does', () => {
    const closed: LedgerError = { code: 'period_already_closed', periodMonth: '2026-08-01' };

    expect(describeError(closed, 'vi')).toContain('tháng 8/2026');
    expect(describeError(closed, 'ja')).toContain('2026年8月');
  });

  it('keeps both branches of a variant that has two sentences', () => {
    const withAccount: LedgerError = {
      code: 'currency_mismatch',
      expected: 'EUR',
      received: 'USD',
      accountId: 'acct_euro',
    };
    const pending: LedgerError = {
      code: 'invalid_status_transition',
      transactionId: 'txn_x',
      from: 'pending',
      to: 'pending',
    };

    for (const locale of LOCALES) {
      expect(describeError(withAccount, locale)).toContain('acct_euro');
      expect(describeError(pending, locale)).not.toBe(
        describeError(EVERY_VARIANT.invalid_status_transition, locale),
      );
    }
  });
});

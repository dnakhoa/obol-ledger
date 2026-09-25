import { exponentOf, parseDecimal, type CurrencyCode } from './money';

/**
 * An amount as a bank's export writes it, read into minor units.
 *
 * Banks do not agree with each other, or with the person reading them:
 *
 * - Vietcombank writes `1,250,000`; a German bank `1.250.000,00`; a Japanese
 *   one `1,250,000` in yen with no decimals at all.
 * - Money out is `-1,250.00`, or `(1,250.00)`, or `1,250.00-`, or sits in a
 *   separate column altogether.
 * - Currency symbols and codes ride along: `₫`, `¥`, `A$`, `VND`.
 *
 * The rule for separators is the one a person applies without thinking:
 * when both `.` and `,` appear, whichever comes last is the decimal point;
 * when only one appears, it is a thousands separator if it repeats, or if it
 * is followed by exactly three digits in a currency that has no cents (a dong
 * or a yen amount is never `1,250` of something smaller), and otherwise the
 * decimal point. An amount with more decimals than its currency has is
 * refused rather than rounded, like everywhere else in this ledger.
 */
export function parseStatementAmount(text: string, currency: CurrencyCode): bigint | null {
  let value = text.trim();
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/u.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  // Symbols, codes and spaces — including the narrow no-break space French
  // and Vietnamese exports put between thousands.
  value = value.replace(/[A-Za-z$€£¥₫\s  ']/gu, '');
  if (value.endsWith('-')) {
    negative = !negative;
    value = value.slice(0, -1);
  }
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  if (!/^[\d.,]+$/u.test(value)) return null;

  const lastDot = value.lastIndexOf('.');
  const lastComma = value.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ',';
    const count = value.split(mark).length - 1;
    const after = value.length - value.lastIndexOf(mark) - 1;
    const thousands = count > 1 || (after === 3 && exponentOf(currency) === 0);
    decimal = thousands ? null : mark;
  }

  const [whole = '', fraction] = decimal
    ? [value.slice(0, value.lastIndexOf(decimal)), value.slice(value.lastIndexOf(decimal) + 1)]
    : [value, undefined];
  // Thousands come in threes after the first group, marked one way only.
  const groups = whole.split(/[.,]/u);
  const marks = new Set(whole.replace(/\d/gu, ''));
  if (
    marks.size > 1 ||
    (decimal !== null && marks.has(decimal)) ||
    (groups.length > 1 &&
      ((groups[0] ?? '').length === 0 ||
        (groups[0] ?? '').length > 3 ||
        groups.slice(1).some((group) => group.length !== 3)))
  ) {
    return null;
  }
  const digits = groups.join('');
  if (!/^\d+$/u.test(digits) || (fraction !== undefined && !/^\d+$/u.test(fraction))) return null;

  const parsed = parseDecimal(
    `${negative ? '-' : ''}${digits}${fraction === undefined ? '' : `.${fraction}`}`,
    currency,
  );
  return parsed.ok ? parsed.value : null;
}

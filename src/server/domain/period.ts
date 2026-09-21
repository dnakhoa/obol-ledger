/**
 * Closing the books.
 *
 * A period close does two things that are easy to conflate. It *locks* the
 * month, so no entry may be dated inside it any more — which is what makes a
 * signed-off figure reproduce tomorrow. And it *zeroes* revenue and expense
 * into retained earnings, because those measure a period rather than a
 * position: an income statement that never resets is measuring since the
 * beginning of time.
 */

export const PERIOD_STATUSES = ['open', 'closed'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const ACCOUNT_ROLES = ['retained_earnings', 'fx_gain_loss', 'tax_payable'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Account classes that measure a period and so reset when it ends. */
export const TEMPORARY_ACCOUNT_TYPES = ['revenue', 'expense'] as const;

/** `2026-03-17T…` → `2026-03-01`, the marker for the month it falls in. */
export function monthOf(when: Date): string {
  const year = when.getUTCFullYear();
  const month = String(when.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** The last instant of a month, where a closing entry is dated. */
export function endOfMonth(periodMonth: string): Date {
  const [year, month] = periodMonth.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0, 23, 59, 59, 999));
}

/**
 * Whether a month may be closed yet.
 *
 * Closing a month that has not finished locks out entries that have not
 * happened, which is a mistake nobody makes deliberately and everybody makes
 * by typo. The current month is refused; anything earlier is fair.
 */
export function isClosable(periodMonth: string, now: Date): boolean {
  return periodMonth < monthOf(now);
}

/**
 * The arithmetic behind the landing page's balance check.
 *
 * Separate from the component so the two things that could quietly go wrong —
 * reading what a visitor typed, and which way the scale leans — are checked
 * by handing them numbers.
 */

import type { ReplyLine } from './terminal-timeline';

/** Large enough for any amount someone types to see what happens. */
const LARGEST = 999_999_999;

/**
 * Whole minor units from whatever was typed.
 *
 * Digits only: a thousands separator in any locale, a stray minus or a space
 * is dropped rather than refused, because the point of the field is to watch
 * the scale move, not to be told off for punctuation.
 */
export function parseMinor(text: string): number {
  const digits = text.replaceAll(/\D/gu, '');
  if (digits === '') return 0;
  return Math.min(Number(digits.slice(0, 10)), LARGEST);
}

/** Degrees. A single unit out must still be visible; nothing tips it over. */
export const MIN_TILT = 4;
export const MAX_TILT = 14;

/**
 * The beam's angle for these two sides.
 *
 * Negative lowers the left (debit) pan, which is how SVG reads a rotation:
 * positive is clockwise, so the right end goes down. Proportional to how far
 * out the entry is relative to its size, with a floor so one unit in a
 * thousand still tilts the beam enough to see.
 */
export function tilt(debit: number, credit: number): number {
  const difference = credit - debit;
  if (difference === 0) return 0;
  const share = Math.abs(difference) / Math.max(debit, credit);
  const magnitude = MIN_TILT + (MAX_TILT - MIN_TILT) * Math.min(share * 4, 1);
  return Math.sign(difference) * magnitude;
}

/**
 * What psql prints when this entry is committed.
 *
 * The refusal is the deferred trigger's message from
 * `drizzle/0010_multi_currency.sql`, word for word, including its "1 minor
 * units": a page that tidied Postgres' grammar would be quoting it wrongly.
 */
export function commitReply(debit: number, credit: number): readonly ReplyLine[] {
  const off = Math.abs(debit - credit);
  if (off === 0) return [{ tone: 'ok', text: 'COMMIT' }];
  return [
    { tone: 'error', text: 'ERROR:  23514 check_violation' },
    {
      tone: 'detail',
      text: `transaction txn_demo is unbalanced by ${off} minor units of the functional currency`,
    },
    { tone: 'muted', text: 'ROLLBACK' },
  ];
}

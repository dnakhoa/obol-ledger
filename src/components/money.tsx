import { cn } from '@/lib/cn';
import { formatAmount } from '@/lib/format';
import { viewerLocale } from '@/server/i18n';
import type { MoneyDto } from '@/server/services/dto';

/**
 * Renders a monetary value for a human, in the way their language writes one.
 *
 * `71.605.457.995` and `71,605,457,995` are the same figure, and a Vietnamese
 * reader shown the second has to stop and work out which mark means what. In
 * an application whose whole argument is that a misread figure is the enemy,
 * that is not cosmetic.
 *
 * ## Why this reads the locale itself
 *
 * It is a Server Component, so it can. The alternative was a `locale` prop on
 * forty call sites, every one of which would be a place to forget it — and a
 * figure rendered in the wrong convention looks perfectly fine, which is the
 * definition of a bug that ships.
 *
 * The cost is that this module is now server-only. `formatAmount` moved to
 * `@/lib/format`, where it is pure and safe for the one chart that runs in the
 * browser; the architecture test keeps that honest.
 *
 * The exact decimal string produced by the domain is grouped as *text* and
 * never passes through a JavaScript `number`. `Intl.NumberFormat` would have
 * been shorter and takes a number, by which point the precision the whole
 * backend exists to protect is already gone.
 */
export async function Money({
  value,
  className,
  showCurrency = false,
  signed = false,
}: {
  value: MoneyDto;
  className?: string;
  showCurrency?: boolean;
  /** Colours the figure by sign — only where the sign is the point. */
  signed?: boolean;
}) {
  const locale = await viewerLocale();
  const negative = value.amount.startsWith('-');
  return (
    <span
      className={cn('numeric whitespace-nowrap', signed && negative && 'text-negative', className)}
    >
      {formatAmount(value, locale)}
      {showCurrency ? (
        <span className="text-ink-muted ml-1 text-[11px] font-normal">{value.currency}</span>
      ) : null}
    </span>
  );
}

/**
 * One side of a debit/credit pair.
 *
 * Accountants read an entry by scanning the debit column, then the credit
 * column. A single signed column would force them to parse a minus sign on
 * every line, so the two sides get their own columns and the empty one shows a
 * dash rather than a zero.
 */
/**
 * One column standing in for two, on narrow screens.
 *
 * Separate debit and credit columns are how an accountant reads a journal, but
 * on a phone they leave each row half empty and push the figures off the edge.
 * Collapsing them into one column with a `Dr`/`Cr` tag keeps the side explicit
 * — it is the notation the reader already knows — without spending the width.
 */
export async function CompactAmount({
  value,
  direction,
}: {
  value: MoneyDto;
  direction: 'debit' | 'credit';
}) {
  const locale = await viewerLocale();
  return (
    <span className="numeric whitespace-nowrap">
      {formatAmount(value, locale)}
      <span className="text-ink-muted ml-1 text-[10px] font-medium uppercase">
        {direction === 'debit' ? 'Dr' : 'Cr'}
      </span>
    </span>
  );
}

export function DirectionalAmount({
  value,
  direction,
  side,
}: {
  value: MoneyDto;
  direction: 'debit' | 'credit';
  side: 'debit' | 'credit';
}) {
  if (direction !== side) {
    return (
      <span aria-hidden="true" className="text-ink-muted/40 select-none">
        —
      </span>
    );
  }
  return <Money value={value} />;
}

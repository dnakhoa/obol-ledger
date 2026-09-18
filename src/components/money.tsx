import { cn } from '@/lib/cn';
import { groupDecimalString } from '@/lib/format';
import type { MoneyDto } from '@/server/services/dto';

/**
 * Renders a monetary value for a human.
 *
 * The exact decimal string produced on the server is what gets grouped and
 * shown; the value is never round-tripped through a JavaScript `number`, which
 * would reintroduce exactly the floating-point error the backend exists to
 * avoid. All the formatting lives in `@/lib/format` so it is testable and so
 * server and client always agree.
 */
export function formatAmount(value: MoneyDto): string {
  return groupDecimalString(value.amount);
}

export function Money({
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
  const negative = value.amount.startsWith('-');
  return (
    <span
      className={cn('numeric whitespace-nowrap', signed && negative && 'text-negative', className)}
    >
      {formatAmount(value)}
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
export function CompactAmount({
  value,
  direction,
}: {
  value: MoneyDto;
  direction: 'debit' | 'credit';
}) {
  return (
    <span className="numeric whitespace-nowrap">
      {formatAmount(value)}
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

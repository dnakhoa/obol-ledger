import { cn } from '@/lib/cn';
import { separatorsFor } from '@/lib/i18n/separators';
import type { Locale } from '@/lib/i18n';
import { formatBasisPoints } from '@/server/domain/sale';
import { viewerLocale } from '@/server/i18n';

/** `2350` → `23.5%`, or `23,5%` where the comma is the decimal mark. */
export function marginText(basisPoints: number, locale: Locale): string {
  return formatBasisPoints(basisPoints).replace('.', separatorsFor(locale).decimal);
}

/**
 * A margin as a share of revenue, beside the amount it qualifies.
 *
 * Red only when negative: a loss-making line is the one thing on a margin
 * report a reader must not miss, and colouring every healthy figure green
 * would make that one harder to see, not easier. Nothing is printed when
 * there was no revenue — a line given away has no margin percentage, and 0%
 * would claim it broke even.
 */
export async function MarginPercent({
  basisPoints,
  className,
}: {
  basisPoints: number | null;
  className?: string;
}) {
  if (basisPoints === null) return null;
  const locale = await viewerLocale();
  return (
    <span
      className={cn(
        'numeric ml-1.5 text-[11px]',
        basisPoints < 0 ? 'text-negative font-medium' : 'text-ink-muted',
        className,
      )}
    >
      {marginText(basisPoints, locale)}
    </span>
  );
}

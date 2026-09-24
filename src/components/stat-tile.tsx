import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A single headline figure.
 *
 * The value uses the font's default proportional figures rather than
 * `tabular-nums`: tabular gives every digit the width of a zero, which looks
 * loose at display sizes. Alignment only matters in a *column* of numbers, so
 * that setting belongs on table cells and axis ticks, not here.
 */
export function StatTile({
  label,
  value,
  unit,
  detail,
  emphasis = false,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  emphasis?: boolean;
  /** Where the next question about this figure is answered. */
  href?: string;
  /** `caution` when the figure needs somebody's attention — and only then. */
  tone?: 'neutral' | 'caution';
}) {
  const body = (
    // Sized by the tile, not the viewport. A dong balance runs to twelve
    // digits, and at a fixed 2xl it overran a quarter-width tile on a laptop
    // and a half-width one on a phone — the same figure, too wide in both
    // places for opposite reasons. A container query asks the only question
    // that matters: how wide is this tile?
    <div
      className={cn(
        'rounded-card bg-surface @container h-full min-w-0 border px-4 py-3.5 shadow-[var(--shadow-card)] transition-colors duration-150',
        tone === 'caution' ? 'border-caution' : 'border-line',
        href && 'group-hover:border-ink-muted group-focus-visible:border-action',
      )}
    >
      <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">{label}</p>
      <p
        className={cn(
          'mt-1.5 flex flex-wrap items-baseline gap-x-1.5 font-semibold tracking-tight',
          'text-lg @min-[13rem]:text-xl @min-[16rem]:text-2xl',
          emphasis && '@min-[20rem]:text-3xl',
        )}
      >
        {value}
        {unit ? <span className="text-ink-muted text-xs font-normal">{unit}</span> : null}
      </p>
      {detail ? <div className="text-ink-muted mt-1 text-xs">{detail}</div> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="group block rounded-[inherit] focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

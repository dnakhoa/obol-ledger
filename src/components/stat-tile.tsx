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
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-card border-line bg-surface border px-4 py-3.5 shadow-[var(--shadow-card)]">
      <p className="text-ink-muted text-[11px] font-medium tracking-wide uppercase">{label}</p>
      <p
        className={cn(
          'mt-1.5 flex items-baseline gap-1.5 font-semibold tracking-tight',
          emphasis ? 'text-3xl' : 'text-2xl',
        )}
      >
        {value}
        {unit ? <span className="text-ink-muted text-xs font-normal">{unit}</span> : null}
      </p>
      {detail ? <div className="text-ink-muted mt-1 text-xs">{detail}</div> : null}
    </div>
  );
}

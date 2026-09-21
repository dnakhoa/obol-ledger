'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatAmount } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { MoneyDto } from '@/server/services/dto';

/**
 * Daily posting volume as a column chart.
 *
 * Built to a fixed set of mark specs rather than to taste: columns cap at 24px
 * and never fill their slot, a 2px gap in the surface colour does the
 * separating — no strokes, which would add ink that is not data — the cap is
 * rounded and the baseline square so the column reads as growing from zero, and
 * the gridlines are hairline and recessive.
 *
 * One series, so there is no legend: the panel heading already says what is
 * plotted, and a box with a single swatch would only restate it. Only the peak
 * is directly labelled; a value on all thirty columns goes unread, and the axis
 * and tooltip carry the rest.
 *
 * Accessibility: the columns are hidden from assistive technology and the same
 * figures are available in a real table below. That is more useful than thirty
 * tab stops carrying `aria-label`s.
 *
 * All formatting and axis maths happen on the server (`@/lib/chart-scale`); this
 * component receives finished strings and percentages so that no money value is
 * ever reconstructed from a JavaScript number in the browser.
 */
export type VolumeColumn = {
  readonly day: string;
  readonly label: string;
  readonly value: MoneyDto;
  readonly heightPercent: number;
  readonly isPeak: boolean;
};

export function VolumeChart({
  columns,
  ticks,
  currency,
  locale,
  labels,
}: {
  columns: readonly VolumeColumn[];
  ticks: readonly string[];
  currency: string;
  /**
   * Passed in rather than read here.
   *
   * This is the one chart that runs in the browser, so it cannot reach for the
   * cookie the way `Money` does — and pulling a server module in to try would
   * drag `next/headers` into the client bundle.
   */
  locale: Locale;
  labels: { noActivity: string; viewAsTable: string };
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (columns.length === 0) {
    return <p className="text-ink-muted py-12 text-center text-xs">{labels.noActivity}</p>;
  }

  const active = hovered === null ? null : columns[hovered];

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div
          aria-hidden="true"
          className="numeric text-ink-muted flex h-52 w-16 shrink-0 flex-col justify-between text-right text-[10px] leading-none"
        >
          {ticks.map((tick, index) => (
            <span key={`${tick}-${index}`}>{tick}</span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((tick, index) => (
              <div
                key={`${tick}-${index}`}
                className={cn(
                  'h-px w-full',
                  index === ticks.length - 1 ? 'bg-line-strong' : 'bg-line',
                )}
              />
            ))}
          </div>

          <div
            aria-hidden="true"
            className="relative flex h-52 items-end gap-[2px]"
            onMouseLeave={() => setHovered(null)}
          >
            {columns.map((column, index) => (
              <div
                key={column.day}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                onMouseEnter={() => setHovered(index)}
              >
                <div
                  className={cn(
                    'w-full max-w-6 rounded-t-[4px] transition-colors duration-150',
                    hovered === index ? 'bg-series' : 'bg-series/70',
                  )}
                  style={{ height: `${column.heightPercent}%` }}
                />
                {column.isPeak && hovered === null ? (
                  <span
                    className="numeric bg-surface text-ink-secondary absolute left-1/2 -translate-x-1/2 -translate-y-1.5 rounded px-1 text-[10px] font-medium whitespace-nowrap"
                    style={{ bottom: `${column.heightPercent}%` }}
                  >
                    {formatAmount(column.value, locale)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {active ? (
            /*
              Hidden from assistive technology rather than announced. This is
              driven by mouse position, so a live region would narrate hover
              noise to someone who never hovered; the table below carries the
              same figures in a form that can actually be navigated.
            */
            <div
              aria-hidden="true"
              className="border-line bg-surface pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--shadow-raised)]"
            >
              <span className="text-ink-muted">{active.label}</span>
              <span className="numeric ml-2 font-medium">
                {formatAmount(active.value, locale)} {currency}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div aria-hidden="true" className="flex gap-3">
        <div className="w-16 shrink-0" />
        <div className="text-ink-muted flex flex-1 justify-between text-[10px]">
          <span>{columns[0]?.label}</span>
          <span>{columns.at(-1)?.label}</span>
        </div>
      </div>

      <details className="group">
        <summary className="text-ink-muted hover:text-ink inline-flex cursor-pointer list-none items-center gap-1.5 text-xs transition-colors duration-150">
          <span
            aria-hidden="true"
            className="inline-block transition-transform duration-150 group-open:rotate-90"
          >
            ›
          </span>
          {labels.viewAsTable}
        </summary>
        <div className="border-line mt-2 max-h-56 overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <caption className="sr-only">Daily posting volume in {currency}</caption>
            <thead className="bg-surface-sunken sticky top-0">
              <tr>
                <th scope="col" className="text-ink-muted px-3 py-1.5 text-left font-medium">
                  Day
                </th>
                <th scope="col" className="text-ink-muted px-3 py-1.5 text-right font-medium">
                  Volume ({currency})
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.day} className="border-line border-t">
                  <td className="px-3 py-1.5">{column.day}</td>
                  <td className="numeric px-3 py-1.5 text-right">
                    {formatAmount(column.value, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

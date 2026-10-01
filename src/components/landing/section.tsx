import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The id a section's heading carries, derived from the section's own.
 *
 * Two components have to agree on it — the `<section>` names itself by it and
 * the heading wears it — and a convention both derive is one that cannot be
 * typed twice and typed differently.
 */
export const headingId = (section: string) => `${section}-title`;

/**
 * A band of the landing page, named by its heading.
 *
 * `aria-labelledby` makes each section a landmark a screen reader can list
 * and jump between; without a name, a `<section>` is just a `<div>`.
 */
export function Section({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={headingId(id)}
      className={cn('relative px-4 py-24 sm:px-6 sm:py-32', className)}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

/**
 * Eyebrow, title, lede: the same three beats at the top of every section.
 *
 * Separate from `Section` rather than props on it, because where the heading
 * sits is the section's layout decision — above a grid in one, beside an
 * interactive panel in another — and a prop per arrangement is how a layout
 * component turns into a configuration file.
 */
export function SectionHeading({
  section,
  eyebrow,
  title,
  lede,
  align = 'start',
}: {
  section: string;
  eyebrow: string;
  title: string;
  lede?: string;
  align?: 'start' | 'center';
}) {
  return (
    <header
      className={cn('reveal max-w-3xl space-y-4', align === 'center' && 'mx-auto text-center')}
    >
      <p className="text-brand font-mono text-xs font-medium tracking-[0.18em] uppercase">
        {eyebrow}
      </p>
      <h2
        id={headingId(section)}
        className="text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl sm:leading-[1.05]"
      >
        {title}
      </h2>
      {lede ? (
        <p className="text-ink-secondary text-base leading-relaxed text-pretty sm:text-lg">
          {lede}
        </p>
      ) : null}
    </header>
  );
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A card that catches the light a `Spotlight` grid casts.
 *
 * A Server Component, deliberately in its own file: had it lived in
 * `spotlight.tsx` beside the listener, the `'use client'` there would have
 * made it a client reference, and every card's contents part of the bundle.
 */
export function SpotlightCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      data-spotlight=""
      className={cn(
        'border-line bg-surface/60 hover:border-line-strong relative isolate overflow-hidden rounded-2xl border p-6 transition-colors duration-300',
        'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100',
        'before:bg-[radial-gradient(22rem_circle_at_var(--spot-x,50%)_var(--spot-y,0%),var(--brand-glow),transparent_70%)]',
        className,
      )}
    >
      {children}
    </article>
  );
}

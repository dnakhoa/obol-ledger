import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A screenshot in a window, with the address it was taken at.
 *
 * The address is part of the picture, not a link: it tells a visitor which
 * page of the demo they are looking at, so they can find it there.
 */
export function BrowserFrame({
  path,
  className,
  children,
}: {
  path: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure
      className={cn(
        'border-line-strong bg-surface relative overflow-hidden rounded-2xl border p-1.5',
        className,
      )}
    >
      <div aria-hidden="true" className="flex h-7 items-center gap-1.5 px-2.5">
        <span className="bg-line-strong size-2.5 rounded-full" />
        <span className="bg-line-strong size-2.5 rounded-full" />
        <span className="bg-line-strong size-2.5 rounded-full" />
        <span className="bg-surface-sunken text-ink-muted mx-auto hidden truncate rounded-md px-10 py-0.5 font-mono text-[11px] sm:block">
          obol-ledger.vercel.app{path}
        </span>
      </div>
      {children}
    </figure>
  );
}

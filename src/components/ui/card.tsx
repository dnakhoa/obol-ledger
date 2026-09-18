import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The surface every panel sits on.
 *
 * Deliberately a plain composition of sub-components rather than a single
 * component with `title`/`footer`/`action` props: a header that needs a filter
 * control, a badge and a link is a layout problem, and prop-configured
 * components answer that by growing a prop per case.
 */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-card border-line bg-surface border shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <header
      className={cn(
        'border-line flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5',
        className,
      )}
    >
      {children}
    </header>
  );
}

export function CardTitle({
  className,
  children,
  as: Tag = 'h2',
}: {
  className?: string;
  children: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return <Tag className={cn('text-sm font-semibold tracking-tight', className)}>{children}</Tag>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted text-xs">{children}</p>;
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>;
}

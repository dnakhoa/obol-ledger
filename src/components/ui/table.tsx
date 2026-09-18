import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table primitives tuned for dense financial data.
 *
 * The scroll container is part of the component rather than something each page
 * remembers: a wide table that overflows the viewport is the most common way a
 * dashboard breaks on a phone, and the fix has to be structural.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-px overflow-x-auto">
      <div className="min-w-full align-middle">{children}</div>
    </div>
  );
}

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <table className="w-full border-collapse text-sm">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      {children}
    </table>
  );
}

export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  scope?: 'col' | 'row';
}) {
  return (
    <th
      scope={scope}
      className={cn(
        'border-line text-ink-muted border-b px-3 py-2.5 text-[11px] font-medium tracking-wide uppercase sm:px-4',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  numeric = false,
  colSpan,
}: {
  /** Optional: a spacer cell in a grouped table legitimately holds nothing. */
  children?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  numeric?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-line border-b px-3 py-2.5 align-middle sm:px-4',
        align === 'right' ? 'text-right' : 'text-left',
        numeric && 'numeric',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('hover:bg-surface-hover transition-colors duration-150', className)}>
      {children}
    </tr>
  );
}

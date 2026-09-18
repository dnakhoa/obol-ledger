import { cn } from '@/lib/cn';

/**
 * A placeholder that occupies the *final* size of the thing it stands in for.
 *
 * That is the whole job: a spinner lets content land and shove the page around,
 * which is what Cumulative Layout Shift measures. A skeleton of the right
 * height means the layout never moves.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('bg-surface-sunken animate-pulse rounded-md', className)}
    />
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-line divide-y">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              className={cn('h-4', column === 0 ? 'w-40 flex-none' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

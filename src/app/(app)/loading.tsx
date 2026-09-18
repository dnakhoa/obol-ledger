import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';

/**
 * Shown while a page's data is in flight.
 *
 * Every block is the height of the content it stands in for, so nothing moves
 * when the real data lands — a spinner would let the layout jump, which is what
 * Cumulative Layout Shift measures and what makes a page feel unsteady.
 */
export default function Loading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-card border-line bg-surface border px-4 py-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </CardHeader>
        <TableSkeleton rows={8} columns={4} />
      </Card>
    </>
  );
}

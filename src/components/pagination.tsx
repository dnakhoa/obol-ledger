import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ArrowLeftIcon, ArrowRightIcon } from './icons';

/**
 * Cursor pagination rendered as real links.
 *
 * The cursor lives in the URL, so a page is shareable, survives a refresh and
 * works with the browser's back button — none of which is true of pagination
 * held in component state. "Previous" is a link to the cursor we arrived from
 * rather than a computed offset, because a keyset cursor only knows how to go
 * forward.
 */
export function CursorPagination({
  basePath,
  nextCursor,
  previousCursor,
  showing,
}: {
  basePath: string;
  nextCursor: string | null;
  previousCursor?: string | undefined;
  showing: number;
}) {
  const linkClass =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium transition-colors duration-150 hover:bg-surface-hover';
  const disabledClass = 'pointer-events-none opacity-40';

  return (
    <nav
      aria-label="Pagination"
      className="border-line flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
    >
      <p className="text-ink-muted text-xs">
        Showing {showing} {showing === 1 ? 'row' : 'rows'}
      </p>
      <div className="flex items-center gap-2">
        {previousCursor === undefined ? (
          <span className={cn(linkClass, disabledClass)} aria-hidden="true">
            <ArrowLeftIcon width={13} height={13} />
            Previous
          </span>
        ) : (
          <Link
            href={previousCursor === '' ? basePath : `${basePath}?cursor=${previousCursor}`}
            className={linkClass}
            rel="prev"
          >
            <ArrowLeftIcon width={13} height={13} />
            Previous
          </Link>
        )}

        {nextCursor ? (
          <Link href={`${basePath}?cursor=${nextCursor}`} className={linkClass} rel="next">
            Next
            <ArrowRightIcon width={13} height={13} />
          </Link>
        ) : (
          <span className={cn(linkClass, disabledClass)} aria-hidden="true">
            Next
            <ArrowRightIcon width={13} height={13} />
          </span>
        )}
      </div>
    </nav>
  );
}

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ArrowLeftIcon, ArrowRightIcon } from './icons';

/**
 * Cursor pagination rendered as real links.
 *
 * The cursor lives in the URL, so a page is shareable, survives a refresh and
 * works with the browser's back button — none of which is true of pagination
 * held in component state.
 *
 * Both directions are genuine keyset queries. "Previous" is not a link back to
 * the start: it carries its own cursor and `direction=backward`, which the
 * service turns into a `>` seek in ascending order. A forward cursor contains
 * no information about what came before it, so there is no way to fake this.
 */
export function CursorPagination({
  basePath,
  nextCursor,
  previousCursor,
  showing,
  noun = 'row',
  preserve,
}: {
  basePath: string;
  nextCursor: string | null;
  previousCursor: string | null;
  showing: number;
  noun?: string;
  /** Query parameters to carry across pages, such as active filters. */
  preserve?: Record<string, string>;
}) {
  const href = (cursor: string, direction?: 'backward') => {
    const params = new URLSearchParams({ ...preserve, cursor });
    if (direction) params.set('direction', direction);
    return `${basePath}?${params.toString()}`;
  };

  const linkClass =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium transition-colors duration-150 hover:bg-surface-hover';
  const disabledClass = 'pointer-events-none opacity-40';

  return (
    <nav
      aria-label="Pagination"
      className="border-line flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
    >
      <p className="text-ink-muted text-xs">
        Showing {showing} {showing === 1 ? noun : `${noun}s`}
      </p>

      <div className="flex items-center gap-2">
        {previousCursor ? (
          <Link href={href(previousCursor, 'backward')} className={linkClass} rel="prev">
            <ArrowLeftIcon width={13} height={13} />
            Newer
          </Link>
        ) : (
          <span className={cn(linkClass, disabledClass)} aria-hidden="true">
            <ArrowLeftIcon width={13} height={13} />
            Newer
          </span>
        )}

        {nextCursor ? (
          <Link href={href(nextCursor)} className={linkClass} rel="next">
            Older
            <ArrowRightIcon width={13} height={13} />
          </Link>
        ) : (
          <span className={cn(linkClass, disabledClass)} aria-hidden="true">
            Older
            <ArrowRightIcon width={13} height={13} />
          </span>
        )}
      </div>
    </nav>
  );
}

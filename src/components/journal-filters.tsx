import Link from 'next/link';
import { SearchIcon } from './icons';
import { Select } from './ui/field';
import type { AccountDto } from '@/server/services/dto';

/**
 * Filters for the journal, as a plain GET form.
 *
 * No `'use client'` anywhere: a form that submits to its own page puts the
 * filters in the URL, which makes a filtered view shareable, bookmarkable and
 * correct under the back button. It also works with JavaScript disabled, and
 * it costs nothing in bundle size.
 *
 * Submitting deliberately drops any cursor — a page-4 cursor is meaningless
 * against a different result set, and carrying it would land the reader on an
 * empty page.
 */
export function JournalFilters({
  labels,
  accounts,
  accountId,
  search,
  metadataKey,
  metadataValue,
  resultCount,
}: {
  /** Resolved on the server; a client component holds no dictionary. */
  labels: {
    search: string;
    anyAccount: string;
    noMatch: string;
    description: string;
    account: string;
  };
  accounts: readonly AccountDto[];
  accountId?: string | undefined;
  search?: string | undefined;
  metadataKey?: string | undefined;
  metadataValue?: string | undefined;
  resultCount: number;
}) {
  const metadataFilter = metadataKey && metadataValue ? { metadataKey, metadataValue } : undefined;
  const filtered = Boolean(accountId || search || metadataFilter);

  return (
    <form
      method="get"
      action="/journal"
      className="border-line flex flex-wrap items-end gap-3 border-b px-4 py-3 sm:px-5"
    >
      <div className="min-w-[10rem] flex-1 space-y-1.5">
        <label htmlFor="search" className="text-ink-secondary block text-xs font-medium">
          {labels.description}
        </label>
        <div className="relative">
          <span className="text-ink-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
            <SearchIcon width={14} height={14} />
          </span>
          <input
            id="search"
            name="search"
            type="search"
            defaultValue={search ?? ''}
            placeholder={labels.search}
            className="border-line bg-surface placeholder:text-ink-muted h-9 w-full rounded-lg border pr-3 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="min-w-[12rem] flex-1 space-y-1.5">
        <label htmlFor="accountId" className="text-ink-secondary block text-xs font-medium">
          {labels.account}
        </label>
        <Select id="accountId" name="accountId" defaultValue={accountId ?? ''}>
          <option value="">{labels.anyAccount}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </div>

      {/*
        Carried as hidden inputs rather than as a control, because a metadata
        filter is arrived at by clicking a tag on an entry — not by typing a
        key and a value into a form. Applying the other filters must not throw
        it away, and a reader who wants rid of it has the chip below.
      */}
      {metadataFilter ? (
        <>
          <input type="hidden" name="metadataKey" value={metadataFilter.metadataKey} />
          <input type="hidden" name="metadataValue" value={metadataFilter.metadataValue} />
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="bg-action text-action-ink hover:bg-action-hover h-9 cursor-pointer rounded-lg px-4 text-sm font-medium transition-colors duration-150"
        >
          Apply
        </button>
        {filtered ? (
          <Link
            href="/journal"
            className="text-ink-muted hover:text-ink h-9 rounded-lg px-2 text-sm leading-9 transition-colors duration-150"
          >
            Clear
          </Link>
        ) : null}
      </div>

      {metadataFilter ? (
        <div className="flex w-full items-center gap-2">
          <span className="border-line bg-surface-sunken inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px]">
            <span className="text-ink-muted">{metadataFilter.metadataKey}</span>
            <span className="text-ink">{metadataFilter.metadataValue}</span>
          </span>
          <Link
            href={{
              pathname: '/journal',
              query: {
                ...(accountId ? { accountId } : {}),
                ...(search ? { search } : {}),
              },
            }}
            className="text-ink-muted hover:text-ink text-xs transition-colors duration-150"
          >
            Remove
          </Link>
        </div>
      ) : null}

      {filtered ? (
        <p aria-live="polite" className="text-ink-muted w-full text-xs">
          {resultCount === 0 ? labels.noMatch : `Showing entries matching the filters below.`}
        </p>
      ) : null}
    </form>
  );
}

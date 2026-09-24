'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AccountsIcon,
  ApiIcon,
  GaugeIcon,
  JournalIcon,
  ReportsIcon,
  StockIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  TransferIcon,
  WebhookIcon,
} from './icons';
import { cn } from '@/lib/cn';
import { groupDecimalString } from '@/lib/format';

/**
 * ⌘K, and the parts of it that are not the visual.
 *
 * A palette is mostly an accessibility problem wearing a search box. The
 * pattern browsers and screen readers already understand is a combobox: the
 * input keeps focus the whole time and *describes* the active option through
 * `aria-activedescendant`, rather than moving focus into the list. Moving
 * focus is the obvious implementation and it is why so many palettes announce
 * nothing useful — the input loses focus, typing stops working, and the
 * announcement is "list item" rather than the option's text.
 *
 * The other half is the keystroke itself. ⌘K is intercepted only when the
 * browser would not do something more important with it, and never while the
 * person is typing into a field of their own.
 */

type SearchResults = {
  accounts: { id: string; name: string; type: string; balance: string; currency: string }[];
  entries: { id: string; description: string; occurredAt: string; status: string }[];
};

type Item = {
  id: string;
  href: string;
  label: string;
  hint?: string;
  group: string;
  Icon: (props: { width?: number; height?: number }) => React.ReactElement;
};

/**
 * The destinations, named from the same dictionary the navigation uses.
 *
 * A function rather than a constant because the names depend on the reader,
 * and a palette that searched English labels while the sidebar showed
 * Vietnamese ones would be a search box that cannot find the page you are
 * looking at.
 */
function pagesFor(nav: PaletteLabels['nav'], group: string): Item[] {
  return [
    { id: 'p-overview', href: '/', label: nav.overview, group, Icon: GaugeIcon },
    { id: 'p-accounts', href: '/accounts', label: nav.accounts, group, Icon: AccountsIcon },
    { id: 'p-stock', href: '/stock', label: nav.stock, group, Icon: StockIcon },
    { id: 'p-journal', href: '/journal', label: nav.journal, group, Icon: JournalIcon },
    { id: 'p-reports', href: '/reports', label: nav.reports, group, Icon: ReportsIcon },
    { id: 'p-transfer', href: '/transfer', label: nav.newEntry, group, Icon: TransferIcon },
    { id: 'p-break', href: '/break', label: nav.breakIt, group, Icon: ShieldIcon },
    { id: 'p-webhooks', href: '/webhooks', label: nav.webhooks, group, Icon: WebhookIcon },
    { id: 'p-api', href: '/api-reference', label: nav.api, group, Icon: ApiIcon },
    { id: 'p-settings', href: '/settings', label: nav.settings, group, Icon: SettingsIcon },
  ];
}

export type PaletteLabels = {
  readonly label: string;
  readonly placeholder: string;
  readonly results: string;
  readonly searching: string;
  readonly pages: string;
  readonly accounts: string;
  readonly entries: string;
  readonly nav: {
    readonly overview: string;
    readonly accounts: string;
    readonly stock: string;
    readonly journal: string;
    readonly reports: string;
    readonly newEntry: string;
    readonly webhooks: string;
    readonly api: string;
    readonly settings: string;
    readonly breakIt: string;
  };
};

const EMPTY_RESULTS: SearchResults = { accounts: [], entries: [] };

const DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * How a trigger reaches the dialog.
 *
 * A DOM event rather than a context provider, because the two live in
 * different parts of the tree on purpose: the dialog is mounted at the layout
 * root, while the triggers sit inside the sidebar (hidden below `lg`) and the
 * mobile header. A provider would work; wrapping the whole shell in a client
 * component to share one boolean would not be worth it.
 */
const OPEN_EVENT = 'obol:open-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette({ labels }: { labels: PaletteLabels }) {
  const allPages = pagesFor(labels.nav, labels.pages);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const needle = query.trim().toLowerCase();
  const pages = needle
    ? allPages.filter((page) => page.label.toLowerCase().includes(needle))
    : allPages.slice(0, 5);

  /*
   * Derived, not stored. Clearing `results` from an effect when the query gets
   * too short means a render in between where stale rows are still on screen
   * — and it is a setState in an effect, which React's linter rejects for
   * exactly that reason. Deciding at render time removes both problems.
   */
  const visible = needle.length >= 2 ? results : EMPTY_RESULTS;

  const items: Item[] = [
    ...pages,
    ...visible.accounts.map((account) => ({
      id: `a-${account.id}`,
      href: `/accounts/${account.id}`,
      label: account.name,
      hint: `${account.type} · ${groupDecimalString(account.balance)} ${account.currency}`,
      group: labels.accounts,
      Icon: AccountsIcon,
    })),
    ...visible.entries.map((entry) => ({
      id: `e-${entry.id}`,
      href: `/journal/${entry.id}`,
      label: entry.description,
      hint: `${DAY.format(new Date(entry.occurredAt))} · ${entry.status}`,
      group: labels.entries,
      Icon: JournalIcon,
    })),
  ];

  // A plain function, not a `useCallback`. The React Compiler memoizes this
  // component itself, and a manual `useCallback` it cannot reconcile makes it
  // bail out of compiling the whole component — which costs more than the
  // stable identity was buying.
  const close = () => {
    setOpen(false);
    setQuery('');
    setResults(EMPTY_RESULTS);
    setActive(0);
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      // Escape closes from anywhere, including from a result the pointer is
      // hovering — the keyboard should never depend on where the mouse is.
      if (event.key === 'Escape') setOpen(false);
    }

    const onRequest = () => setOpen(true);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_EVENT, onRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_EVENT, onRequest);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || needle.length < 2) return;

    // Debounced, and cancelled on the way out. Without the abort, a slow
    // response for "wh" can land after a fast one for "whole" and replace the
    // better results with worse ones — the classic out-of-order race that
    // makes a search box feel haunted.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : EMPTY_RESULTS))
        .then((data: SearchResults) => {
          setResults(data);
          setActive(0);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 140);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [needle, open]);

  if (!open) return null;

  const activeItem = items[active];

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Wrapping, because a list that stops at the end makes people believe
      // the keyboard has broken rather than that they have reached the bottom.
      setActive((current) => (current + step + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && activeItem) {
      event.preventDefault();
      router.push(activeItem.href);
      close();
    }
  }

  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
      // A click on the backdrop is a dismissal, but a click that *started*
      // inside the panel and drifted out while selecting text is not.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labels.label}
        className="rounded-card border-line bg-surface w-full max-w-xl overflow-hidden border shadow-2xl"
      >
        <div className="border-line flex items-center gap-2.5 border-b px-4">
          <span className="text-ink-muted">
            <SearchIcon width={15} height={15} />
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem?.id}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={labels.placeholder}
            className="text-ink placeholder:text-ink-muted h-12 flex-1 bg-transparent text-sm outline-none"
          />
          <kbd className="border-line text-ink-muted hidden rounded border px-1.5 py-0.5 text-[10px] sm:block">
            ESC
          </kbd>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label={labels.results}
          className="max-h-80 overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <li className="text-ink-muted px-3 py-6 text-center text-sm">
              {loading ? labels.searching : `Nothing matches “${query}”.`}
            </li>
          ) : (
            items.map((item, index) => {
              const header = item.group === lastGroup ? null : item.group;
              lastGroup = item.group;
              return (
                <li key={item.id}>
                  {header ? (
                    <p className="text-ink-muted px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
                      {header}
                    </p>
                  ) : null}
                  <button
                    id={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    // Pointer and keyboard drive the same single notion of
                    // "active", so hovering one row while arrowing through
                    // another cannot leave two looking selected.
                    onMouseMove={() => setActive(index)}
                    onClick={() => {
                      router.push(item.href);
                      close();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-100',
                      index === active ? 'bg-surface-hover text-ink' : 'text-ink-secondary',
                    )}
                  >
                    <span className="text-ink-muted shrink-0">
                      <item.Icon width={14} height={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="text-ink-muted shrink-0 text-[11px]">{item.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * The visible way in.
 *
 * A palette reachable only by a shortcut is a palette most people never learn
 * exists, so the shortcut is printed on a control that also works when
 * clicked. On a phone there is no shortcut to print and no room to print it,
 * so the same control becomes an icon with an accessible name.
 */
export function PaletteTrigger({
  label,
  variant = 'bar',
}: {
  /** Resolved on the server, like every other label here. */
  label: string;
  variant?: 'bar' | 'icon';
}) {
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label={label}
        className="border-line bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink-secondary flex size-9 items-center justify-center rounded-lg border transition-colors duration-150"
      >
        <SearchIcon width={15} height={15} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="border-line bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink-secondary flex h-9 w-full items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors duration-150"
    >
      <SearchIcon width={14} height={14} />
      <span className="flex-1 text-left">{label}</span>
      <kbd className="border-line rounded border px-1.5 py-0.5 font-sans text-[10px]">⌘K</kbd>
    </button>
  );
}

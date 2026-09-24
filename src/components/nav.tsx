'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  AccountsIcon,
  GaugeIcon,
  JournalIcon,
  ReportsIcon,
  CalendarIcon,
  ReceiptIcon,
  SettingsIcon,
  StockIcon,
  TagIcon,
  TransferIcon,
} from './icons';

/**
 * The navigation is the only part of the shell that needs to know the current
 * route, so it is the only part that is a Client Component. Keeping the
 * `'use client'` boundary here rather than on the layout means the sidebar
 * chrome, the header and every page body stay on the server.
 */
/**
 * The labels are a prop, not a lookup.
 *
 * This is the one Client Component in the shell, because it is the only part
 * that needs the current path. Importing a dictionary here would pull every
 * language into the client bundle to render ten words; passing the ten words
 * in from the server costs nothing and keeps both dictionaries on the server.
 */
export type NavLabels = {
  readonly primary: string;
  readonly overview: string;
  readonly accounts: string;
  readonly stock: string;
  readonly sales: string;
  readonly journal: string;
  readonly reports: string;
  readonly monthEnd: string;
  readonly tax: string;
  readonly newEntry: string;
  readonly webhooks: string;
  readonly api: string;
  readonly settings: string;
  readonly morePages: string;
  readonly sectionTrading: string;
  readonly sectionAccounting: string;
};

/**
 * Where things are, in the order a distributor's day uses them.
 *
 * Grouped because thirteen flat links read as a feature list rather than a
 * place to work. Selling and stock come first — they are what the business
 * does — and the accountant's pages sit together below them. The API and
 * webhooks are for whoever integrates the ledger, not whoever runs the
 * business, so they live under Settings and in search rather than here.
 *
 * `sidebar: false` keeps a page off the sidebar while it still has a slot on
 * a phone: posting a journal entry is reached from the journal on a desk, and
 * is the one quick action worth a thumb's reach on the move.
 */
const LINKS = [
  { href: '/', key: 'overview', Icon: GaugeIcon, exact: true, section: null },
  { href: '/sales', key: 'sales', Icon: TagIcon, exact: false, section: 'sectionTrading' },
  { href: '/stock', key: 'stock', Icon: StockIcon, exact: false, section: 'sectionTrading' },
  {
    href: '/journal',
    key: 'journal',
    Icon: JournalIcon,
    exact: false,
    section: 'sectionAccounting',
  },
  {
    href: '/accounts',
    key: 'accounts',
    Icon: AccountsIcon,
    exact: false,
    section: 'sectionAccounting',
  },
  {
    href: '/reports',
    key: 'reports',
    Icon: ReportsIcon,
    exact: false,
    section: 'sectionAccounting',
  },
  { href: '/tax', key: 'tax', Icon: ReceiptIcon, exact: false, section: 'sectionAccounting' },
  {
    href: '/month-end',
    key: 'monthEnd',
    Icon: CalendarIcon,
    exact: false,
    section: 'sectionAccounting',
  },
  {
    href: '/transfer',
    key: 'newEntry',
    Icon: TransferIcon,
    exact: false,
    section: 'sectionAccounting',
    sidebar: false,
  },
  { href: '/settings', key: 'settings', Icon: SettingsIcon, exact: false, section: 'settings' },
] as const satisfies readonly {
  href: string;
  key: keyof NavLabels;
  Icon: unknown;
  exact: boolean;
  section: 'sectionTrading' | 'sectionAccounting' | 'settings' | null;
  sidebar?: boolean;
}[];

/** Settings owns the developer pages, so it stays highlighted on them. */
const ALSO_ACTIVE_ON: Record<string, readonly string[]> = {
  '/settings': ['/webhooks', '/api-reference'],
};

/**
 * The bottom bar caps at five, which is the practical ceiling before targets
 * drop below a comfortable 44px. The ones that give up their slots are those
 * nobody does on a phone: reading a report that wants a wide table, closing a
 * month — a desk job done once, carefully — or changing settings.
 *
 * Stock takes a slot because it is the thing somebody checks standing in the
 * yard, and Sales because an invoice is raised wherever the customer is.
 */
const DESKTOP_ONLY = new Set(['/accounts', '/tax', '/settings', '/month-end', '/reports']);

const MOBILE_LINKS = LINKS.filter((link) => !DESKTOP_ONLY.has(link.href));
const OVERFLOW_LINKS = LINKS.filter((link) => DESKTOP_ONLY.has(link.href));

/**
 * The destinations the bottom bar could not fit, listed in the open.
 *
 * Rendered at the foot of every page below `lg`, as plain links rather than
 * behind a "More" button. A menu would be tidier and would also mean five of
 * the ten pages exist only for somebody who thinks to go looking — which for
 * an audience that has never used the application before is the same as not
 * existing. Nothing here toggles, expands or slides; it is a list.
 */
export function OverflowNav({ labels }: { labels: NavLabels }) {
  return (
    <nav aria-label={labels.morePages} className="border-line mt-8 border-t pt-4 lg:hidden">
      <p className="text-ink-muted mb-2 text-[11px] font-medium tracking-wide uppercase">
        {labels.morePages}
      </p>
      <ul className="flex flex-wrap gap-2">
        {OVERFLOW_LINKS.map(({ href, key, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="border-line bg-surface text-ink-secondary hover:bg-surface-hover hover:text-ink flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors duration-150"
            >
              <Icon className="text-ink-muted shrink-0" />
              {labels[key]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function isActive(pathname: string, href: string, exact: boolean): boolean {
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (exact) return pathname === href;
  return under(href) || (ALSO_ACTIVE_ON[href] ?? []).some(under);
}

export function SidebarNav({ labels }: { labels: NavLabels }) {
  const pathname = usePathname();
  const visible = LINKS.filter((link) => !('sidebar' in link) || link.sidebar !== false);

  return (
    <nav aria-label={labels.primary} className="flex flex-col gap-0.5">
      {visible.map(({ href, key, Icon, exact, section }, index) => {
        const active = isActive(pathname, href, exact);
        const previous = visible[index - 1];
        // A heading where a named section begins; Settings is set apart by
        // space alone, since a heading that repeats the link says nothing.
        const heading =
          section && section !== 'settings' && previous?.section !== section
            ? labels[section]
            : null;
        return (
          <div key={href} className={section === 'settings' ? 'mt-4' : undefined}>
            {heading ? (
              <p className="text-ink-muted mt-4 mb-1 px-3 text-[11px] font-medium tracking-wide uppercase">
                {heading}
              </p>
            ) : null}
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                active
                  ? 'bg-surface-hover text-ink font-medium'
                  : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
              )}
            >
              <Icon className="text-ink-muted shrink-0" />
              {labels[key]}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The same destinations as a bottom bar on small screens.
 *
 * Five items is the practical ceiling for a bottom bar — beyond that the
 * targets fall below a comfortable 44px — and the list is capped accordingly.
 */
export function MobileNav({ labels }: { labels: NavLabels }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={labels.primary}
      className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto flex max-w-2xl">
        {MOBILE_LINKS.map(({ href, key, Icon, exact }) => {
          const active = isActive(pathname, href, exact);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[3.25rem] flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] transition-colors duration-150',
                  active ? 'text-ink' : 'text-ink-muted',
                )}
              >
                <Icon className={cn(active && 'text-ink')} />
                {labels[key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

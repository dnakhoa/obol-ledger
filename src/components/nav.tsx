'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  AccountsIcon,
  ApiIcon,
  GaugeIcon,
  JournalIcon,
  ReportsIcon,
  CalendarIcon,
  SettingsIcon,
  StockIcon,
  TransferIcon,
  WebhookIcon,
} from './icons';

/**
 * The navigation is the only part of the shell that needs to know the current
 * route, so it is the only part that is a Client Component. Keeping the
 * `'use client'` boundary here rather than on the layout means the sidebar
 * chrome, the header and every page body stay on the server.
 */
const LINKS = [
  { href: '/', label: 'Overview', Icon: GaugeIcon, exact: true },
  { href: '/accounts', label: 'Accounts', Icon: AccountsIcon, exact: false },
  { href: '/stock', label: 'Stock', Icon: StockIcon, exact: false },
  { href: '/journal', label: 'Journal', Icon: JournalIcon, exact: false },
  { href: '/reports', label: 'Reports', Icon: ReportsIcon, exact: false },
  { href: '/month-end', label: 'Month end', Icon: CalendarIcon, exact: false },
  { href: '/transfer', label: 'New entry', Icon: TransferIcon, exact: false },
  { href: '/webhooks', label: 'Webhooks', Icon: WebhookIcon, exact: false },
  { href: '/api-reference', label: 'API', Icon: ApiIcon, exact: false },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon, exact: false },
] as const;

/**
 * The bottom bar caps at five, which is the practical ceiling before targets
 * drop below a comfortable 44px. The ones that give up their slots are those
 * nobody does on a phone: reading an API reference, wiring up a webhook,
 * copying a freshly issued key into a config file, reading a report that wants
 * a wide table, or closing a month — which is a desk job done once, carefully.
 *
 * Stock takes a slot because it is the opposite: it is the thing somebody
 * checks standing in the yard.
 */
const DESKTOP_ONLY = new Set([
  '/api-reference',
  '/webhooks',
  '/settings',
  '/month-end',
  '/reports',
]);

const MOBILE_LINKS = LINKS.filter((link) => !DESKTOP_ONLY.has(link.href));

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {LINKS.map(({ href, label, Icon, exact }) => {
        const active = isActive(pathname, href, exact);
        return (
          <Link
            key={href}
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
            {label}
          </Link>
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
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto flex max-w-2xl">
        {MOBILE_LINKS.map(({ href, label, Icon, exact }) => {
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
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

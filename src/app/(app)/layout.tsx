import Link from 'next/link';
import type { ReactNode } from 'react';
import { MobileNav, SidebarNav } from '@/components/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { ScaleIcon } from '@/components/icons';

/**
 * The application shell.
 *
 * A Server Component: none of this needs interactivity, so none of it ships
 * JavaScript. The two client islands it renders — the navigation, which reads
 * the current path, and the theme control — are as small as they can be.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/*
        A skip link is the difference between one Tab keystroke and twenty for
        anyone navigating by keyboard. Visually hidden until focused.
      */}
      <a
        href="#main"
        className="sr-only-focusable bg-action text-action-ink fixed top-3 left-3 z-50 rounded-lg px-3 py-2 text-sm font-medium"
      >
        Skip to content
      </a>

      <aside className="border-line bg-surface sticky top-0 hidden h-dvh flex-col border-r lg:flex">
        <div className="border-line flex h-14 items-center gap-2 border-b px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-action text-action-ink flex size-7 items-center justify-center rounded-md">
              <ScaleIcon width={15} height={15} />
            </span>
            Obol
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav />
        </div>
        <div className="border-line border-t p-3">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="border-line bg-surface/90 sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur-sm lg:hidden">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-action text-action-ink flex size-7 items-center justify-center rounded-md">
              <ScaleIcon width={15} height={15} />
            </span>
            Obol
          </Link>
          <ThemeToggle />
        </header>

        <main id="main" className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl space-y-6">{children}</div>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}

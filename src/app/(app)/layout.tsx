import Link from 'next/link';
import type { ReactNode } from 'react';
import { MobileNav, OverflowNav, SidebarNav } from '@/components/nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { CommandPalette, PaletteTrigger } from '@/components/command-palette';
import { ViewerMenu } from '@/components/viewer-menu';
import { currentViewer, orgName } from '@/server/auth/viewer';
import { configuredProviders } from '@/server/auth/config';
import { ScaleIcon } from '@/components/icons';
import { translations } from '@/server/i18n';

/**
 * The application shell.
 *
 * A Server Component: none of this needs interactivity, so none of it ships
 * JavaScript. The two client islands it renders — the navigation, which reads
 * the current path, and the theme control — are as small as they can be.
 */
/**
 * Never prerendered.
 *
 * The shell reads the session to say whose books these are, and a session is
 * per-request by definition — so there is no build-time answer. Without this,
 * `next build` tries to prerender the one page under this layout that has no
 * `dynamic` of its own and fails on a machine with no database, which is
 * every CI runner.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await translations();
  const themeLabels = {
    legend: t.common.colourTheme,
    light: t.common.themeLight,
    system: t.common.themeSystem,
    dark: t.common.themeDark,
  };
  const viewer = await currentViewer();
  // An unenrolled account has no ledger to render a shell around, so the
  // pages send it to onboarding; the shell still needs a name for the header.
  const ledgerName = viewer.kind === 'unenrolled' ? 'Your ledger' : await orgName(viewer.orgId);
  const identity =
    viewer.kind === 'guest'
      ? {}
      : { name: viewer.name, email: viewer.email, image: viewer.image, sample: viewer.sample };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/*
        `minmax(0, 1fr)`, not `1fr`: a bare `1fr` track's minimum is its
        content's, so one wide table widened the whole page and the sidebar
        scrolled off with it, instead of the table scrolling in its card.
      */}
      {/*
        A skip link is the difference between one Tab keystroke and twenty for
        anyone navigating by keyboard. Visually hidden until focused.
      */}
      <a
        href="#main"
        className="sr-only-focusable bg-action text-action-ink fixed top-3 left-3 z-50 rounded-lg px-3 py-2 text-sm font-medium"
      >
        {t.common.skipToContent}
      </a>

      <aside className="border-line bg-surface sticky top-0 hidden h-dvh flex-col border-r lg:flex">
        <div className="border-line flex h-14 items-center gap-2 border-b px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-action text-action-ink flex size-7 items-center justify-center rounded-md">
              <ScaleIcon width={15} height={15} />
            </span>
            {t.common.appName}
          </Link>
        </div>
        <div className="px-3 pt-3">
          <PaletteTrigger label={t.common.search} />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav labels={t.nav} />
        </div>
        <div className="border-line space-y-3 border-t p-3">
          <ViewerMenu
            {...identity}
            orgName={ledgerName}
            canSignIn={configuredProviders().length > 0}
            labels={{
              reading: t.misc.reading,
              signIn: t.common.signIn,
              signOut: t.common.signOut,
              signingOut: t.misc.signingOut,
              trySample: t.sample.title,
              sampleBadge: t.sample.badge,
              keepIt: t.sample.keepIt,
            }}
          />
          <LanguageToggle current={locale} label={t.common.language} />
          <ThemeToggle labels={themeLabels} />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="border-line bg-surface/90 sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur-sm lg:hidden">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="bg-action text-action-ink flex size-7 items-center justify-center rounded-md">
              <ScaleIcon width={15} height={15} />
            </span>
            {t.common.appName}
          </Link>
          <div className="flex items-center gap-2">
            <PaletteTrigger label={t.common.search} variant="icon" />
            <LanguageToggle current={locale} label={t.common.language} />
            <ThemeToggle labels={themeLabels} />
          </div>
        </header>

        {/*
          Mounted at the shell's root rather than beside a trigger: the sidebar
          is `display: none` below `lg`, and a dialog inside a hidden ancestor
          is a dialog nobody on a phone can see.
        */}
        <CommandPalette
          labels={{
            label: t.palette.label,
            placeholder: t.palette.placeholder,
            results: t.palette.results,
            searching: t.palette.searching,
            pages: t.palette.pages,
            accounts: t.palette.accounts,
            entries: t.palette.entries,
            nav: t.nav,
          }}
        />

        <main id="main" className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            {children}
            <OverflowNav labels={t.nav} />
          </div>
        </main>
      </div>

      <MobileNav labels={t.nav} />
    </div>
  );
}

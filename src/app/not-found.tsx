import Link from 'next/link';
import { translations } from '@/server/i18n';

export default async function NotFound() {
  const { t } = await translations();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="numeric text-5xl font-semibold tracking-tight">404</p>
      <div className="space-y-1">
        <h1 className="text-sm font-semibold">{t.common.pageNotFound}</h1>
        <p className="text-ink-muted text-xs">{t.misc.notFoundBody}</p>
      </div>
      <Link
        href="/"
        className="bg-action text-action-ink inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
      >
        {t.misc.backToOverview}
      </Link>
    </main>
  );
}

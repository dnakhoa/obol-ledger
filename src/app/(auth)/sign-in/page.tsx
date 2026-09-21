import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { translations } from '@/server/i18n';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScaleIcon } from '@/components/icons';
import { SignInButtons } from '@/components/sign-in-buttons';
import { configuredProviders } from '@/server/auth/config';
import { currentViewer } from '@/server/auth/viewer';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const { t } = await translations();
  const viewer = await currentViewer();
  if (viewer.kind === 'member') redirect('/');
  if (viewer.kind === 'unenrolled') redirect('/onboarding');

  const providers = configuredProviders();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <span className="bg-action text-action-ink mx-auto flex size-10 items-center justify-center rounded-xl">
          <ScaleIcon width={20} height={20} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{t.common.keepYourOwnBooks}</h1>
        <p className="text-ink-secondary text-sm">
          Sign in and you get a ledger of your own — your chart of accounts, your entries, your
          currency. The demo stays where it is.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{t.common.signIn}</CardTitle>
            <CardDescription>{t.misc.noPassword}</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {providers.length === 0 ? (
            <p className="text-ink-secondary text-sm">
              No sign-in provider is configured on this deployment. Set{' '}
              <code className="font-mono text-xs">GITHUB_CLIENT_ID</code> and{' '}
              <code className="font-mono text-xs">GITHUB_CLIENT_SECRET</code> to enable one.
            </p>
          ) : (
            <SignInButtons providers={providers} />
          )}
        </CardBody>
      </Card>

      <p className="text-ink-muted text-center text-xs">
        Just looking?{' '}
        <Link href="/" className="hover:text-ink-secondary underline">
          {t.misc.readDemo}
        </Link>{' '}
        — no account needed.
      </p>
    </main>
  );
}

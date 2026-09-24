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
        <p className="text-ink-secondary text-sm">{t.misc.signInPitch}</p>
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
            // A visitor to the published demo is told what they can still do;
            // the environment variables are for whoever runs the deployment,
            // so they appear only where that person is the one looking.
            <div className="space-y-3">
              <p className="text-ink-secondary text-sm">{t.misc.signInOff}</p>
              {process.env.NODE_ENV === 'production' ? null : (
                <p className="text-ink-muted text-xs">{t.misc.signInOffDev}</p>
              )}
              <Link
                href="/"
                className="bg-action text-action-ink hover:bg-action-hover flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors duration-150"
              >
                {t.misc.readDemo}
              </Link>
            </div>
          ) : (
            <SignInButtons providers={providers} />
          )}
        </CardBody>
      </Card>

      {providers.length === 0 ? null : (
        <p className="text-ink-muted text-center text-xs">
          {t.misc.justLooking}{' '}
          <Link href="/" className="hover:text-ink-secondary underline">
            {t.misc.readDemo}
          </Link>{' '}
          · {t.misc.noAccountNeeded}
        </p>
      )}
    </main>
  );
}

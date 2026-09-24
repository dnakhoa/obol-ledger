import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { translations } from '@/server/i18n';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScaleIcon } from '@/components/icons';
import { SignInButtons } from '@/components/sign-in-buttons';
import { configuredProviders } from '@/server/auth/config';
import { currentViewer } from '@/server/auth/viewer';
import { TrySample } from '@/components/try-sample';
import { startSampleLedgerAction } from './actions';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';
// Filling a sample ledger writes a quarter of books; allow it the time.
export const maxDuration = 60;

export default async function SignInPage() {
  const { t } = await translations();
  const viewer = await currentViewer();
  // A sample-ledger visitor comes back here to keep what they built, by
  // signing in with a provider; anyone else with a ledger has nothing to do.
  if (viewer.kind === 'member' && !viewer.sample) redirect('/');
  const keeping = viewer.kind === 'member' && viewer.sample;
  // An anonymous visitor mid-way through creating a sample ledger is
  // unenrolled for a moment; they stay here, where the button finishes it.
  if (viewer.kind === 'unenrolled' && !viewer.sample) {
    redirect('/onboarding');
  }

  const providers = configuredProviders();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2 text-center">
        <span className="bg-action text-action-ink mx-auto flex size-10 items-center justify-center rounded-xl">
          <ScaleIcon width={20} height={20} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          {keeping ? t.sample.keepIt : t.sample.title}
        </h1>
        {keeping ? null : <p className="text-ink-secondary text-sm">{t.sample.pitch}</p>}
      </div>

      {/*
        Trying comes first. Someone sent a link by a colleague wants to see
        the thing work on real-looking books before deciding anything, and a
        sign-in wall in front of that is where most of them would stop.
      */}
      {keeping ? null : (
        <TrySample
          start={startSampleLedgerAction}
          labels={{ start: t.sample.start, working: t.sample.working, failed: t.sample.failed }}
        />
      )}

      {/*
        Only when there is a provider to sign in with. Without one, a card
        explaining why sign-in is unavailable is a card about the deployment,
        shown to someone who came to try the product.
      */}
      {providers.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>{keeping ? t.sample.keepIt : t.sample.haveAccount}</CardTitle>
              <CardDescription>{t.misc.noPassword}</CardDescription>
            </div>
          </CardHeader>
          <CardBody>
            <SignInButtons providers={providers} />
          </CardBody>
        </Card>
      ) : process.env.NODE_ENV === 'production' ? null : (
        <p className="text-ink-muted text-center text-xs">{t.misc.signInOffDev}</p>
      )}

      <p className="text-ink-muted text-center text-xs">
        <Link href="/" className="hover:text-ink-secondary underline">
          {t.sample.orReadOnly}
        </Link>
      </p>
    </main>
  );
}

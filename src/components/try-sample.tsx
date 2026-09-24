'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { AlertIcon } from './icons';
import { authClient } from '@/lib/auth-client';
import type { SampleLedgerState } from '@/app/(auth)/sign-in/actions';

/**
 * One click to a writable ledger of your own.
 *
 * Two steps behind the button: an anonymous session, then a ledger filled with
 * the sample company's quarter. The second takes a few seconds, so the button
 * says what it is doing rather than spinning.
 */
export function TrySample({
  start,
  labels,
}: {
  start: () => Promise<SampleLedgerState>;
  labels: { readonly start: string; readonly working: string; readonly failed: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setPending(true);
    setError(null);
    const session = await authClient.getSession();
    if (!session.data) {
      const signedIn = await authClient.signIn.anonymous();
      if (signedIn.error) {
        setPending(false);
        setError(labels.failed);
        return;
      }
    }
    const result = await start();
    if (result.status === 'error') {
      setPending(false);
      setError(result.message);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full" disabled={pending} onClick={() => void go()}>
        {pending ? labels.working : labels.start}
      </Button>
      {error ? (
        <p aria-live="polite" className="text-caution flex items-start gap-1.5 text-xs">
          <AlertIcon width={12} height={12} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

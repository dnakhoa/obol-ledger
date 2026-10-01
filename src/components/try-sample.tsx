'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, type ButtonVariant } from './ui/button';
import { AlertIcon } from './icons';
import { cn } from '@/lib/cn';
import { authClient } from '@/lib/auth-client';
import type { SampleLedgerState } from '@/server/actions/sample-ledger';

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
  variant = 'primary',
  className,
}: {
  start: () => Promise<SampleLedgerState>;
  labels: { readonly start: string; readonly working: string; readonly failed: string };
  variant?: ButtonVariant;
  /** Sizes the block; the button fills whatever width it is given. */
  className?: string;
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
    router.push('/overview');
    router.refresh();
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Button
        size="lg"
        variant={variant}
        className="w-full"
        disabled={pending}
        // Says the page is busy to a screen reader, which cannot see the
        // label change from "Open" to "Setting up…" as an event.
        aria-busy={pending}
        onClick={() => void go()}
      >
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

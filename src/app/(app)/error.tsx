'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { AlertIcon } from '@/components/icons';

/**
 * The route-level error boundary.
 *
 * It says what failed and offers the one action that might help, without
 * leaking a stack trace to the browser. `digest` is Next.js' hash of the real
 * server-side error: the message stays in the logs, and quoting the digest is
 * what ties a user's report to the log line that explains it.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ level: 'error', event: 'ui.route_error', digest: error.digest }),
    );
  }, [error]);

  return (
    <Card>
      <CardBody className="space-y-4 py-10 text-center">
        <span className="bg-negative-soft text-negative mx-auto flex size-11 items-center justify-center rounded-full">
          <AlertIcon width={20} height={20} />
        </span>
        <div className="space-y-1">
          <h1 className="text-sm font-semibold">Something went wrong</h1>
          <p className="text-ink-muted mx-auto max-w-md text-xs">
            This page could not be loaded. Nothing was written to the ledger — every mutation
            happens inside a database transaction, so a failure leaves no partial entry behind.
          </p>
        </div>
        {error.digest ? (
          <p className="text-ink-muted font-mono text-[11px]">Reference: {error.digest}</p>
        ) : null}
        <Button onClick={reset}>Try again</Button>
      </CardBody>
    </Card>
  );
}

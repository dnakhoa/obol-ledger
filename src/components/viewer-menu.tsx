'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/cn';

/**
 * Who you are, and the way out.
 *
 * A signed-out visitor gets the way *in* instead, with the demo named rather
 * than implied — someone reading numbers should never have to wonder whose
 * numbers they are.
 */
export function ViewerMenu({
  name,
  email,
  image,
  orgName,
  sample = false,
  canSignIn,
  labels,
}: {
  /** Resolved on the server; a client component holds no dictionary. */
  labels: {
    reading: string;
    signIn: string;
    signOut: string;
    signingOut: string;
    trySample: string;
    sampleBadge: string;
    keepIt: string;
  };
  name?: string;
  email?: string;
  image?: string | null;
  orgName: string;
  /** Trying the sample ledger with no identity yet: said so, with the way to keep it. */
  sample?: boolean;
  /**
   * Whether any sign-in provider is configured. Without one the button would
   * lead to a page that can only say no, so the visitor is told up front that
   * the demo is for reading.
   */
  canSignIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!name) {
    return (
      <div className="space-y-2">
        <p className="text-ink-muted px-1 text-[11px]">
          {labels.reading} <span className="text-ink-secondary font-medium">{orgName}</span>
        </p>
        {/* Trying needs no provider, so the way in is always offered. */}
        <Link
          href="/sign-in"
          className="bg-action text-action-ink hover:bg-action-hover flex h-9 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors duration-150"
        >
          {canSignIn ? labels.signIn : labels.trySample}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="border-line hover:bg-surface-hover flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors duration-150"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- an avatar from an arbitrary provider origin, not a known one to configure
          <img src={image} alt="" width={24} height={24} className="size-6 rounded-full" />
        ) : (
          <span className="bg-surface-sunken text-ink-secondary flex size-6 items-center justify-center rounded-full text-[11px] font-medium">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-xs font-medium">{orgName}</span>
          {sample ? (
            <span className="text-caution block truncate text-[11px] font-medium">
              {labels.sampleBadge}
            </span>
          ) : (
            <span className="text-ink-muted block truncate text-[11px]">{email}</span>
          )}
        </span>
      </button>

      {open ? (
        <div
          className={cn(
            'border-line bg-surface absolute bottom-full left-0 z-40 mb-1 w-full rounded-lg border p-1',
            'shadow-[var(--shadow-card)]',
          )}
        >
          {sample && canSignIn ? (
            <Link
              href="/sign-in"
              className="text-ink hover:bg-surface-hover block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150"
            >
              {labels.keepIt}
            </Link>
          ) : null}
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void authClient.signOut().then(() => {
                // Refresh rather than push: the server has to re-resolve the
                // viewer, and a client-side navigation would keep rendering
                // the signed-in shell against a session that is gone.
                router.refresh();
              });
            }}
            className="text-ink-secondary hover:bg-surface-hover hover:text-ink w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150"
          >
            {signingOut ? labels.signingOut : labels.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

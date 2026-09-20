'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { authClient } from '@/lib/auth-client';

const LABELS: Record<string, string> = {
  github: 'Continue with GitHub',
  google: 'Continue with Google',
};

export function SignInButtons({ providers }: { providers: readonly string[] }) {
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant={provider === providers[0] ? 'primary' : 'secondary'}
          className="w-full"
          disabled={pending !== null}
          onClick={() => {
            setPending(provider);
            // `callbackURL` is where the provider returns to. Onboarding
            // rather than the dashboard, because a brand-new account has no
            // ledger yet and the dashboard would have nothing to show.
            void authClient.signIn.social({ provider, callbackURL: '/onboarding' });
          }}
        >
          {pending === provider ? 'Redirecting…' : (LABELS[provider] ?? provider)}
        </Button>
      ))}
    </div>
  );
}

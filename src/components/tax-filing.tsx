'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import type { TaxState } from '@/app/(app)/tax/actions';

const INITIAL: TaxState = { status: 'idle' };

/**
 * The button that files, and the sentence that says what happened.
 *
 * The period is a hidden field rather than a chooser: returns are filed in
 * order, so there is only ever one period that can be filed, and offering a
 * picker would be offering eleven wrong answers beside the right one. The
 * heading above it names the period in words.
 */
export function FileReturnButton({
  action,
  periodStart,
  periodEnd,
  label,
  pendingLabel,
}: {
  action: (state: TaxState, formData: FormData) => Promise<TaxState>;
  periodStart: string;
  periodEnd: string;
  label: string;
  pendingLabel: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="space-y-2">
      <input type="hidden" name="periodStart" value={periodStart} />
      <input type="hidden" name="periodEnd" value={periodEnd} />
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

export function TaxCodeForm({
  action,
  children,
  label,
  pendingLabel,
}: {
  action: (state: TaxState, formData: FormData) => Promise<TaxState>;
  children: React.ReactNode;
  label: string;
  pendingLabel: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="space-y-4">
      {children}
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

/**
 * Announced politely rather than assertively: the result arrives because the
 * person pressed a button and is already looking at the place it appears.
 */
function Outcome({ state }: { state: TaxState }) {
  if (state.status === 'idle' || !state.message) return null;

  const bad = state.status === 'error';
  return (
    <p
      aria-live="polite"
      className={cn('flex items-start gap-1.5 text-xs', bad ? 'text-caution' : 'text-positive')}
    >
      {bad ? (
        <AlertIcon width={12} height={12} className="mt-0.5 shrink-0" />
      ) : (
        <CheckIcon width={12} height={12} className="mt-0.5 shrink-0" />
      )}
      <span>{state.message}</span>
    </p>
  );
}

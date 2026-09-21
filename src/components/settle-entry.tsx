'use client';

import { useActionState } from 'react';
import { Button } from './ui/button';
import { AlertIcon, CheckIcon } from './icons';
import type { SettleFormState } from '@/app/(app)/journal/[entryId]/settle-actions';

const INITIAL: SettleFormState = { status: 'idle' };

/**
 * Settling or cancelling a pending entry.
 *
 * Both actions are offered together and framed by what they do to the money,
 * because that is the decision being made: settling moves funds that are
 * currently only reserved; cancelling releases the reservation and moves
 * nothing. Neither is destructive — the entry stays on the record either way —
 * so this needs no confirmation step, unlike a reversal, which writes a whole
 * new entry.
 */
export function SettleEntry({
  labels,
  transactionId,
  action,
}: {
  /** Resolved on the server; a client component holds no dictionary. */
  labels: { pending: string; cancel: string };
  transactionId: string;
  action: (state: SettleFormState, formData: FormData) => Promise<SettleFormState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="border-positive bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <CheckIcon />
        <span>{state.message}</span>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="transactionId" value={transactionId} />

      <div className="border-caution bg-caution-soft space-y-1 rounded-lg border px-4 py-3">
        <p className="text-ink flex items-center gap-2 text-sm font-medium">
          <AlertIcon width={14} height={14} />
          {labels.pending}
        </p>
        <p className="text-ink-secondary text-xs">
          Its funds are reserved but have not moved. The accounts show a reduced{' '}
          <strong>available</strong> balance while the <strong>posted</strong> balance is unchanged.
          Settling moves the money; cancelling releases the reservation and moves nothing.
        </p>
      </div>

      {state.status === 'error' ? (
        <div
          role="alert"
          className="border-negative bg-negative-soft text-negative rounded-lg border px-4 py-3 text-sm"
        >
          {state.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="intent" value="post" disabled={pending}>
          {pending ? 'Working…' : 'Settle this entry'}
        </Button>
        <Button type="submit" name="intent" value="archive" variant="secondary" disabled={pending}>
          {labels.cancel}
        </Button>
        <p className="text-ink-muted text-xs">
          Settling re-checks the overdraft rule — funds available at authorisation may be gone by
          now.
        </p>
      </div>
    </form>
  );
}

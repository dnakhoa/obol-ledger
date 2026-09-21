'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Field, Input } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import type { ReverseFormState } from '@/app/(app)/journal/[entryId]/actions';

const INITIAL: ReverseFormState = { status: 'idle' };

/**
 * Reversing an entry, with the confirmation step it warrants.
 *
 * The confirmation is *explanatory* rather than alarming. This is not a delete:
 * nothing is removed, a second entry is written that cancels the first, and
 * both remain on the record. A red "are you sure?" would misdescribe that and
 * teach the wrong mental model — so the panel says what will happen instead of
 * asking the user to be brave.
 *
 * It is still a two-step action, because it writes to the ledger and the ledger
 * cannot be edited afterwards: the only way back is to reverse the reversal.
 */
export function ReverseEntry({
  labels,
  transactionId,
  description,
  action,
}: {
  /** Resolved on the server; a client component holds no dictionary. */
  labels: {
    description: string;
    hint: string;
    posting: string;
    submit: string;
    viewReversal: string;
    noEditing: string;
    reverseThis: string;
    note: string;
    cancel: string;
  };
  transactionId: string;
  description: string;
  action: (state: ReverseFormState, formData: FormData) => Promise<ReverseFormState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [confirming, setConfirming] = useState(false);

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="border-positive bg-positive-soft text-positive flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm"
      >
        <CheckIcon />
        <span>{state.message}</span>
        {state.reversalId ? (
          <Link href={`/journal/${state.reversalId}`} className="ml-auto font-medium underline">
            {labels.viewReversal}
          </Link>
        ) : null}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-muted text-xs">{labels.noEditing}</p>
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          {labels.reverseThis}
        </Button>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="transactionId" value={transactionId} />

      <div className="border-caution bg-caution-soft space-y-1 rounded-lg border px-4 py-3">
        <p className="text-ink flex items-center gap-2 text-sm font-medium">
          <AlertIcon width={14} height={14} />
          {labels.note}
        </p>
        <p className="text-ink-secondary text-xs">
          A mirror of &ldquo;{description}&rdquo; will be written with every amount negated. Both
          entries stay on the record and the net effect becomes zero. An entry can only be reversed
          once, and the reversal itself can only be undone by reversing it in turn.
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

      <Field label={labels.description} htmlFor="reason" hint={labels.hint}>
        <Input
          id="reason"
          name="reason"
          maxLength={280}
          placeholder={`Reversal of ${description}`}
          aria-describedby="reason-hint"
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? labels.posting : labels.submit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}

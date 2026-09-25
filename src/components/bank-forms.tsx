'use client';

import { useActionState, useId } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import {
  bookLineAction,
  importStatementAction,
  matchAllAction,
  matchLineAction,
  unmatchLineAction,
  type BankState,
} from '@/app/(app)/bank/actions';

const INITIAL: BankState = { status: 'idle' };

export type Option = { readonly id: string; readonly label: string };

function Outcome({ state }: { state: BankState }) {
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

/** A statement exported from online banking: choose the file, and it is in. */
export function ImportStatementForm({
  accountId,
  labels,
}: {
  accountId: string;
  labels: { readonly file: string; readonly submit: string; readonly working: string };
}) {
  const [state, action, pending] = useActionState(importStatementAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="accountId" value={accountId} />
      <Field label={labels.file} htmlFor={`${id}-file`} className="min-w-64 flex-1">
        <Input
          id={`${id}-file`}
          name="file"
          type="file"
          required
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="file:text-ink-secondary pt-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-xs"
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? labels.working : labels.submit}
      </Button>
      <div className="basis-full">
        <Outcome state={state} />
      </div>
    </form>
  );
}

/** Every suggestion that is beyond doubt, matched in one go. */
export function MatchAllButton({
  accountId,
  label,
  working,
}: {
  accountId: string;
  label: string;
  working: string;
}) {
  const [state, action, pending] = useActionState(matchAllAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? working : label}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

/**
 * What one statement line is: the entry it matches, or a new one.
 *
 * With candidates, the choice is between them — the suggested one first.
 * Without, the line is something the books never heard of, and the form
 * books it against the account chosen.
 */
export function LineResolver({
  accountId,
  lineId,
  candidates,
  suggested,
  accounts,
  labels,
}: {
  accountId: string;
  lineId: string;
  candidates: readonly Option[];
  suggested: string | null;
  accounts: readonly Option[];
  labels: {
    readonly match: string;
    readonly chooseEntry: string;
    readonly book: string;
    readonly chooseAccount: string;
    readonly working: string;
  };
}) {
  const [matchState, match, matching] = useActionState(matchLineAction, INITIAL);
  const [bookState, book, booking] = useActionState(bookLineAction, INITIAL);

  if (candidates.length > 0) {
    return (
      <form action={match} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="lineId" value={lineId} />
        <Select
          name="postingId"
          aria-label={labels.chooseEntry}
          defaultValue={suggested ?? candidates[0]?.id}
          className="max-w-72 min-w-40 flex-1"
        >
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" variant="primary" disabled={matching}>
          {matching ? labels.working : labels.match}
        </Button>
        <Outcome state={matchState} />
      </form>
    );
  }

  return (
    <form action={book} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="lineId" value={lineId} />
      <Select
        name="counterAccountId"
        aria-label={labels.chooseAccount}
        defaultValue=""
        required
        className="max-w-72 min-w-40 flex-1"
      >
        <option value="" disabled>
          {labels.chooseAccount}
        </option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.label}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" variant="secondary" disabled={booking}>
        {booking ? labels.working : labels.book}
      </Button>
      <Outcome state={bookState} />
    </form>
  );
}

export function UndoMatch({
  accountId,
  lineId,
  label,
  working,
}: {
  accountId: string;
  lineId: string;
  label: string;
  working: string;
}) {
  const [state, action, pending] = useActionState(unmatchLineAction, INITIAL);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="lineId" value={lineId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? working : label}
      </Button>
      {state.status === 'error' ? <Outcome state={state} /> : null}
    </form>
  );
}

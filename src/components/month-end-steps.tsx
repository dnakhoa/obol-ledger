'use client';

import { useActionState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { CheckIcon, AlertIcon } from './icons';
import { cn } from '@/lib/cn';
import type { MonthEndState } from '@/app/(app)/month-end/actions';

const INITIAL: MonthEndState = { status: 'idle' };

/**
 * Month end as three steps, in order, with nothing hidden.
 *
 * The audience runs an import business, not a finance system. So each step
 * says what it is about to do in a sentence, shows whether it has been done,
 * and stays visible and pressable even when it is not this month's turn —
 * a control that disappears is a control somebody has to be taught about.
 *
 * Pressing a button too early is safe. The ledger refuses, and the refusal
 * arrives as a plain sentence in the step that caused it rather than as an
 * error page, because "you cannot close January until you update the rates"
 * is information, not a fault.
 */
export function Step({
  number,
  title,
  description,
  done,
  doneLabel,
  children,
}: {
  number: number;
  title: string;
  description: string;
  done?: boolean;
  doneLabel?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <li className="border-line bg-surface rounded-card flex gap-4 border p-4 sm:p-5">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          done ? 'bg-positive-soft text-positive' : 'bg-surface-sunken text-ink-secondary',
        )}
      >
        {done ? <CheckIcon width={16} height={16} /> : number}
      </span>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <h3 className="text-ink text-sm font-semibold">
            Step {number} — {title}
          </h3>
          <p className="text-ink-secondary text-sm">{description}</p>
          {done && doneLabel ? (
            <p className="text-positive flex items-center gap-1.5 text-xs font-medium">
              <CheckIcon width={12} height={12} />
              {doneLabel}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

/** What happened, in one sentence, next to the button that caused it. */
function Outcome({ state }: { state: MonthEndState }) {
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

export function RateForm({
  action,
  currencies,
  functional,
  asOf,
}: {
  action: (state: MonthEndState, formData: FormData) => Promise<MonthEndState>;
  currencies: readonly string[];
  functional: string;
  asOf: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="asOf" value={asOf} />
      <input type="hidden" name="quote" value={functional} />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Currency" htmlFor="base" className="w-28">
          <Select id="base" name="base" defaultValue={currencies[0]}>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={`Worth this many ${functional}`}
          htmlFor="rate"
          className="min-w-[10rem] flex-1"
        >
          <Input id="rate" name="rate" inputMode="decimal" placeholder="25700" required />
        </Field>

        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save rate'}
        </Button>
      </div>

      <Outcome state={state} />
    </form>
  );
}

export function ActionButton({
  action,
  month,
  label,
  pendingLabel,
  variant = 'primary',
  confirm,
}: {
  action: (state: MonthEndState, formData: FormData) => Promise<MonthEndState>;
  month: string;
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
  confirm?: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form
      action={submit}
      className="space-y-2"
      onSubmit={(event) => {
        // Only for the genuinely hard-to-undo step. A confirmation on every
        // button teaches people to dismiss confirmations.
        if (confirm && !globalThis.confirm(confirm)) event.preventDefault();
      }}
    >
      <input type="hidden" name="month" value={month} />
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

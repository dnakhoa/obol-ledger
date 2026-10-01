'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, describedBy } from '@/components/ui/field';
import { AlertIcon, CheckIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import type { Locale } from '@/lib/i18n/locales';
import { BalanceScale } from './balance-scale';
import { commitReply, parseMinor, tilt } from './balance';
import { PromptLines, ReplyLines, TerminalFrame } from './terminal-frame';

export type BalanceCheckLabels = {
  readonly debit: string;
  readonly credit: string;
  readonly unit: string;
  readonly balanced: string;
  /** Has an `{amount}` placeholder. */
  readonly unbalanced: string;
  readonly makeItBalance: string;
  readonly knockItOut: string;
  readonly scaleLabel: string;
  readonly terminalTitle: string;
};

/**
 * Two sides of an entry, a scale, and the answer Postgres would give.
 *
 * Opens one unit out, because the first thing worth seeing is the refusal.
 * Everything below the two inputs is derived from them during render — the
 * angle, the verdict, the psql reply — so there is no second copy of the
 * state to fall out of step with what the visitor typed.
 */
export function BalanceCheck({ labels, locale }: { labels: BalanceCheckLabels; locale: Locale }) {
  const id = useId();
  const [debitText, setDebitText] = useState('1000');
  const [creditText, setCreditText] = useState('999');

  const debit = parseMinor(debitText);
  const credit = parseMinor(creditText);
  const off = Math.abs(debit - credit);
  const balanced = off === 0;
  // `fill()` would do this, but it lives beside the dictionaries, and
  // importing it here would put all three of them in the browser bundle.
  const verdict = balanced
    ? labels.balanced
    : labels.unbalanced.replace('{amount}', new Intl.NumberFormat(locale).format(off));

  return (
    <div className="border-line bg-surface/70 space-y-6 rounded-2xl border p-5 shadow-[var(--shadow-raised)] backdrop-blur-sm sm:p-7">
      <BalanceScale
        angle={tilt(debit, credit)}
        balanced={balanced}
        label={labels.scaleLabel}
        sides={{ left: labels.debit, right: labels.credit }}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field label={labels.debit} htmlFor={`${id}-debit`} hint={labels.unit}>
          <Input
            id={`${id}-debit`}
            inputMode="numeric"
            autoComplete="off"
            value={debitText}
            onChange={(event) => setDebitText(event.target.value)}
            aria-describedby={describedBy(`${id}-debit`, labels.unit)}
            className="numeric h-11 font-mono text-base"
          />
        </Field>
        <Field label={labels.credit} htmlFor={`${id}-credit`} hint={labels.unit}>
          <Input
            id={`${id}-credit`}
            inputMode="numeric"
            autoComplete="off"
            value={creditText}
            onChange={(event) => setCreditText(event.target.value)}
            aria-describedby={describedBy(`${id}-credit`, labels.unit)}
            className="numeric h-11 font-mono text-base"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          aria-live="polite"
          className={cn(
            'flex items-start gap-2 text-sm font-medium',
            balanced ? 'text-positive' : 'text-negative',
          )}
        >
          {balanced ? (
            <CheckIcon width={16} height={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
          )}
          <span>{verdict}</span>
        </p>
        {/*
          One button whose job flips, not two that swap: the element a
          keyboard user just pressed must still be there, focused, to press
          again.
        */}
        <Button
          variant="secondary"
          disabled={balanced && debit === 0}
          onClick={() => setCreditText(String(balanced ? debit - 1 : debit))}
        >
          {balanced ? labels.knockItOut : labels.makeItBalance}
        </Button>
      </div>

      <TerminalFrame title={labels.terminalTitle}>
        {/* The reply is already spoken by the verdict above; this is its source. */}
        <div aria-hidden="true" className="min-h-[7.5rem] space-y-1 p-4">
          <PromptLines text="COMMIT;" />
          <ReplyLines lines={commitReply(debit, credit)} />
        </div>
      </TerminalFrame>
    </div>
  );
}

'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import { groupDecimalString } from '@/lib/format';
import { divideRounding } from '@/lib/fx';
import { parseQuantity } from '@/lib/quantity';
import { separatorsFor } from '@/lib/i18n/separators';
import type { Locale } from '@/lib/i18n/locales';
import type { CreditNoteState } from '@/app/(app)/sales/[saleId]/actions';

export type CreditNoteFormLine = {
  readonly movementId: string;
  readonly sku: string;
  readonly name: string;
  readonly unit: string;
  readonly precision: number;
  /** What can still come back, as display text and as scaled minor units. */
  readonly returnableText: string;
  readonly returnableMinor: string;
  /** What can still be credited, net, in the invoice currency's minor units. */
  readonly creditableMinor: string;
  readonly creditableText: string;
};

export type CreditNoteFormLabels = {
  readonly open: string;
  readonly intro: string;
  readonly reference: string;
  readonly date: string;
  readonly account: string;
  readonly accountHint: string;
  readonly reason: string;
  readonly reasonPlaceholder: string;
  readonly product: string;
  readonly canReturn: string;
  readonly quantityBack: string;
  readonly credit: string;
  readonly total: string;
  readonly taxNote: string;
  readonly submit: string;
  readonly working: string;
  readonly cancel: string;
};

const INITIAL: CreditNoteState = { status: 'idle' };

/** `123456` at exponent 2 → `"1234.56"`. Minor units to the decimal a person types. */
function toDecimal(minor: bigint, exponent: number): string {
  if (exponent === 0) return minor.toString();
  const text = minor.toString().padStart(exponent + 1, '0');
  return `${text.slice(0, -exponent)}.${text.slice(-exponent)}`;
}

/** The inverse, tolerantly: blank or malformed is zero, for a running total. */
function toMinor(text: string, exponent: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(text.trim());
  if (!match) return 0n;
  const fraction = (match[2] ?? '').slice(0, exponent).padEnd(exponent, '0');
  return BigInt(`${match[1]}${fraction}`);
}

/**
 * Taking back part of an invoice.
 *
 * Folded away until asked for: most invoices are never credited, and a form
 * open on every one of them is a form somebody fills in by mistake.
 *
 * Typing a quantity fills in the credit in proportion to what is left on the
 * line — the usual case, goods back at the price they were sold at — until the
 * amount is edited by hand, after which it is left alone. The figure is a
 * suggestion; the server works out the tax and checks every limit again.
 */
export function CreditNoteForm({
  saleId,
  currency,
  exponent,
  lines,
  accounts,
  defaultAccountId,
  suggestedReference,
  today,
  locale,
  action,
  labels,
}: {
  saleId: string;
  currency: string;
  exponent: number;
  lines: readonly CreditNoteFormLine[];
  accounts: readonly { readonly id: string; readonly label: string }[];
  defaultAccountId: string;
  suggestedReference: string;
  today: string;
  locale: Locale;
  action: (previous: CreditNoteState, formData: FormData) => Promise<CreditNoteState>;
  labels: CreditNoteFormLabels;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, boolean>>({});
  const id = useId();

  const separators = separatorsFor(locale);

  if (!open && state.status !== 'done') {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {labels.open}
      </Button>
    );
  }

  function onQuantity(line: CreditNoteFormLine, value: string) {
    setQuantities((current) => ({ ...current, [line.movementId]: value }));
    if (edited[line.movementId]) return;
    const parsed = parseQuantity(value || '0', line.precision);
    const returnable = BigInt(line.returnableMinor);
    const creditable = BigInt(line.creditableMinor);
    if (!parsed.ok || returnable === 0n) return;
    const suggested =
      parsed.value >= returnable
        ? creditable
        : divideRounding(creditable * parsed.value, returnable);
    setAmounts((current) => ({
      ...current,
      [line.movementId]: parsed.value === 0n ? '' : toDecimal(suggested, exponent),
    }));
  }

  const total = lines.reduce(
    (sum, line) => sum + toMinor(amounts[line.movementId] ?? '', exponent),
    0n,
  );

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="saleId" value={saleId} />
      <p className="text-ink-secondary text-sm">{labels.intro}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={labels.reference} htmlFor={`${id}-ref`}>
          <Input
            id={`${id}-ref`}
            name="reference"
            defaultValue={suggestedReference}
            required
            maxLength={40}
            autoComplete="off"
          />
        </Field>
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.account} htmlFor={`${id}-account`} hint={labels.accountHint}>
          <Select id={`${id}-account`} name="revenueAccountId" defaultValue={defaultAccountId}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.reason} htmlFor={`${id}-reason`}>
          <Input
            id={`${id}-reason`}
            name="reason"
            maxLength={280}
            placeholder={labels.reasonPlaceholder}
          />
        </Field>
      </div>

      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-ink-muted text-left text-[11px] tracking-wide uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">{labels.product}</th>
              <th className="px-3 py-2 text-right font-medium">{labels.canReturn}</th>
              <th className="px-3 py-2 font-medium">{labels.quantityBack}</th>
              <th className="px-3 py-2 font-medium">
                {labels.credit} ({currency})
              </th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {lines.map((line) => (
              <tr key={line.movementId}>
                <td className="px-3 py-2">
                  <input type="hidden" name="saleMovementId" value={line.movementId} />
                  <span className="font-medium">{line.name}</span>
                  <span className="text-ink-muted ml-2 text-xs">{line.sku}</span>
                </td>
                <td className="numeric text-ink-secondary px-3 py-2 text-right whitespace-nowrap">
                  {line.returnableText} {line.unit}
                  <span className="text-ink-muted block text-[11px]">
                    {line.creditableText} {currency}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Input
                    name="quantity"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${labels.quantityBack}: ${line.sku}`}
                    className="w-28"
                    value={quantities[line.movementId] ?? ''}
                    onChange={(event) => onQuantity(line, event.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    name="amount"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`${labels.credit}: ${line.sku}`}
                    className="w-36"
                    value={amounts[line.movementId] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setAmounts((current) => ({ ...current, [line.movementId]: value }));
                      setEdited((current) => ({ ...current, [line.movementId]: value !== '' }));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink-secondary text-sm">
          {labels.total}:{' '}
          <span className="numeric text-ink font-semibold">
            {groupDecimalString(toDecimal(total, exponent), separators)} {currency}
          </span>
          <span className="text-ink-muted ml-2 text-xs">{labels.taxNote}</span>
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {labels.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? labels.working : labels.submit}
          </Button>
        </div>
      </div>

      {state.status !== 'idle' && state.message ? (
        <p
          aria-live="polite"
          className={cn(
            'flex items-start gap-1.5 text-xs',
            state.status === 'error' ? 'text-caution' : 'text-positive',
          )}
        >
          {state.status === 'error' ? (
            <AlertIcon width={12} height={12} className="mt-0.5 shrink-0" />
          ) : (
            <CheckIcon width={12} height={12} className="mt-0.5 shrink-0" />
          )}
          <span>{state.message}</span>
        </p>
      ) : null}
    </form>
  );
}

'use client';

import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon, PlusIcon } from './icons';
import { cn } from '@/lib/cn';
import { sellAction, type SaleState } from '@/app/(app)/sales/actions';

const INITIAL: SaleState = { status: 'idle' };

export type SaleOption = { readonly id: string; readonly label: string };

export type SaleItemOption = {
  readonly id: string;
  readonly label: string;
  /** Already translated: `m²`, `t`, `pcs`. */
  readonly unit: string;
  /** Costed by picking the lot, so the line must name one. */
  readonly specific: boolean;
  readonly lots: readonly SaleOption[];
};

/** Every label resolved on the server; see `ReceiveLabels` in stock-forms for why. */
export type SaleLabels = {
  readonly invoiceNumber: string;
  readonly invoiceNumberHint: string;
  readonly customerAccount: string;
  readonly customerAccountHint: string;
  readonly revenueAccount: string;
  readonly currency: string;
  readonly currencyHint: string;
  readonly taxCode: string;
  readonly noTax: string;
  readonly invoiceDate: string;
  readonly dueDate: string;
  readonly dueDateHint: string;
  readonly linesLegend: string;
  readonly product: string;
  /** One per unit, keyed by the unit label. */
  readonly quantity: Readonly<Record<string, string>>;
  readonly quantityFallback: string;
  readonly lineTotal: string;
  readonly lot: string;
  readonly byMethod: string;
  readonly addLine: string;
  readonly removeLine: readonly string[];
  readonly lineLabel: readonly string[];
  readonly submit: string;
  readonly working: string;
  readonly openInvoice: string;
};

/** How many lines a single invoice form offers. A container rarely carries more. */
export const MAX_LINES = 12;

type Line = { key: number; itemId: string };

/**
 * An invoice, with lines added and removed in place.
 *
 * Laid out like the paper invoice it replaces — header, then lines — because
 * the person filling it in usually has one in front of them. The lines are
 * plain rows in the open rather than a dialog per line: an invoice is read
 * and checked as a whole, and a line hidden behind a click is a line that
 * gets checked less.
 */
export function SaleForm({
  customers,
  revenueAccounts,
  taxCodes,
  items,
  currencies,
  today,
  labels,
}: {
  customers: readonly SaleOption[];
  revenueAccounts: readonly SaleOption[];
  taxCodes: readonly SaleOption[];
  items: readonly SaleItemOption[];
  currencies: readonly string[];
  today: string;
  labels: SaleLabels;
}) {
  const [state, action, pending] = useActionState(sellAction, INITIAL);
  const [lines, setLines] = useState<Line[]>([{ key: 0, itemId: items[0]?.id ?? '' }]);
  const [nextKey, setNextKey] = useState(1);
  const id = useId();

  const byId = new Map(items.map((item) => [item.id, item]));

  const addLine = () => {
    if (lines.length >= MAX_LINES) return;
    setLines([...lines, { key: nextKey, itemId: items[0]?.id ?? '' }]);
    setNextKey(nextKey + 1);
  };

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={labels.invoiceNumber} htmlFor={`${id}-ref`} hint={labels.invoiceNumberHint}>
          <Input
            id={`${id}-ref`}
            name="reference"
            required
            placeholder="INV-2613"
            autoComplete="off"
          />
        </Field>
        <Field
          label={labels.customerAccount}
          htmlFor={`${id}-customer`}
          hint={labels.customerAccountHint}
        >
          <Select id={`${id}-customer`} name="customerAccountId" required>
            {customers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.revenueAccount} htmlFor={`${id}-revenue`}>
          <Select id={`${id}-revenue`} name="revenueAccountId" required>
            {revenueAccounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.currency} htmlFor={`${id}-ccy`} hint={labels.currencyHint}>
          <Select id={`${id}-ccy`} name="currency" defaultValue={currencies[0]}>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.taxCode} htmlFor={`${id}-tax`}>
          <Select id={`${id}-tax`} name="taxCodeId" defaultValue="">
            <option value="">{labels.noTax}</option>
            {taxCodes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.invoiceDate} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.dueDate} htmlFor={`${id}-due`} hint={labels.dueDateHint}>
          <Input id={`${id}-due`} name="dueOn" type="date" min={today} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-ink-secondary mb-2 text-xs font-medium">
          {labels.linesLegend}
        </legend>
        {lines.map((line, index) => {
          const item = byId.get(line.itemId);
          const row = `${id}-line-${line.key}`;
          return (
            <div
              key={line.key}
              role="group"
              aria-label={labels.lineLabel[index]}
              className="border-line grid gap-3 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_1.25fr_auto] sm:items-end"
            >
              <Field label={labels.product} htmlFor={`${row}-item`}>
                <Select
                  id={`${row}-item`}
                  name="itemId"
                  value={line.itemId}
                  onChange={(event) =>
                    setLines(
                      lines.map((other) =>
                        other.key === line.key ? { ...other, itemId: event.target.value } : other,
                      ),
                    )
                  }
                  required
                >
                  {items.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={
                  item
                    ? (labels.quantity[item.unit] ?? labels.quantityFallback)
                    : labels.quantityFallback
                }
                htmlFor={`${row}-qty`}
              >
                <Input
                  id={`${row}-qty`}
                  name="quantity"
                  inputMode="decimal"
                  placeholder="500"
                  required
                />
              </Field>
              <Field label={labels.lineTotal} htmlFor={`${row}-amount`}>
                <Input
                  id={`${row}-amount`}
                  name="amount"
                  inputMode="decimal"
                  placeholder="12000.00"
                  required
                />
              </Field>
              <Field label={labels.lot} htmlFor={`${row}-lot`}>
                <Select id={`${row}-lot`} name="layerId" required={item?.specific ?? false}>
                  <option value="">{labels.byMethod}</option>
                  {(item?.specific ? item.lots : []).map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={lines.length === 1}
                aria-label={labels.removeLine[index]}
                onClick={() => setLines(lines.filter((other) => other.key !== line.key))}
              >
                ×
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={addLine}
          disabled={lines.length >= MAX_LINES}
        >
          <PlusIcon width={12} height={12} />
          {labels.addLine}
        </Button>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.submit}
        </Button>
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
            <span>
              {state.message}
              {state.saleId ? (
                <>
                  {' '}
                  <Link href={`/sales/${state.saleId}`} className="underline underline-offset-4">
                    {labels.openInvoice}
                  </Link>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
      </div>
    </form>
  );
}

'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import { SUPPORTED_UNITS, unitLabel } from '@/lib/quantity';
import type { StockState } from '@/app/(app)/stock/actions';
import { createItemAction, issueAction, receiveAction } from '@/app/(app)/stock/actions';

const INITIAL: StockState = { status: 'idle' };

/**
 * Stock, as three forms that are always on the page.
 *
 * Nothing here opens a dialog, hides behind a menu or reveals itself on
 * hover. The people this is for keep their books in Excel and know exactly
 * where every cell is; a control that has to be discovered is a control that
 * has to be taught, and there is nobody to teach it. So the forms sit in the
 * open, say what they will do, and report what happened in the same place.
 */

function Outcome({ state }: { state: StockState }) {
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

function Submit({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? 'Working…' : children}
    </Button>
  );
}

export type AccountOption = { readonly id: string; readonly label: string };

export function AddProductForm({
  assetAccounts,
  expenseAccounts,
}: {
  assetAccounts: readonly AccountOption[];
  expenseAccounts: readonly AccountOption[];
}) {
  const [state, action, pending] = useActionState(createItemAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Product code"
          htmlFor={`${id}-sku`}
          hint="What you call it on a packing list."
        >
          <Input id={`${id}-sku`} name="sku" required placeholder="GRN-600" autoComplete="off" />
        </Field>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required placeholder="Granite paver 600×600" />
        </Field>
        <Field
          label="Measured in"
          htmlFor={`${id}-unit`}
          hint="Square metres, tonnes, pieces — whatever you invoice in."
        >
          <Select id={`${id}-unit`} name="unit" defaultValue="m2">
            {SUPPORTED_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Costing method"
          htmlFor={`${id}-method`}
          hint="Leave as the company default unless this product is one-of-a-kind."
        >
          <Select id={`${id}-method`} name="costingMethod" defaultValue="">
            <option value="">Company default</option>
            <option value="fifo">Oldest delivery first (FIFO)</option>
            <option value="weighted_average">Average across deliveries</option>
            <option value="specific">Pick the delivery by hand</option>
          </Select>
        </Field>
        <Field
          label="Stock account"
          htmlFor={`${id}-stock`}
          hint="Where the value sits while you hold it."
        >
          <Select id={`${id}-stock`} name="inventoryAccountId" required>
            {assetAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Cost of sales account"
          htmlFor={`${id}-cogs`}
          hint="Where the cost goes when it ships."
        >
          <Select id={`${id}-cogs`} name="cogsAccountId" required>
            {expenseAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Submit pending={pending}>Add product</Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function ReceiveForm({
  itemId,
  unit,
  precision,
  currencies,
  creditAccounts,
  today,
}: {
  itemId: string;
  unit: string;
  precision: number;
  currencies: readonly string[];
  creditAccounts: readonly AccountOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState(receiveAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="precision" value={precision} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`How much arrived (${unitLabel(unit as never)})`}
          htmlFor={`${id}-qty`}
          hint={precision > 0 ? `Up to ${precision} decimal places.` : 'Whole units.'}
        >
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="1000" />
        </Field>
        <Field
          label="What you paid in total"
          htmlFor={`${id}-cost`}
          hint="The whole delivery, not the unit price."
        >
          <Input
            id={`${id}-cost`}
            name="cost"
            required
            inputMode="decimal"
            placeholder="40000.00"
          />
        </Field>
        <Field label="Paid in" htmlFor={`${id}-ccy`}>
          <Select id={`${id}-ccy`} name="currency" defaultValue={currencies[0]}>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Paid from / owed to"
          htmlFor={`${id}-credit`}
          hint="The bank account it left, or the supplier you now owe."
        >
          <Select id={`${id}-credit`} name="creditAccountId" required>
            {creditAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date it arrived" htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field
          label="Reference"
          htmlFor={`${id}-ref`}
          hint="Container or invoice number. This is what the costing report will show you."
        >
          <Input id={`${id}-ref`} name="reference" placeholder="CONT-4417" autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending}>Book in this delivery</Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type LotOption = {
  readonly id: string;
  readonly label: string;
};

export function IssueForm({
  itemId,
  unit,
  precision,
  today,
  lots,
  requiresLot,
}: {
  itemId: string;
  unit: string;
  precision: number;
  today: string;
  lots: readonly LotOption[];
  /** True when this product is costed by picking the delivery by hand. */
  requiresLot: boolean;
}) {
  const [state, action, pending] = useActionState(issueAction, INITIAL);
  const [lot, setLot] = useState('');
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="precision" value={precision} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`How much went out (${unitLabel(unit as never)})`} htmlFor={`${id}-qty`}>
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="1500" />
        </Field>
        <Field label="Date it shipped" htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label="Reference" htmlFor={`${id}-ref`} hint="Your sales order or invoice number.">
          <Input id={`${id}-ref`} name="reference" placeholder="SO-9004" autoComplete="off" />
        </Field>
        <Field
          label={requiresLot ? 'Which delivery' : 'Which delivery (optional)'}
          htmlFor={`${id}-lot`}
          hint={
            requiresLot
              ? 'This product is costed one piece at a time, so the delivery has to be named.'
              : 'Leave blank and the oldest delivery is used first.'
          }
        >
          <Select
            id={`${id}-lot`}
            name="layerId"
            value={lot}
            onChange={(event) => setLot(event.target.value)}
            required={requiresLot}
          >
            <option value="">{requiresLot ? 'Choose a delivery…' : 'Oldest first'}</option>
            {lots.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending}>Ship it out</Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

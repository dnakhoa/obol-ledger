'use client';

import { useActionState, useId } from 'react';
import { Button } from './ui/button';
import { Field, Input } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import {
  issueAdjustmentAction,
  issueForSaleAction,
  saveSellerAction,
  type EInvoiceState,
} from '@/app/(app)/sales/einvoices/actions';

const INITIAL: EInvoiceState = { status: 'idle' };

function Outcome({ state }: { state: EInvoiceState }) {
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

export type SellerValues = {
  readonly legalName: string;
  readonly taxId: string;
  readonly address: string;
  readonly series: string;
};

/** The company as the tax office knows it, and the series it issues under this year. */
export function SellerForm({
  values,
  seriesPlaceholder,
  labels,
}: {
  values: SellerValues;
  seriesPlaceholder: string;
  labels: {
    readonly legalName: string;
    readonly taxId: string;
    readonly address: string;
    readonly series: string;
    readonly save: string;
    readonly working: string;
  };
}) {
  const [state, action, pending] = useActionState(saveSellerAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.legalName} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="legalName" required defaultValue={values.legalName} />
        </Field>
        <Field label={labels.taxId} htmlFor={`${id}-tax`}>
          <Input
            id={`${id}-tax`}
            name="taxId"
            required
            inputMode="numeric"
            placeholder="0101234567"
            defaultValue={values.taxId}
          />
        </Field>
        <Field label={labels.address} htmlFor={`${id}-address`}>
          <Input id={`${id}-address`} name="address" required defaultValue={values.address} />
        </Field>
        <Field label={labels.series} htmlFor={`${id}-series`}>
          <Input
            id={`${id}-series`}
            name="series"
            required
            placeholder={seriesPlaceholder}
            defaultValue={values.series}
            autoComplete="off"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.save}
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

/**
 * The buyer as the invoice will name them, and the button that issues it.
 *
 * Prefilled from the customer; what is typed here is kept on the customer,
 * so the next invoice to them needs nothing typed.
 */
export function IssueEInvoiceForm({
  saleId,
  customerAccountId,
  buyer,
  labels,
}: {
  saleId: string;
  customerAccountId: string;
  buyer: { readonly legalName: string; readonly taxId: string; readonly address: string };
  labels: {
    readonly buyerName: string;
    readonly buyerTaxId: string;
    readonly buyerTaxIdHint: string;
    readonly buyerAddress: string;
    readonly issue: string;
    readonly working: string;
  };
}) {
  const [state, action, pending] = useActionState(issueForSaleAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="customerAccountId" value={customerAccountId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={labels.buyerName} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="legalName" defaultValue={buyer.legalName} />
        </Field>
        <Field label={labels.buyerTaxId} htmlFor={`${id}-tax`} hint={labels.buyerTaxIdHint}>
          <Input id={`${id}-tax`} name="taxId" inputMode="numeric" defaultValue={buyer.taxId} />
        </Field>
        <Field label={labels.buyerAddress} htmlFor={`${id}-address`}>
          <Input id={`${id}-address`} name="address" defaultValue={buyer.address} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.issue}
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function IssueAdjustmentButton({
  saleId,
  creditNoteId,
  label,
  working,
}: {
  saleId: string;
  creditNoteId: string;
  label: string;
  working: string;
}) {
  const [state, action, pending] = useActionState(issueAdjustmentAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="saleId" value={saleId} />
      <input type="hidden" name="creditNoteId" value={creditNoteId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? working : label}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

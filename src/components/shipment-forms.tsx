'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import type { AccountOption } from './stock-forms';
import type { ShipmentState } from '@/app/(app)/stock/shipments/actions';
import { addChargeAction, recordShipmentAction } from '@/app/(app)/stock/shipments/actions';

const INITIAL: ShipmentState = { status: 'idle' };

function Outcome({ state }: { state: ShipmentState }) {
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

export type ShipmentLabels = {
  readonly reference: string;
  readonly referenceHint: string;
  readonly arrived: string;
  readonly create: string;
  readonly working: string;
};

export function RecordShipmentForm({ today, labels }: { today: string; labels: ShipmentLabels }) {
  const [state, action, pending] = useActionState(recordShipmentAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.reference} htmlFor={`${id}-ref`} hint={labels.referenceHint}>
          <Input
            id={`${id}-ref`}
            name="reference"
            required
            placeholder="CONT-4417"
            autoComplete="off"
          />
        </Field>
        <Field label={labels.arrived} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="arrivedAt" type="date" defaultValue={today} required />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.create}
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type ChargeLabels = {
  readonly kind: string;
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
  readonly basis: string;
  readonly basisHint: string;
  readonly creditAccount: string;
  readonly capitalise: string;
  readonly capitaliseHint: string;
  readonly capitaliseYes: string;
  readonly capitaliseNo: string;
  readonly debitAccount: string;
  readonly date: string;
  readonly submit: string;
  readonly working: string;
  readonly kinds: Readonly<Record<string, string>>;
  readonly bases: Readonly<Record<string, string>>;
};

/**
 * Adding a charge, with the one question that matters made explicit.
 *
 * "Is this part of what the goods cost?" is a radio rather than something
 * inferred from the account chosen, because the two answers are accounted for
 * completely differently and the accounts balance either way. Getting it wrong
 * is silent, so it is asked rather than guessed — and the account for the
 * reclaimable case only appears once the answer is no, which is the one place
 * this form hides anything and the only place hiding it is honest.
 */
export function AddChargeForm({
  shipmentId,
  currencies,
  creditAccounts,
  assetAccounts,
  today,
  labels,
}: {
  shipmentId: string;
  currencies: readonly string[];
  creditAccounts: readonly AccountOption[];
  assetAccounts: readonly AccountOption[];
  today: string;
  labels: ChargeLabels;
}) {
  const [state, action, pending] = useActionState(addChargeAction, INITIAL);
  const [capitalise, setCapitalise] = useState('yes');
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="shipmentId" value={shipmentId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.kind} htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" defaultValue="freight">
            {Object.entries(labels.kinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.description} htmlFor={`${id}-desc`}>
          <Input id={`${id}-desc`} name="description" required placeholder="Ocean freight" />
        </Field>
        <Field label={labels.amount} htmlFor={`${id}-amount`}>
          <Input
            id={`${id}-amount`}
            name="amount"
            required
            inputMode="decimal"
            placeholder="3400.00"
          />
        </Field>
        <Field label={labels.currency} htmlFor={`${id}-ccy`}>
          <Select id={`${id}-ccy`} name="currency" defaultValue={currencies[0]}>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.basis} htmlFor={`${id}-basis`} hint={labels.basisHint}>
          <Select id={`${id}-basis`} name="basis" defaultValue="value">
            {Object.entries(labels.bases).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.creditAccount} htmlFor={`${id}-credit`}>
          <Select id={`${id}-credit`} name="creditAccountId" required>
            {creditAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.capitalise} htmlFor={`${id}-cap`} hint={labels.capitaliseHint}>
          <Select
            id={`${id}-cap`}
            name="capitalise"
            value={capitalise}
            onChange={(event) => setCapitalise(event.target.value)}
          >
            <option value="yes">{labels.capitaliseYes}</option>
            <option value="no">{labels.capitaliseNo}</option>
          </Select>
        </Field>
        {capitalise === 'no' ? (
          <Field label={labels.debitAccount} htmlFor={`${id}-debit`}>
            <Select id={`${id}-debit`} name="debitAccountId" required>
              {assetAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.submit}
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

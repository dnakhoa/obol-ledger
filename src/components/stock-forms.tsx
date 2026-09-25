'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import { SUPPORTED_UNITS, unitLabel } from '@/lib/quantity';
import type { Messages } from '@/lib/i18n';
import type { StockState } from '@/app/(app)/stock/actions';
import {
  createItemAction,
  issueAction,
  receiveAction,
  returnToSupplierAction,
  writeOffAction,
} from '@/app/(app)/stock/actions';

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

function Submit({
  children,
  pending,
  working,
}: {
  children: React.ReactNode;
  pending: boolean;
  working: string;
}) {
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? working : children}
    </Button>
  );
}

export type AccountOption = { readonly id: string; readonly label: string };

export function AddProductForm({
  assetAccounts,
  expenseAccounts,
  labels,
  working,
}: {
  assetAccounts: readonly AccountOption[];
  expenseAccounts: readonly AccountOption[];
  /** Handed down from the server, so no dictionary reaches the client bundle. */
  labels: Messages['stock'];
  working: string;
}) {
  const [state, action, pending] = useActionState(createItemAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.productCode} htmlFor={`${id}-sku`} hint={labels.productCodeHint}>
          <Input id={`${id}-sku`} name="sku" required placeholder="GRN-600" autoComplete="off" />
        </Field>
        <Field label={labels.name} htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} name="name" required placeholder={labels.namePlaceholder} />
        </Field>
        <Field label={labels.measuredIn} htmlFor={`${id}-unit`} hint={labels.measuredInHint}>
          <Select id={`${id}-unit`} name="unit" defaultValue="m2">
            {SUPPORTED_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={labels.costingMethod}
          htmlFor={`${id}-method`}
          hint={labels.costingMethodHint}
        >
          <Select id={`${id}-method`} name="costingMethod" defaultValue="">
            <option value="">{labels.companyDefault}</option>
            <option value="fifo">{labels.methodFifoOption}</option>
            <option value="weighted_average">{labels.methodAverageOption}</option>
            <option value="specific">{labels.methodSpecificOption}</option>
          </Select>
        </Field>
        <Field label={labels.stockAccount} htmlFor={`${id}-stock`} hint={labels.stockAccountHint}>
          <Select id={`${id}-stock`} name="inventoryAccountId" required>
            {assetAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.cogsAccount} htmlFor={`${id}-cogs`} hint={labels.cogsAccountHint}>
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
        <Submit pending={pending} working={working}>
          {labels.addProductButton}
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

/**
 * Every label already resolved to a plain string.
 *
 * `howMuchArrived` takes the unit and `decimalHint` takes a number of places,
 * so in the dictionary they are functions — and a function cannot be
 * serialised across the server/client boundary. Calling them on the server and
 * handing the result down keeps the boundary made of data, which is also what
 * stops a dictionary being bundled for the browser.
 */
export type ReceiveLabels = {
  readonly quantity: string;
  readonly quantityHint: string;
  readonly cost: string;
  readonly costHint: string;
  readonly currency: string;
  readonly creditAccount: string;
  readonly creditAccountHint: string;
  readonly date: string;
  readonly reference: string;
  readonly referenceHint: string;
  readonly submit: string;
  readonly working: string;
};

export function ReceiveForm({
  itemId,
  unit,
  precision,
  currencies,
  creditAccounts,
  today,
  labels,
}: {
  itemId: string;
  unit: string;
  precision: number;
  currencies: readonly string[];
  creditAccounts: readonly AccountOption[];
  today: string;
  labels: ReceiveLabels;
}) {
  const [state, action, pending] = useActionState(receiveAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="precision" value={precision} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.quantity} htmlFor={`${id}-qty`} hint={labels.quantityHint}>
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="1000" />
        </Field>
        <Field label={labels.cost} htmlFor={`${id}-cost`} hint={labels.costHint}>
          <Input
            id={`${id}-cost`}
            name="cost"
            required
            inputMode="decimal"
            placeholder="40000.00"
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
        <Field
          label={labels.creditAccount}
          htmlFor={`${id}-credit`}
          hint={labels.creditAccountHint}
        >
          <Select id={`${id}-credit`} name="creditAccountId" required>
            {creditAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.reference} htmlFor={`${id}-ref`} hint={labels.referenceHint}>
          <Input id={`${id}-ref`} name="reference" placeholder="CONT-4417" autoComplete="off" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} working={labels.working}>
          {labels.submit}
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type LotOption = {
  readonly id: string;
  readonly label: string;
};

export type IssueLabels = {
  readonly quantity: string;
  readonly date: string;
  readonly reference: string;
  readonly referenceHint: string;
  readonly lot: string;
  readonly lotHint: string;
  readonly lotPlaceholder: string;
  readonly submit: string;
  readonly working: string;
};

export function IssueForm({
  itemId,
  unit,
  precision,
  today,
  lots,
  requiresLot,
  labels,
}: {
  itemId: string;
  unit: string;
  precision: number;
  today: string;
  lots: readonly LotOption[];
  /** True when this product is costed by picking the delivery by hand. */
  requiresLot: boolean;
  labels: IssueLabels;
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
        <Field label={labels.quantity} htmlFor={`${id}-qty`}>
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="1500" />
        </Field>
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.reference} htmlFor={`${id}-ref`} hint={labels.referenceHint}>
          <Input id={`${id}-ref`} name="reference" placeholder="SO-9004" autoComplete="off" />
        </Field>
        <Field label={labels.lot} htmlFor={`${id}-lot`} hint={labels.lotHint}>
          <Select
            id={`${id}-lot`}
            name="layerId"
            value={lot}
            onChange={(event) => setLot(event.target.value)}
            required={requiresLot}
          >
            <option value="">{labels.lotPlaceholder}</option>
            {lots.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} working={labels.working}>
          {labels.submit}
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type WriteOffLabels = {
  readonly quantity: string;
  readonly reason: string;
  readonly reasons: readonly { readonly value: string; readonly label: string }[];
  readonly lossAccount: string;
  readonly lossAccountHint: string;
  readonly date: string;
  readonly reference: string;
  readonly referenceHint: string;
  readonly lot: string;
  readonly lotHint: string;
  readonly lotPlaceholder: string;
  readonly submit: string;
  readonly working: string;
};

/**
 * Stock leaving without a sale.
 *
 * The same shape as shipping it out, plus the two things a write-off needs
 * and a shipment does not: why, and which expense takes the loss. Neither
 * has a default — "damaged" pre-selected is how every stocktake shortfall
 * ends up recorded as breakage, and the first expense in the chart is how it
 * ends up in finance costs.
 */
export function WriteOffForm({
  itemId,
  unit,
  precision,
  today,
  lots,
  requiresLot,
  expenseAccounts,
  labels,
}: {
  itemId: string;
  unit: string;
  precision: number;
  today: string;
  lots: readonly LotOption[];
  requiresLot: boolean;
  expenseAccounts: readonly AccountOption[];
  labels: WriteOffLabels;
}) {
  const [state, action, pending] = useActionState(writeOffAction, INITIAL);
  const [lot, setLot] = useState('');
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="precision" value={precision} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.quantity} htmlFor={`${id}-qty`}>
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="37" />
        </Field>
        <Field label={labels.reason} htmlFor={`${id}-reason`}>
          <Select id={`${id}-reason`} name="reason" required defaultValue="">
            <option value="" disabled>
              —
            </option>
            {labels.reasons.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.lossAccount} htmlFor={`${id}-loss`} hint={labels.lossAccountHint}>
          <Select id={`${id}-loss`} name="expenseAccountId" required defaultValue="">
            <option value="" disabled>
              —
            </option>
            {expenseAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.reference} htmlFor={`${id}-ref`} hint={labels.referenceHint}>
          <Input id={`${id}-ref`} name="reference" placeholder="KK-2026-01" autoComplete="off" />
        </Field>
        <Field label={labels.lot} htmlFor={`${id}-lot`} hint={labels.lotHint}>
          <Select
            id={`${id}-lot`}
            name="layerId"
            value={lot}
            onChange={(event) => setLot(event.target.value)}
            required={requiresLot}
          >
            <option value="">{labels.lotPlaceholder}</option>
            {lots.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} working={labels.working}>
          {labels.submit}
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export type ReturnableLotOption = {
  readonly id: string;
  readonly label: string;
  /** Resolved on the server: the refund is read in this lot's own currency. */
  readonly refundHint: string;
  /** Whether input VAT can be reversed on it: a purchase in the books' own currency. */
  readonly local: boolean;
};

export type SupplierReturnLabels = {
  readonly lot: string;
  readonly quantity: string;
  readonly refund: string;
  readonly refundedBy: string;
  readonly refundedByDefault: string;
  readonly unrefundedTo: string;
  readonly unrefundedToDefault: string;
  readonly taxToReverse: string;
  readonly taxToReverseHint: string;
  readonly noTax: string;
  readonly date: string;
  readonly reference: string;
  readonly referenceHint: string;
  readonly reason: string;
  readonly submit: string;
  readonly working: string;
};

/**
 * Part of a delivery going back to the supplier.
 *
 * Only the delivery, the quantity and the return number are needed; the rest
 * defaults to the ordinary case — refunded at the supplier's own price, by the
 * supplier the delivery was booked against, with no tax — and says so in the
 * empty option rather than hiding the choice.
 */
export function SupplierReturnForm({
  itemId,
  unit,
  precision,
  today,
  lots,
  counterpartyAccounts,
  expenseAccounts,
  taxCodes,
  labels,
}: {
  itemId: string;
  unit: string;
  precision: number;
  today: string;
  lots: readonly ReturnableLotOption[];
  counterpartyAccounts: readonly AccountOption[];
  expenseAccounts: readonly AccountOption[];
  taxCodes: readonly AccountOption[];
  labels: SupplierReturnLabels;
}) {
  const [state, action, pending] = useActionState(returnToSupplierAction, INITIAL);
  const [lotId, setLotId] = useState(lots.length === 1 ? (lots[0]?.id ?? '') : '');
  const lot = lots.find((candidate) => candidate.id === lotId);
  const id = useId();

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="precision" value={precision} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={labels.lot} htmlFor={`${id}-lot`}>
          <Select
            id={`${id}-lot`}
            name="layerId"
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            required
          >
            <option value="" disabled>
              —
            </option>
            {lots.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.quantity} htmlFor={`${id}-qty`}>
          <Input id={`${id}-qty`} name="quantity" required inputMode="decimal" placeholder="20" />
        </Field>
        <Field
          label={labels.refund}
          htmlFor={`${id}-refund`}
          {...(lot ? { hint: lot.refundHint } : {})}
        >
          <Input id={`${id}-refund`} name="refund" inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label={labels.reference} htmlFor={`${id}-ref`} hint={labels.referenceHint}>
          <Input
            id={`${id}-ref`}
            name="reference"
            required
            placeholder="RTV-2026-01"
            autoComplete="off"
          />
        </Field>
        <Field label={labels.date} htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} name="occurredAt" type="date" defaultValue={today} required />
        </Field>
        <Field label={labels.reason} htmlFor={`${id}-reason`}>
          <Input id={`${id}-reason`} name="reason" maxLength={280} autoComplete="off" />
        </Field>
        <Field label={labels.refundedBy} htmlFor={`${id}-by`}>
          <Select id={`${id}-by`} name="counterpartyAccountId" defaultValue="">
            <option value="">{labels.refundedByDefault}</option>
            {counterpartyAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.unrefundedTo} htmlFor={`${id}-rest`}>
          <Select id={`${id}-rest`} name="expenseAccountId" defaultValue="">
            <option value="">{labels.unrefundedToDefault}</option>
            {expenseAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </Field>
        {taxCodes.length > 0 ? (
          <Field label={labels.taxToReverse} htmlFor={`${id}-tax`} hint={labels.taxToReverseHint}>
            <Select
              id={`${id}-tax`}
              name="taxCodeId"
              defaultValue=""
              disabled={lot ? !lot.local : false}
            >
              <option value="">{labels.noTax}</option>
              {taxCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} working={labels.working}>
          {labels.submit}
        </Submit>
        <Outcome state={state} />
      </div>
    </form>
  );
}

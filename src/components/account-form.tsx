'use client';

import { useActionState } from 'react';
import { Button } from './ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ErrorSummary, Field, Input, Select, describedBy } from './ui/field';
import { ACCOUNT_TYPES, normalBalanceOf, type AccountType } from '@/server/domain/account';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import type { AccountFormState } from '@/app/(app)/accounts/new/actions';

const INITIAL: AccountFormState = { status: 'idle' };

/**
 * Opening an account.
 *
 * The class picker carries its consequence inline — choosing "Asset" tells you
 * debits increase it — because the debit/credit convention is the single thing
 * newcomers get wrong, and a form is where they are deciding.
 */
/** Resolved on the server, so no dictionary reaches the client bundle. */
export type AccountFormLabels = {
  readonly details: string;
  readonly intro: string;
  readonly neverDeleted: string;
  readonly name: string;
  readonly nameHint: string;
  readonly namePlaceholder: string;
  readonly currency: string;
  readonly klass: string;
  readonly allowOverdraft: string;
  readonly overdraftNote: string;
  readonly failed: string;
  readonly submit: string;
  readonly opening: string;
  readonly asset: string;
  readonly liability: string;
  readonly equity: string;
  readonly revenue: string;
  readonly expense: string;
  readonly assetBlurb: string;
  readonly liabilityBlurb: string;
  readonly equityBlurb: string;
  readonly revenueBlurb: string;
  readonly expenseBlurb: string;
};

export function AccountForm({
  action,
  labels,
}: {
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  labels: AccountFormLabels;
}) {
  // The class name and its one-line explanation, both from the dictionary —
  // the same pair the chart of accounts shows, so the two cannot disagree.
  const klass = (type: AccountType) =>
    ({
      asset: [labels.asset, labels.assetBlurb],
      liability: [labels.liability, labels.liabilityBlurb],
      equity: [labels.equity, labels.equityBlurb],
      revenue: [labels.revenue, labels.revenueBlurb],
      expense: [labels.expense, labels.expenseBlurb],
    })[type];
  const [state, submit, pending] = useActionState(action, INITIAL);
  const errorFor = (field: string) => state.fieldErrors?.find((e) => e.field === field)?.message;

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <ErrorSummary
          id="account-errors"
          title={state.message ?? labels.failed}
          errors={state.fieldErrors ?? []}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{labels.details}</CardTitle>
            <CardDescription>{labels.intro}</CardDescription>
          </div>
        </CardHeader>

        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={labels.name} htmlFor="name" hint={labels.nameHint} error={errorFor('name')}>
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              placeholder={labels.namePlaceholder}
              invalid={Boolean(errorFor('name'))}
              aria-describedby={describedBy('name', 'hint', errorFor('name'))}
            />
          </Field>

          <Field label={labels.currency} htmlFor="currency" error={errorFor('currency')}>
            <Select id="currency" name="currency" defaultValue="USD">
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={labels.klass}
            htmlFor="type"
            className="sm:col-span-2"
            error={errorFor('type')}
          >
            <Select id="type" name="type" defaultValue="asset">
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {klass(type)[0]} — {klass(type)[1]}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>

        <div className="border-line border-t px-4 py-4 sm:px-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="overdraftAllowed"
              className="border-line text-action mt-0.5 size-4 rounded"
            />
            <span>
              <span className="block text-sm font-medium">{labels.allowOverdraft}</span>
              <span className="text-ink-muted block text-xs">{labels.overdraftNote}</span>
            </span>
          </label>
        </div>

        <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <p className="text-ink-muted text-xs">{labels.neverDeleted}</p>
          <Button type="submit" disabled={pending}>
            {pending ? labels.opening : labels.submit}
          </Button>
        </div>
      </Card>
    </form>
  );
}

export { normalBalanceOf };

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
const CLASS_HINT: Record<AccountType, string> = {
  asset: 'What the business owns. Debits increase it.',
  liability: 'What the business owes. Credits increase it.',
  equity: 'The owners’ residual claim. Credits increase it.',
  revenue: 'Income earned. Credits increase it.',
  expense: 'Costs incurred. Debits increase it.',
};

export function AccountForm({
  action,
}: {
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const errorFor = (field: string) => state.fieldErrors?.find((e) => e.field === field)?.message;

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <ErrorSummary
          id="account-errors"
          title={state.message ?? 'The account could not be opened.'}
          errors={state.fieldErrors ?? []}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Account details</CardTitle>
            <CardDescription>
              A name and a class. The class determines which side increases the balance.
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            htmlFor="name"
            hint="Unique within its currency, e.g. “Operating Cash”."
            error={errorFor('name')}
          >
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              placeholder="Operating Cash"
              invalid={Boolean(errorFor('name'))}
              aria-describedby={describedBy('name', 'hint', errorFor('name'))}
            />
          </Field>

          <Field label="Currency" htmlFor="currency" error={errorFor('currency')}>
            <Select id="currency" name="currency" defaultValue="USD">
              {SUPPORTED_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Class" htmlFor="type" className="sm:col-span-2" error={errorFor('type')}>
            <Select id="type" name="type" defaultValue="asset">
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)} — {CLASS_HINT[type]}
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
              <span className="block text-sm font-medium">Allow overdraft</span>
              <span className="text-ink-muted block text-xs">
                When off, a posting that would take this account below zero is refused — by a CHECK
                constraint in Postgres as well as by the application. Contra accounts and most
                liability, equity and revenue accounts need this on.
              </span>
            </span>
          </label>
        </div>

        <div className="border-line flex items-center justify-between border-t px-4 py-3 sm:px-5">
          <p className="text-ink-muted text-xs">
            Accounts are never deleted. They can be closed, which keeps their history intact.
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? 'Opening…' : 'Open account'}
          </Button>
        </div>
      </Card>
    </form>
  );
}

export { normalBalanceOf };

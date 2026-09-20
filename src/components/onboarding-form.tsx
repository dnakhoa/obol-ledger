'use client';

import { useActionState } from 'react';
import { Button } from './ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ErrorSummary, Field, Input, Select } from './ui/field';
import type { OnboardingState } from '@/app/onboarding/actions';

const INITIAL: OnboardingState = { status: 'idle' };

export function OnboardingForm({
  action,
  currencies,
  suggestedName,
}: {
  action: (state: OnboardingState, formData: FormData) => Promise<OnboardingState>;
  currencies: readonly string[];
  suggestedName: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <ErrorSummary
          id="onboarding-errors"
          title={state.message ?? 'Something went wrong.'}
          errors={[]}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Your ledger</CardTitle>
            <CardDescription>
              A starter chart of accounts comes with it. You can rename, add and close accounts
              afterwards.
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          <Field label="Name" htmlFor="name" hint="Only you will see this.">
            <Input id="name" name="name" required maxLength={80} defaultValue={suggestedName} />
          </Field>

          <Field
            label="Functional currency"
            htmlFor="functionalCurrency"
            // Said plainly, because it is true and because a setting that
            // cannot be changed should say so before it is chosen, not after.
            hint="The currency your books are kept in. Every entry balances in it, so this cannot be changed later without restating everything you have posted."
          >
            <Select id="functionalCurrency" name="functionalCurrency" defaultValue="USD">
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating…' : 'Create my ledger'}
      </Button>
    </form>
  );
}

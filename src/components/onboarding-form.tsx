'use client';

import { useActionState } from 'react';
import { Button } from './ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ErrorSummary, Field, Input, Select } from './ui/field';
import type { OnboardingState } from '@/app/onboarding/actions';

const INITIAL: OnboardingState = { status: 'idle' };

export function OnboardingForm({
  labels,
  action,
  currencies,
  templates,
  suggestedName,
}: {
  /** Resolved on the server; a client component holds no dictionary. */
  labels: {
    yourLedger: string;
    starterChart: string;
    name: string;
    nameHint: string;
    chartOfAccounts: string;
    currency: string;
    currencyHint: string;
    creating: string;
    submit: string;
    failed: string;
    chartIsAStart: string;
  };
  action: (state: OnboardingState, formData: FormData) => Promise<OnboardingState>;
  currencies: readonly string[];
  templates: readonly { id: string; label: string; summary: string; statutory: boolean }[];
  suggestedName: string;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <ErrorSummary id="onboarding-errors" title={state.message ?? labels.failed} errors={[]} />
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>{labels.yourLedger}</CardTitle>
            <CardDescription>{labels.starterChart}</CardDescription>
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          <Field label={labels.name} htmlFor="name" hint={labels.nameHint}>
            <Input id="name" name="name" required maxLength={80} defaultValue={suggestedName} />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-ink-secondary text-xs font-medium">
              {labels.chartOfAccounts}
            </legend>
            <p className="text-ink-muted text-[11px]">{labels.chartIsAStart}</p>
            <div className="space-y-2">
              {templates.map((template, index) => (
                <label
                  key={template.id}
                  className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors duration-150"
                >
                  <input
                    type="radio"
                    name="chartTemplate"
                    value={template.id}
                    defaultChecked={index === 0}
                    className="accent-action mt-1 size-4"
                  />
                  <span className="min-w-0 space-y-0.5">
                    <span className="text-ink flex items-center gap-2 text-sm font-medium">
                      {template.label}
                      {template.statutory ? (
                        <span className="border-line text-ink-muted rounded-full border px-1.5 py-0.5 text-[10px] font-normal">
                          statutory
                        </span>
                      ) : null}
                    </span>
                    <span className="text-ink-muted block text-[11px]">{template.summary}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label={labels.currency}
            htmlFor="functionalCurrency"
            // Said plainly, because it is true and because a setting that
            // cannot be changed should say so before it is chosen, not after.
            hint={labels.currencyHint}
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
        {pending ? labels.creating : labels.submit}
      </Button>
    </form>
  );
}

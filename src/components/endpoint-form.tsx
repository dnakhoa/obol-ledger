'use client';

import { useActionState, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ErrorSummary, Field, Input, describedBy } from './ui/field';
import { CheckIcon } from './icons';
import { WEBHOOK_EVENT_TYPES } from '@/server/domain/webhook';
import type { EndpointFormState } from '@/app/(app)/webhooks/actions';

const INITIAL: EndpointFormState = { status: 'idle' };

const EVENT_HINT: Record<string, string> = {
  'entry.posted': 'An entry settled immediately.',
  'entry.pending': 'An authorisation reserved funds.',
  'entry.settled': 'A pending entry was posted.',
  'entry.archived': 'A pending entry was cancelled.',
  'entry.reversed': 'An entry was corrected by its mirror image.',
  'account.opened': 'A new account joined the chart.',
};

/**
 * Registering a subscriber.
 *
 * The secret appears once, in the response to this submission, and the copy
 * says so before you submit rather than after. A "you will not see this again"
 * notice that arrives *with* the value is a notice most people read too late.
 */
export function EndpointForm({
  action,
}: {
  action: (state: EndpointFormState, formData: FormData) => Promise<EndpointFormState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const errorFor = (field: string) => state.fieldErrors?.find((e) => e.field === field)?.message;

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <ErrorSummary
          id="endpoint-errors"
          title={state.message ?? 'The endpoint could not be registered.'}
          errors={state.fieldErrors ?? []}
        />
      ) : null}

      {state.status === 'created' && state.secret ? (
        <div className="border-positive/30 bg-positive-soft rounded-card space-y-2 border p-4">
          <p className="text-positive flex items-center gap-2 text-sm font-medium">
            <CheckIcon width={14} height={14} />
            {state.message}
          </p>
          <p className="text-ink-secondary text-xs">
            This is the signing secret. It is shown once and cannot be read back — if it is lost,
            rotate the endpoint rather than recovering it.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="border-line bg-surface text-ink flex-1 rounded-md border px-3 py-2 font-mono text-xs break-all">
              {state.secret}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.secret ?? '');
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Register an endpoint</CardTitle>
            <CardDescription>
              Deliveries are signed to the Standard Webhooks specification and retried with
              exponential backoff.
            </CardDescription>
          </div>
        </CardHeader>

        <CardBody className="space-y-4">
          <Field
            label="Endpoint URL"
            htmlFor="url"
            hint="Must be https. Try a https://webhook.site URL to watch deliveries arrive."
            error={errorFor('url')}
          >
            <Input
              id="url"
              name="url"
              type="url"
              required
              placeholder="https://example.com/webhooks/ledger"
              invalid={Boolean(errorFor('url'))}
              aria-describedby={describedBy('url', 'Must be https.', errorFor('url'))}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            hint="Optional. For your own reference."
            error={errorFor('description')}
          >
            <Input id="description" name="description" maxLength={200} placeholder="Billing sync" />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-ink-secondary text-xs font-medium">Events</legend>
            <p className="text-ink-muted text-[11px]">
              Leave every box unchecked to receive all of them — missing an event is worse than
              receiving one you ignore.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENT_TYPES.map((type) => (
                <label
                  key={type}
                  className="border-line hover:bg-surface-hover flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors duration-150"
                >
                  <input
                    type="checkbox"
                    name="eventTypes"
                    value={type}
                    className="accent-action mt-0.5 size-4"
                  />
                  <span className="space-y-0.5">
                    <span className="text-ink block font-mono text-xs">{type}</span>
                    <span className="text-ink-muted block text-[11px]">{EVENT_HINT[type]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Registering…' : 'Register endpoint'}
        </Button>
      </div>
    </form>
  );
}

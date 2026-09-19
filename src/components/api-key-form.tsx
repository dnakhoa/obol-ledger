'use client';

import { useActionState, useState } from 'react';
import { Button } from './ui/button';
import { Field, Input, describedBy, ErrorSummary } from './ui/field';
import { CheckIcon } from './icons';
import type { ApiKeyFormState } from '@/app/(app)/settings/actions';

const INITIAL: ApiKeyFormState = { status: 'idle' };

export function ApiKeyForm({
  action,
}: {
  action: (state: ApiKeyFormState, formData: FormData) => Promise<ApiKeyFormState>;
}) {
  const [state, submit, pending] = useActionState(action, INITIAL);
  const [copied, setCopied] = useState(false);
  const nameError = state.fieldErrors?.find((issue) => issue.field === 'name')?.message;

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' && !nameError ? (
        <ErrorSummary
          id="api-key-errors"
          title={state.message ?? 'The key could not be issued.'}
          errors={state.fieldErrors ?? []}
        />
      ) : null}

      {state.status === 'issued' && state.token ? (
        <div className="border-positive/30 bg-positive-soft rounded-card space-y-2 border p-4">
          <p className="text-positive flex items-center gap-2 text-sm font-medium">
            <CheckIcon width={14} height={14} />
            {state.message}
          </p>
          <p className="text-ink-secondary text-xs">
            Copy it now. Only a SHA-256 digest is stored, so this is the one and only time the token
            exists outside your hands.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="border-line bg-surface text-ink flex-1 rounded-md border px-3 py-2 font-mono text-xs break-all">
              {state.token}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.token ?? '');
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Key name"
          htmlFor="name"
          hint="Where it will be used, e.g. “CI deploy”."
          error={nameError}
          className="min-w-[14rem] flex-1"
        >
          <Input
            id="name"
            name="name"
            required
            maxLength={80}
            placeholder="Local experiments"
            invalid={Boolean(nameError)}
            aria-describedby={describedBy('name', 'Where it will be used.', nameError)}
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Issuing…' : 'Issue key'}
        </Button>
      </div>
    </form>
  );
}

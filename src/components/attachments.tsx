'use client';

import { useActionState, useId, useRef } from 'react';
import { Button } from './ui/button';
import { Field, Input, Select } from './ui/field';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import {
  attachDocumentAction,
  detachDocumentAction,
  type AttachmentState,
} from '@/app/(app)/documents/actions';

const INITIAL: AttachmentState = { status: 'idle' };

export type AttachmentItem = {
  readonly id: string;
  readonly documentId: string;
  readonly filename: string;
  readonly kindLabel: string;
  readonly size: string;
  readonly note: string | null;
  readonly attachedOn: string;
};

export type AttachmentLabels = {
  readonly none: string;
  readonly file: string;
  readonly kind: string;
  readonly kinds: readonly { readonly value: string; readonly label: string }[];
  readonly note: string;
  readonly attach: string;
  readonly remove: string;
  readonly download: string;
  readonly working: string;
};

/**
 * The documents behind an entry, a sale or a shipment, and a way to add one.
 *
 * Each file opens in the browser — a PDF or a photo is read, not downloaded —
 * with a separate link to save it. Removing takes the attachment off; the
 * file itself stays on record, which the confirmation message says.
 */
export function Attachments({
  items,
  target,
  path,
  canWrite,
  labels,
}: {
  items: readonly AttachmentItem[];
  target: { readonly transactionId: string } | { readonly shipmentId: string };
  /** The page this sits on, refreshed after a change. */
  path: string;
  canWrite: boolean;
  labels: AttachmentLabels;
}) {
  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="text-ink-muted text-sm">{labels.none}</p>
      ) : (
        <ul className="divide-line border-line divide-y rounded-lg border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <a
                  href={`/files/${item.documentId}`}
                  target="_blank"
                  rel="noopener"
                  className="hover:text-action block truncate text-sm font-medium underline-offset-4 hover:underline"
                >
                  {item.filename}
                </a>
                <span className="text-ink-muted text-xs">
                  {item.kindLabel} · {item.size} · {item.attachedOn}
                  {item.note ? ` · ${item.note}` : ''}
                </span>
              </div>
              <a
                href={`/files/${item.documentId}?download=1`}
                className="text-ink-secondary hover:text-ink text-xs underline-offset-4 hover:underline"
              >
                {labels.download}
              </a>
              {canWrite ? <Remove linkId={item.id} path={path} labels={labels} /> : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? <Upload target={target} path={path} labels={labels} /> : null}
    </div>
  );
}

function Remove({
  linkId,
  path,
  labels,
}: {
  linkId: string;
  path: string;
  labels: AttachmentLabels;
}) {
  const [state, action, pending] = useActionState(detachDocumentAction, INITIAL);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="linkId" value={linkId} />
      <input type="hidden" name="path" value={path} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? labels.working : labels.remove}
      </Button>
      {state.status === 'error' ? <Outcome state={state} /> : null}
    </form>
  );
}

function Upload({
  target,
  path,
  labels,
}: {
  target: { readonly transactionId: string } | { readonly shipmentId: string };
  path: string;
  labels: AttachmentLabels;
}) {
  const [state, action, pending] = useActionState(
    async (previous: AttachmentState, formData: FormData) => {
      const next = await attachDocumentAction(previous, formData);
      if (next.status === 'done') form.current?.reset();
      return next;
    },
    INITIAL,
  );
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  return (
    <form ref={form} action={action} className="space-y-3">
      <input
        type="hidden"
        name="transactionId"
        value={'transactionId' in target ? target.transactionId : ''}
      />
      <input
        type="hidden"
        name="shipmentId"
        value={'shipmentId' in target ? target.shipmentId : ''}
      />
      <input type="hidden" name="path" value={path} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={labels.file} htmlFor={`${id}-file`}>
          <Input
            id={`${id}-file`}
            name="file"
            type="file"
            required
            accept="application/pdf,image/png,image/jpeg,image/webp,.xml,application/xml,text/xml"
            className="file:text-ink-secondary pt-1.5 file:mr-2 file:border-0 file:bg-transparent file:text-xs"
          />
        </Field>
        <Field label={labels.kind} htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" defaultValue="invoice" required>
            {labels.kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={labels.note} htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} name="note" maxLength={280} autoComplete="off" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? labels.working : labels.attach}
        </Button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

function Outcome({ state }: { state: AttachmentState }) {
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

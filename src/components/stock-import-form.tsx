'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from './ui/button';
import { Field, Select } from './ui/field';
import { Badge } from './ui/badge';
import { Table, TableScroll, Td, Th, Tr } from './ui/table';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import type { AccountOption } from './stock-forms';
import type { ImportState } from '@/app/(app)/stock/import/actions';
import { applyImportAction, previewImportAction } from '@/app/(app)/stock/import/actions';

const INITIAL: ImportState = { status: 'idle' };

/**
 * Paste, look, then import.
 *
 * Two presses rather than one, because the person doing this is moving several
 * hundred rows of their own history into a system they have used for ten
 * minutes. The middle step shows every row as the ledger read it — their own
 * container numbers, the date resolved to an unambiguous one — and nothing has
 * been written when they read it.
 */
/**
 * Only the labels that are plain strings.
 *
 * Everything that takes a number or a column list is formatted on the server
 * and arrives in `state.notes`, because a function cannot be serialised across
 * this boundary — and because keeping it that way is what stops three
 * dictionaries being bundled for the browser.
 */
export type ImportLabels = {
  readonly pasteLabel: string;
  readonly pasteHint: string;
  readonly pastePlaceholder: string;
  readonly chargeTo: string;
  readonly chargeToHint: string;
  readonly stockAccount: string;
  readonly stockAccountHint: string;
  readonly cogsAccount: string;
  readonly cogsAccountHint: string;
  readonly checkButton: string;
  readonly checking: string;
  readonly importing: string;
  readonly previewCaption: string;
  readonly row: string;
  readonly product: string;
  readonly arrived: string;
  readonly quantity: string;
  readonly cost: string;
  readonly reference: string;
  readonly status: string;
  readonly ready: string;
  readonly newBadge: string;
  readonly fixFirst: string;
};

export function StockImportForm({
  assetAccounts,
  expenseAccounts,
  creditAccounts,
  labels,
}: {
  assetAccounts: readonly AccountOption[];
  expenseAccounts: readonly AccountOption[];
  creditAccounts: readonly AccountOption[];
  labels: ImportLabels;
}) {
  const [state, action, pending] = useActionState(previewImportAction, INITIAL);
  const [applied, applyAction, applying] = useActionState(applyImportAction, INITIAL);
  const [text, setText] = useState('');
  const id = useId();

  // The apply is the last word: once it has run, its outcome is what the page
  // reports, whatever the earlier preview said.
  const outcome = applied.status === 'idle' ? state : applied;
  const preview = applied.status === 'done' ? undefined : state.preview;
  const notes = applied.status === 'done' ? undefined : state.notes;

  const accountFields = (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label={labels.chargeTo} htmlFor={`${id}-credit`} hint={labels.chargeToHint}>
        <Select id={`${id}-credit`} name="creditAccountId" required>
          {creditAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
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
  );

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <Field label={labels.pasteLabel} htmlFor={`${id}-text`} hint={labels.pasteHint}>
          <textarea
            id={`${id}-text`}
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={labels.pastePlaceholder}
            className="border-line bg-surface placeholder:text-ink-muted numeric w-full rounded-lg border px-3 py-2 font-mono text-xs"
          />
        </Field>

        {accountFields}

        <div className="flex flex-wrap items-center gap-3">
          {/*
            Pressable even with the box empty. A button that greys itself out
            teaches nothing — the person is left guessing which of the four
            fields it is unhappy about — whereas pressing it gets a sentence
            back naming what is missing. Checking costs a round trip and writes
            nothing, so there is no reason to guard it.
          */}
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? labels.checking : labels.checkButton}
          </Button>
          <Outcome state={outcome} />
        </div>
      </form>

      {preview ? (
        <div className="space-y-4">
          <div className="text-ink-secondary flex flex-wrap items-center gap-2 text-xs">
            {notes ? <Badge>{notes.separator}</Badge> : null}
            {notes?.missingColumns ? (
              <span className="text-caution">{notes.missingColumns}</span>
            ) : null}
            {notes?.ignoredColumns ? <span>{notes.ignoredColumns}</span> : null}
          </div>

          <TableScroll>
            <Table caption={labels.previewCaption}>
              <thead>
                <tr>
                  <Th>{labels.row}</Th>
                  <Th>{labels.product}</Th>
                  <Th>{labels.arrived}</Th>
                  <Th align="right">{labels.quantity}</Th>
                  <Th align="right">{labels.cost}</Th>
                  <Th>{labels.reference}</Th>
                  <Th>{labels.status}</Th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <Tr key={row.line}>
                    <Td numeric>{row.line}</Td>
                    <Td>
                      {row.sku}
                      {row.createsProduct && !row.problem ? (
                        <Badge className="ml-2">{labels.newBadge}</Badge>
                      ) : null}
                    </Td>
                    <Td numeric>{row.date || '—'}</Td>
                    <Td align="right" numeric>
                      {row.quantity} {row.unit}
                    </Td>
                    <Td align="right" numeric>
                      {row.cost} {row.currency}
                    </Td>
                    <Td>{row.reference || '—'}</Td>
                    <Td>
                      {row.problem ? (
                        <span className="text-caution text-xs">{row.problem}</span>
                      ) : (
                        <span className="text-positive text-xs">{labels.ready}</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>

          <form action={applyAction} className="space-y-4">
            <input type="hidden" name="text" value={state.text ?? text} />
            {accountFields}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={applying || preview.problems > 0 || preview.rows.length === 0}
              >
                {applying ? labels.importing : (notes?.importButton ?? '')}
              </Button>
              {preview.problems > 0 ? (
                <p className="text-ink-secondary text-xs">{labels.fixFirst}</p>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {applied.problems?.length ? (
        <ul className="text-caution space-y-1 text-xs">
          {applied.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Outcome({ state }: { state: ImportState }) {
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

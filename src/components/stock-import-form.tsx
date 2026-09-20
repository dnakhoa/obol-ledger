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

const SEPARATOR_BLURB: Record<string, string> = {
  tab: 'Tab separated — read straight out of Excel.',
  semicolon: 'Semicolon separated, which is what Excel writes in most of Europe and in Vietnam.',
  comma: 'Comma separated.',
};

/**
 * Paste, look, then import.
 *
 * Two presses rather than one, because the person doing this is moving several
 * hundred rows of their own history into a system they have used for ten
 * minutes. The middle step shows every row as the ledger read it — their own
 * container numbers, the date resolved to an unambiguous one — and nothing has
 * been written when they read it.
 */
export function StockImportForm({
  assetAccounts,
  expenseAccounts,
  creditAccounts,
}: {
  assetAccounts: readonly AccountOption[];
  expenseAccounts: readonly AccountOption[];
  creditAccounts: readonly AccountOption[];
}) {
  const [state, action, pending] = useActionState(previewImportAction, INITIAL);
  const [applied, applyAction, applying] = useActionState(applyImportAction, INITIAL);
  const [text, setText] = useState('');
  const id = useId();

  // The apply is the last word: once it has run, its outcome is what the page
  // reports, whatever the earlier preview said.
  const outcome = applied.status === 'idle' ? state : applied;
  const preview = applied.status === 'done' ? undefined : state.preview;

  const accountFields = (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field
        label="Charge the deliveries to"
        htmlFor={`${id}-credit`}
        hint="The supplier you owe, or the bank it came out of."
      >
        <Select id={`${id}-credit`} name="creditAccountId" required>
          {creditAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Stock account" htmlFor={`${id}-stock`} hint="For any product the file opens.">
        <Select id={`${id}-stock`} name="inventoryAccountId" required>
          {assetAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Cost of sales account" htmlFor={`${id}-cogs`} hint="Where its cost goes later.">
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
        <Field
          label="Paste your rows"
          htmlFor={`${id}-text`}
          hint="Select the block in Excel and paste it here, header row and all. A .csv file's contents work too."
        >
          <textarea
            id={`${id}-text`}
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={
              'Product Code\tName\tUnit\tDate Received\tQuantity\tTotal Cost\tContainer\nPAV-600\tGranite paver 600×600\tm2\t10/01/2026\t1000\t40000.00\tCONT-4417'
            }
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
            {pending ? 'Reading…' : 'Check the rows'}
          </Button>
          <Outcome state={outcome} />
        </div>
      </form>

      {preview ? (
        <div className="space-y-4">
          <div className="text-ink-secondary flex flex-wrap items-center gap-2 text-xs">
            <Badge>{SEPARATOR_BLURB[preview.separator] ?? preview.separator}</Badge>
            {preview.missingColumns.length > 0 ? (
              <span className="text-caution">
                No {preview.missingColumns.join(', ')} column was found. The rows below are shown as
                they were read, so you can see which header did not match.
              </span>
            ) : null}
            {preview.ignoredColumns.length > 0 ? (
              <span>
                Columns not used: {preview.ignoredColumns.join(', ')}. Nothing was lost — they are
                simply not part of a delivery.
              </span>
            ) : null}
          </div>

          <TableScroll>
            <Table caption="Every row as the ledger read it">
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Product</Th>
                  <Th>Arrived</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Cost</Th>
                  <Th>Reference</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <Tr key={row.line}>
                    <Td numeric>{row.line}</Td>
                    <Td>
                      {row.sku}
                      {row.createsProduct && !row.problem ? (
                        <Badge className="ml-2">new</Badge>
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
                        <span className="text-positive text-xs">Ready</span>
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
                {applying
                  ? 'Importing…'
                  : `Import ${preview.rows.length} deliver${preview.rows.length === 1 ? 'y' : 'ies'}`}
              </Button>
              {preview.problems > 0 ? (
                <p className="text-ink-secondary text-xs">
                  Fix the rows marked above and check again. The import is all or nothing — it will
                  not bring in the good rows and leave the rest.
                </p>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {applied.problems?.length ? (
        <ul className="text-caution space-y-1 text-xs">
          {applied.problems.map((problem) => (
            <li key={problem.line}>
              Row {problem.line}: {problem.problem}
            </li>
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

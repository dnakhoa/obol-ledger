'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Field, ErrorSummary, Input, Select, describedBy } from './ui/field';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { AlertIcon, CheckIcon } from './icons';
import { cn } from '@/lib/cn';
import { groupDecimalString } from '@/lib/format';
import { parseDecimal, toDecimalString, ZERO, type CurrencyCode } from '@/lib/money';
import type { EntryFormState } from '@/app/(app)/transfer/actions';
import type { AccountDto } from '@/server/services/dto';

/**
 * Composes a journal entry.
 *
 * The interesting decision is where the balance rule lives. It runs *here*, as
 * the user types, because "your entry is out by 0.01" is only useful while they
 * can still fix it — but this check is a convenience, not the guarantee. The
 * same rule runs again in the domain layer and a third time as a deferred
 * constraint inside Postgres. The browser copy may be bypassed freely; it has
 * no authority, only helpfulness.
 *
 * Progressive enhancement: the rows are plain repeated form fields, so the form
 * submits and posts correctly with JavaScript disabled. What JavaScript adds is
 * the running total and the ability to add a third leg.
 */
type Row = { key: number; accountId: string; direction: 'debit' | 'credit'; amount: string };

const INITIAL_STATE: EntryFormState = { status: 'idle' };

let nextKey = 0;
const emptyRow = (direction: 'debit' | 'credit'): Row => ({
  key: nextKey++,
  accountId: '',
  direction,
  amount: '',
});

const freshRows = (): Row[] => [emptyRow('debit'), emptyRow('credit')];

export function EntryComposer({
  accounts,
  currency,
  action,
}: {
  accounts: AccountDto[];
  currency: CurrencyCode;
  action: (state: EntryFormState, formData: FormData) => Promise<EntryFormState>;
}) {
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>(freshRows);
  const summaryRef = useRef<HTMLDivElement>(null);

  /**
   * React resets a form's DOM once its action resolves. That is right after a
   * successful post and wrong after a rejected one: re-typing a five-line entry
   * because the server found it out by a cent would be infuriating.
   *
   * So the fields are driven from state, and this counter keys the subtree —
   * bumping it remounts the controls, each one re-reads its value from state,
   * and the reset is undone. On success the state is cleared first, so the same
   * mechanism hands back an empty form ready for the next entry.
   */
  const [formVersion, setFormVersion] = useState(0);

  /**
   * The reset happens inside the action rather than in an effect watching the
   * result. An effect would run *after* the render that showed the stale form,
   * producing a second render to correct it; here it is one event-driven update
   * that lands with the result.
   */
  const [state, submit, pending] = useActionState(
    async (previous: EntryFormState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.status === 'success') {
        setDescription('');
        setRows(freshRows());
      }
      setFormVersion((version) => version + 1);
      return result;
    },
    INITIAL_STATE,
  );

  // Focusing a DOM node is exactly what an effect is for: it synchronises React
  // with an external system once the error summary actually exists.
  useEffect(() => {
    if (state.status === 'error') summaryRef.current?.focus();
  }, [state]);

  const balance = useMemo(() => {
    let residual = ZERO;
    let complete = true;

    for (const row of rows) {
      if (row.amount.trim() === '' || row.accountId === '') {
        complete = false;
        continue;
      }
      const parsed = parseDecimal(row.amount, currency);
      if (!parsed.ok) {
        complete = false;
        continue;
      }
      residual = (residual +
        (row.direction === 'debit' ? parsed.value : -parsed.value)) as typeof residual;
    }

    return { residual, complete, balanced: residual === 0n };
  }, [rows, currency]);

  const balanceTone = !balance.complete ? 'neutral' : balance.balanced ? 'positive' : 'caution';
  const balanceLabel = !balance.complete
    ? 'Incomplete'
    : balance.balanced
      ? 'Balanced'
      : `Out by ${groupDecimalString(toDecimalString(balance.residual, currency))}`;

  const errorFor = (field: string): string | undefined =>
    state.fieldErrors?.find((issue) => issue.field === field)?.message;

  const usable = accounts.filter((account) => account.status === 'open');
  const canSubmit = rows.filter((row) => row.accountId && row.amount).length >= 2;

  return (
    <form action={submit} className="space-y-4">
      {state.status === 'error' ? (
        <div ref={summaryRef} tabIndex={-1}>
          <ErrorSummary
            id="entry-errors"
            title={state.message ?? 'The entry could not be posted.'}
            errors={state.fieldErrors ?? []}
          />
        </div>
      ) : null}

      {state.status === 'success' ? (
        <div
          role="status"
          className="border-positive bg-positive-soft text-positive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
        >
          <CheckIcon />
          <span>{state.message}</span>
          <Link href="/journal" className="ml-auto font-medium underline">
            View journal
          </Link>
        </div>
      ) : null}

      <div key={formVersion} className="space-y-4">
        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>Entry details</CardTitle>
              <CardDescription>What happened, and when it is denominated.</CardDescription>
            </div>
          </CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field
              label="Description"
              htmlFor="description"
              hint="What this entry records, e.g. “Invoice 1042 settled”."
              error={errorFor('description')}
            >
              <Input
                id="description"
                name="description"
                required
                maxLength={280}
                placeholder="Coffee beans purchased"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                invalid={Boolean(errorFor('description'))}
                aria-describedby={describedBy(
                  'description',
                  'hint',
                  errorFor('description') ?? undefined,
                )}
              />
            </Field>
            <Field label="Currency" htmlFor="currency">
              {/*
              One currency per entry is a domain rule, not a UI simplification:
              a composite foreign key means a posting in a currency its account
              does not hold is unrepresentable in the database.
            */}
              <Select id="currency" name="currency" defaultValue={currency}>
                <option value={currency}>{currency}</option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>Postings</CardTitle>
              <CardDescription>
                Debits and credits must total the same amount. Nothing else is a valid entry.
              </CardDescription>
            </div>
            {/*
            Three states, not two. "Out by 0.00" on an untouched form reads as
            an error about nothing; an incomplete entry is simply not yet an
            entry, and only a filled-in one can be out of balance.
          */}
            <Badge tone={balanceTone}>
              {balance.complete && balance.balanced ? (
                <CheckIcon width={11} height={11} />
              ) : (
                <AlertIcon width={11} height={11} />
              )}
              {balanceLabel}
            </Badge>
          </CardHeader>

          <CardBody className="space-y-3">
            {rows.map((row, index) => {
              const amountId = `postings-${index}-amount`;
              const amountError = errorFor(`postings.${index}.amount`);
              return (
                <div
                  key={row.key}
                  className="grid gap-3 sm:grid-cols-[1fr_7.5rem_9rem_2.25rem] sm:items-start"
                >
                  <Field
                    label={`Line ${index + 1} account`}
                    htmlFor={`postings-${index}-accountId`}
                    error={errorFor(`postings.${index}.accountId`)}
                  >
                    <Select
                      id={`postings-${index}-accountId`}
                      name="accountId"
                      required
                      value={row.accountId}
                      invalid={Boolean(errorFor(`postings.${index}.accountId`))}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? { ...item, accountId: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="">Select an account…</option>
                      {usable.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name} · {account.type}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Side" htmlFor={`postings-${index}-direction`}>
                    <Select
                      id={`postings-${index}-direction`}
                      name="direction"
                      value={row.direction}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.key === row.key
                              ? { ...item, direction: event.target.value as 'debit' | 'credit' }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </Select>
                  </Field>

                  <Field label="Amount" htmlFor={amountId} error={amountError}>
                    <Input
                      id={amountId}
                      name="amount"
                      required
                      inputMode="decimal"
                      // A text input, not type="number": a spinner on a money
                      // field invites scroll-wheel mistakes, and the browser's
                      // numeric parsing is exactly the float behaviour we avoid.
                      type="text"
                      placeholder="0.00"
                      className="numeric text-right"
                      value={row.amount}
                      invalid={Boolean(amountError)}
                      aria-describedby={describedBy(amountId, undefined, amountError)}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item) =>
                            item.key === row.key ? { ...item, amount: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>

                  <div className="flex items-end justify-end sm:h-[3.6rem]">
                    <button
                      type="button"
                      onClick={() =>
                        setRows((current) => current.filter((item) => item.key !== row.key))
                      }
                      disabled={rows.length <= 2}
                      className={cn(
                        'border-line text-ink-muted flex size-9 cursor-pointer items-center justify-center rounded-lg border transition-colors duration-150',
                        'hover:border-negative hover:text-negative disabled:pointer-events-none disabled:opacity-30',
                      )}
                    >
                      <span aria-hidden="true">&times;</span>
                      <span className="sr-only">Remove line {index + 1}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRows((current) => [...current, emptyRow('credit')])}
            >
              Add a line
            </Button>
          </CardBody>

          <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
            <p className="text-ink-muted text-xs">
              {balance.complete && balance.balanced
                ? 'Debits equal credits. This entry is ready to post.'
                : 'An entry is only accepted when its postings sum to zero.'}
            </p>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? 'Posting…' : 'Post entry'}
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describe as describeError } from '@/server/domain/errors';
import { SUPPORTED_CURRENCIES } from '@/lib/money';

export type MonthEndState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const monthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);

/**
 * Month end, as three things a person can do in order.
 *
 * Each action reports back in the same shape so the page can say what
 * happened in one sentence. A refusal from the ledger — a missing rate, a
 * month that has not finished, foreign balances nobody retranslated — is a
 * *message*, not an error page: these are the ordinary outcomes of pressing
 * the button too early, and the whole point of the screen is that pressing it
 * too early is safe.
 */

export async function recordRateAction(
  _previous: MonthEndState,
  formData: FormData,
): Promise<MonthEndState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      base: z.enum(SUPPORTED_CURRENCIES),
      rate: z
        .string()
        .trim()
        .regex(/^\d+(\.\d{1,10})?$/u),
      asOf: z.iso.date(),
    })
    .safeParse({
      base: formData.get('base'),
      rate: formData.get('rate'),
      asOf: formData.get('asOf'),
    });

  if (!parsed.success) {
    return { status: 'error', message: 'Enter a rate as a plain number, for example 25700.' };
  }

  const functional = String(formData.get('quote') ?? 'USD');
  const result = await writer.services.rates.record({
    base: parsed.data.base,
    quote: functional as (typeof SUPPORTED_CURRENCIES)[number],
    rate: parsed.data.rate,
    asOf: parsed.data.asOf,
    source: 'manual',
  });

  revalidatePath('/month-end');
  return result.ok
    ? {
        status: 'done',
        message: `Saved 1 ${parsed.data.base} = ${parsed.data.rate} ${functional} for ${parsed.data.asOf}.`,
      }
    : { status: 'error', message: describeError(result.error) };
}

export async function revalueAction(
  _previous: MonthEndState,
  formData: FormData,
): Promise<MonthEndState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const month = monthField.safeParse(formData.get('month'));
  if (!month.success) return { status: 'error', message: 'Pick a month first.' };

  const result = await writer.services.revaluation.revalue(`${month.data}-01`);
  revalidatePath('/month-end');

  if (!result.ok) return { status: 'error', message: describeError(result.error) };

  return {
    status: 'done',
    message: result.value.entry
      ? `Updated ${result.value.lines.length} foreign balance(s) to the month-end rate.`
      : 'Checked every foreign balance — the rates had not moved, so nothing needed changing.',
  };
}

export async function closeMonthAction(
  _previous: MonthEndState,
  formData: FormData,
): Promise<MonthEndState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const month = monthField.safeParse(formData.get('month'));
  if (!month.success) return { status: 'error', message: 'Pick a month first.' };

  const result = await writer.services.periods.close(`${month.data}-01`);
  revalidatePath('/month-end');
  revalidatePath('/journal');

  return result.ok
    ? { status: 'done', message: `${month.data} is closed. Its figures will not change again.` }
    : { status: 'error', message: describeError(result.error) };
}

export async function reopenMonthAction(
  _previous: MonthEndState,
  formData: FormData,
): Promise<MonthEndState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const month = monthField.safeParse(formData.get('month'));
  if (!month.success) return { status: 'error', message: 'Pick a month first.' };

  const result = await writer.services.periods.reopen(`${month.data}-01`);
  revalidatePath('/month-end');

  return result.ok
    ? {
        status: 'done',
        message: `${month.data} is open again. The closing entry has been reversed, and both stay on the record.`,
      }
    : { status: 'error', message: describeError(result.error) };
}

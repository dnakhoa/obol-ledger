'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { formatAmount } from '@/lib/format';
import { describeError, translations } from '@/server/i18n';
import type { MoneyDto } from '@/server/services/dto';
import { TAX_TREATMENTS } from '@/server/domain/tax';

export type TaxState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const monthField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/u);

/**
 * Filing, and setting up the rates that make filing possible.
 *
 * A refusal from the ledger is a message rather than an error page, as
 * everywhere else: "March is already filed" and "February has not been filed
 * yet" are the ordinary results of pressing the button, and the screen's job
 * is to make pressing it safe.
 */
export async function fileReturnAction(_previous: TaxState, formData: FormData): Promise<TaxState> {
  const { locale, t } = await translations();
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z.object({ periodStart: monthField, periodEnd: monthField }).safeParse({
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
  });
  if (!parsed.success) return { status: 'error', message: t.tax.pickPeriod };

  const result = await writer.services.taxReturns.file(parsed.data);
  revalidatePath('/tax');
  revalidatePath('/journal');
  revalidatePath('/accounts');

  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };

  const figures = result.value.return;
  const money = (value: MoneyDto) => `${formatAmount(value, locale)} ${value.currency}`;
  return {
    status: 'done',
    message:
      figures.payable.minorUnits === '0'
        ? t.tax.filedNothingOwed(money(figures.carriedForward))
        : t.tax.filedOwing(money(figures.payable)),
  };
}

export async function createTaxCodeAction(
  _previous: TaxState,
  formData: FormData,
): Promise<TaxState> {
  const { locale, t } = await translations();
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      name: z.string().trim().min(1).max(80),
      // Typed as a percentage because that is what the rate is called
      // everywhere outside this codebase. Basis points are an implementation
      // detail and asking for them would be asking people to multiply by 100.
      percent: z
        .string()
        .trim()
        .regex(/^\d{1,2}(\.\d{1,2})?$/u),
      treatment: z.enum(TAX_TREATMENTS),
      inputAccountId: z.string().trim().optional(),
      outputAccountId: z.string().trim().optional(),
    })
    .safeParse({
      name: formData.get('name'),
      percent: formData.get('percent'),
      treatment: formData.get('treatment'),
      inputAccountId: formData.get('inputAccountId') || undefined,
      outputAccountId: formData.get('outputAccountId') || undefined,
    });

  if (!parsed.success) {
    return {
      status: 'error',
      message: t.tax.codeIncomplete,
    };
  }

  // Exact, via a string: `Number('8.25') * 100` is 824.9999999999999.
  const [whole, fraction = ''] = parsed.data.percent.split('.');
  const basisPoints = Number(`${whole}${fraction.padEnd(2, '0')}`);

  const result = await writer.services.tax.create({
    name: parsed.data.name,
    rateBasisPoints: basisPoints,
    treatment: parsed.data.treatment,
    ...(parsed.data.inputAccountId ? { inputAccountId: parsed.data.inputAccountId } : {}),
    ...(parsed.data.outputAccountId ? { outputAccountId: parsed.data.outputAccountId } : {}),
  });

  revalidatePath('/tax');
  return result.ok
    ? { status: 'done', message: t.tax.codeAdded(parsed.data.name) }
    : { status: 'error', message: describeError(result.error, locale) };
}

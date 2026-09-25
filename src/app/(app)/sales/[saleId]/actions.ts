'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { formatAmount } from '@/lib/format';
import { describeError, translations } from '@/server/i18n';
import { parseDecimal, type CurrencyCode } from '@/lib/money';
import { parseQuantity } from '@/lib/quantity';
import type { CreditLineInput } from '@/server/services/credit-notes';

export type CreditNoteState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const header = z.object({
  saleId: z.string().trim().min(1),
  reference: z.string().trim().min(1).max(40),
  revenueAccountId: z.string().trim().min(1),
  occurredAt: z.iso.date(),
  reason: z.string().trim().max(280).optional(),
});

const plain = /^\d+(\.\d+)?$/u;

/**
 * Issues a credit note from the invoice page.
 *
 * One row per invoice line, each submitting `saleMovementId`, `quantity` and
 * `amount` in page order. A row left at zero is simply not part of the note.
 * Quantities are read at each line's own precision and amounts in the
 * invoice's currency — both taken from the sale on the server, never from the
 * browser.
 */
export async function issueCreditNoteAction(
  _previous: CreditNoteState,
  formData: FormData,
): Promise<CreditNoteState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const parsed = header.safeParse({
    saleId: formData.get('saleId'),
    reference: formData.get('reference'),
    revenueAccountId: formData.get('revenueAccountId'),
    occurredAt: formData.get('occurredAt'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) return { status: 'error', message: t.creditNotes.checkForm };

  const sale = await writer.services.sales.get(parsed.data.saleId);
  if (!sale) return { status: 'error', message: t.creditNotes.checkForm };
  const currency: CurrencyCode = sale.currency;

  const text = (key: string) => formData.getAll(key).map((value) => String(value).trim());
  const movementIds = text('saleMovementId');
  const quantities = text('quantity');
  const amounts = text('amount');

  const lines: CreditLineInput[] = [];
  for (const [index, movementId] of movementIds.entries()) {
    const source = sale.lines.find((line) => line.movementId === movementId);
    if (!source) return { status: 'error', message: t.creditNotes.checkForm };
    const quantityText = quantities[index] || '0';
    const amountText = amounts[index] || '0';
    if (!plain.test(quantityText) || !plain.test(amountText)) {
      return { status: 'error', message: t.creditNotes.checkLine(source.sku) };
    }

    const quantity = parseQuantity(quantityText, source.quantityPrecision);
    if (!quantity.ok) {
      return {
        status: 'error',
        message:
          quantity.error === 'too_many_decimals'
            ? t.creditNotes.tooManyDecimals(source.sku, source.quantityPrecision)
            : t.creditNotes.checkLine(source.sku),
      };
    }
    const amount = parseDecimal(amountText, currency);
    if (!amount.ok) {
      return {
        status: 'error',
        message: t.creditNotes.amountNotRepresentable(source.sku, currency),
      };
    }
    if (quantity.value === 0n && amount.value === 0n) continue;
    lines.push({ saleMovementId: movementId, quantity: quantity.value, amount: amount.value });
  }
  if (lines.length === 0) return { status: 'error', message: t.creditNotes.nothingEntered };

  // Midday on the chosen day — unless the invoice itself was raised later on
  // that same day, in which case just after it: a note dated the day of its
  // invoice is ordinary, and refusing it over the hour would be absurd.
  const noon = new Date(`${parsed.data.occurredAt}T12:00:00.000Z`);
  const occurredAt =
    noon < sale.occurredAt && parsed.data.occurredAt === sale.occurredAt.toISOString().slice(0, 10)
      ? new Date(sale.occurredAt.getTime() + 1000)
      : noon;

  const result = await writer.services.creditNotes.issue({
    saleId: sale.id,
    reference: parsed.data.reference,
    revenueAccountId: parsed.data.revenueAccountId,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    occurredAt,
    lines,
    actor: { userId: writer.viewer.userId, via: 'ui' },
  });

  revalidatePath(`/sales/${sale.id}`);
  revalidatePath('/sales');
  revalidatePath('/stock');
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };

  const note = result.value.creditNote;
  return {
    status: 'done',
    message: t.creditNotes.issued(
      note.reference,
      `${formatAmount(note.gross, locale)} ${note.gross.currency}`,
    ),
  };
}

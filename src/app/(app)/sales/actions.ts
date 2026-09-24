'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describe as describeError } from '@/server/domain/errors';
import { marginText } from '@/components/margin';
import { formatAmount } from '@/lib/format';
import { translations } from '@/server/i18n';
import { SUPPORTED_CURRENCIES, parseDecimal, type CurrencyCode } from '@/lib/money';
import { parseQuantity } from '@/lib/quantity';
import type { SaleLineInput } from '@/server/services/sales';

export type SaleState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
  /** The invoice just raised, so the form can link to it. */
  readonly saleId?: string;
};

const header = z.object({
  reference: z.string().trim().min(1).max(40),
  customerAccountId: z.string().trim().min(1),
  revenueAccountId: z.string().trim().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
  taxCodeId: z.string().trim().optional(),
  occurredAt: z.iso.date(),
  dueOn: z.union([z.iso.date(), z.literal('')]).optional(),
});

const plain = /^\d+(\.\d+)?$/u;

/**
 * Raises an invoice from the form.
 *
 * The lines arrive as repeated fields — `itemId`, `quantity`, `amount`,
 * `layerId`, once per line, in the order they sit on the page — which is what
 * a form with rows added and removed in the browser naturally submits. Every
 * line carries all four, an empty `layerId` included, so the four lists stay
 * aligned whichever rows were removed.
 *
 * Each quantity is parsed at *its own product's* precision, read from the
 * server rather than trusted from a hidden field: a line of tonnes and a line
 * of pieces on one invoice are scaled differently, and a precision the
 * browser could edit is a precision the browser could get wrong.
 */
export async function sellAction(_previous: SaleState, formData: FormData): Promise<SaleState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const parsed = header.safeParse({
    reference: formData.get('reference'),
    customerAccountId: formData.get('customerAccountId'),
    revenueAccountId: formData.get('revenueAccountId'),
    currency: formData.get('currency'),
    taxCodeId: formData.get('taxCodeId') ?? '',
    occurredAt: formData.get('occurredAt'),
    dueOn: formData.get('dueOn') ?? '',
  });
  if (!parsed.success) return { status: 'error', message: t.sales.checkForm };

  const text = (key: string) => formData.getAll(key).map((value) => String(value).trim());
  const itemIds = text('itemId');
  const quantities = text('quantity');
  const amounts = text('amount');
  const layerIds = text('layerId');

  const currency: CurrencyCode = parsed.data.currency;
  const lines: SaleLineInput[] = [];

  for (const [index, itemId] of itemIds.entries()) {
    const line = index + 1;
    const quantityText = quantities[index] ?? '';
    const amountText = amounts[index] ?? '';
    // A row left completely blank is a row somebody added and did not use.
    if (!itemId && !quantityText && !amountText) continue;
    if (!itemId || !plain.test(quantityText) || !plain.test(amountText)) {
      return { status: 'error', message: t.sales.checkLine(line) };
    }

    const item = await writer.services.inventory.item(itemId);
    if (!item) return { status: 'error', message: t.sales.checkLine(line) };

    const quantity = parseQuantity(quantityText, item.quantityPrecision);
    if (!quantity.ok) {
      return {
        status: 'error',
        message:
          quantity.error === 'too_many_decimals'
            ? t.sales.tooManyDecimals(line, item.quantityPrecision)
            : t.sales.checkLine(line),
      };
    }

    const amount = parseDecimal(amountText, currency);
    if (!amount.ok) {
      return { status: 'error', message: t.sales.amountNotRepresentable(line, currency) };
    }

    const layerId = layerIds[index];
    lines.push({
      itemId,
      quantity: quantity.value,
      amount: amount.value,
      ...(layerId ? { layerId } : {}),
    });
  }

  if (lines.length === 0) return { status: 'error', message: t.sales.checkForm };

  const result = await writer.services.sales.sell({
    reference: parsed.data.reference,
    customerAccountId: parsed.data.customerAccountId,
    revenueAccountId: parsed.data.revenueAccountId,
    currency,
    ...(parsed.data.taxCodeId ? { taxCodeId: parsed.data.taxCodeId } : {}),
    occurredAt: atNoon(parsed.data.occurredAt),
    ...(parsed.data.dueOn ? { dueOn: parsed.data.dueOn } : {}),
    lines,
    actor: { userId: writer.viewer.userId, via: 'ui' },
  });

  revalidatePath('/sales');
  revalidatePath('/stock');
  if (!result.ok) return { status: 'error', message: describeError(result.error) };

  const { sale } = result.value;
  const amount = `${formatAmount(sale.margin, locale)} ${sale.margin.currency}`;
  const margin =
    sale.marginBasisPoints === null
      ? amount
      : `${amount} (${marginText(sale.marginBasisPoints, locale)})`;

  return { status: 'done', message: t.sales.raised(sale.reference, margin), saleId: sale.id };
}

/** Midday UTC, so a date typed anywhere lands on the day the person meant. */
function atNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describeError, translations } from '@/server/i18n';

export type EInvoiceState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

/** The company as its invoices name it. */
export async function saveSellerAction(
  _previous: EInvoiceState,
  formData: FormData,
): Promise<EInvoiceState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z
    .object({
      legalName: text(200),
      taxId: text(20),
      address: text(300),
      series: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[CK]\d{2}[TDLMNBGH][A-Z]{2}$/u),
    })
    .safeParse({
      legalName: formData.get('legalName'),
      taxId: formData.get('taxId'),
      address: formData.get('address'),
      series: formData.get('series'),
    });
  if (!parsed.success) return { status: 'error', message: t.einvoice.checkForm };

  const result = await writer.services.einvoices.updateSeller(parsed.data);
  revalidatePath('/sales/einvoices');
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.einvoice.saved };
}

/** Saves the buyer's details on the customer, then issues the sale's e-invoice. */
export async function issueForSaleAction(
  _previous: EInvoiceState,
  formData: FormData,
): Promise<EInvoiceState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z
    .object({
      saleId: text(60),
      customerAccountId: text(60),
      legalName: optional(200),
      taxId: optional(20),
      address: optional(300),
    })
    .safeParse({
      saleId: formData.get('saleId'),
      customerAccountId: formData.get('customerAccountId'),
      legalName: formData.get('legalName') ?? '',
      taxId: formData.get('taxId') ?? '',
      address: formData.get('address') ?? '',
    });
  if (!parsed.success) return { status: 'error', message: t.einvoice.checkForm };

  const buyer = await writer.services.einvoices.updateBuyer({
    accountId: parsed.data.customerAccountId,
    legalName: parsed.data.legalName,
    taxId: parsed.data.taxId,
    address: parsed.data.address,
  });
  if (!buyer.ok) return { status: 'error', message: describeError(buyer.error, locale) };

  const result = await writer.services.einvoices.issueForSale({
    saleId: parsed.data.saleId,
    userId: writer.viewer.userId,
  });
  revalidatePath(`/sales/${parsed.data.saleId}`);
  revalidatePath('/sales/einvoices');
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.einvoice.issued(result.value.printedNumber) };
}

export async function issueAdjustmentAction(
  _previous: EInvoiceState,
  formData: FormData,
): Promise<EInvoiceState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };
  const { locale, t } = await translations();

  const parsed = z
    .object({ saleId: text(60), creditNoteId: text(60) })
    .safeParse({ saleId: formData.get('saleId'), creditNoteId: formData.get('creditNoteId') });
  if (!parsed.success) return { status: 'error', message: t.einvoice.checkForm };

  const result = await writer.services.einvoices.issueForCreditNote({
    creditNoteId: parsed.data.creditNoteId,
    userId: writer.viewer.userId,
  });
  revalidatePath(`/sales/${parsed.data.saleId}`);
  revalidatePath('/sales/einvoices');
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };
  return { status: 'done', message: t.einvoice.issued(result.value.printedNumber) };
}

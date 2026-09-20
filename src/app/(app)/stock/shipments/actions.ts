'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describe as describeError } from '@/server/domain/errors';
import { ALLOCATION_BASES } from '@/server/domain/landed-cost';
import { SUPPORTED_CURRENCIES, parseDecimal } from '@/lib/money';

export type ShipmentState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

const amountField = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/u, 'Enter the amount as a plain number.');

export async function recordShipmentAction(
  _previous: ShipmentState,
  formData: FormData,
): Promise<ShipmentState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      reference: z.string().trim().min(1).max(60),
      arrivedAt: z.iso.date(),
      notes: z.string().trim().max(200).optional(),
    })
    .safeParse({
      reference: formData.get('reference'),
      arrivedAt: formData.get('arrivedAt'),
      notes: formData.get('notes') ?? '',
    });

  if (!parsed.success) {
    return { status: 'error', message: 'Give the shipment a reference and the date it arrived.' };
  }

  const result = await writer.services.landedCost.record({
    reference: parsed.data.reference,
    arrivedAt: new Date(`${parsed.data.arrivedAt}T12:00:00.000Z`),
    ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
  });

  revalidatePath('/stock/shipments');
  revalidatePath('/stock');
  return result.ok
    ? { status: 'done', message: `Recorded ${parsed.data.reference}.` }
    : { status: 'error', message: describeError(result.error) };
}

/**
 * Adds a charge, which is the whole feature.
 *
 * The message on the way back says what it *did* — how much went onto the
 * stock and how much went to cost of sales — because those two numbers are
 * the thing a person is trying to find out, and a bare "saved" would send them
 * to the journal to work it out.
 */
export async function addChargeAction(
  _previous: ShipmentState,
  formData: FormData,
): Promise<ShipmentState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      shipmentId: z.string().trim().min(1),
      kind: z.enum(['freight', 'duty', 'insurance', 'handling', 'tax', 'other']),
      description: z.string().trim().min(1).max(200),
      amount: amountField,
      currency: z.enum(SUPPORTED_CURRENCIES),
      basis: z.enum(ALLOCATION_BASES),
      creditAccountId: z.string().trim().min(1),
      capitalise: z.enum(['yes', 'no']),
      debitAccountId: z.string().trim().optional(),
      occurredAt: z.iso.date(),
    })
    .safeParse({
      shipmentId: formData.get('shipmentId'),
      kind: formData.get('kind'),
      description: formData.get('description'),
      amount: formData.get('amount'),
      currency: formData.get('currency'),
      basis: formData.get('basis'),
      creditAccountId: formData.get('creditAccountId'),
      capitalise: formData.get('capitalise') ?? 'yes',
      debitAccountId: formData.get('debitAccountId') ?? '',
      occurredAt: formData.get('occurredAt'),
    });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the amount and the description.',
    };
  }

  const amount = parseDecimal(parsed.data.amount, parsed.data.currency);
  if (!amount.ok) {
    return { status: 'error', message: 'Enter the amount as a plain number.' };
  }

  const capitalise = parsed.data.capitalise === 'yes';
  const result = await writer.services.landedCost.addCharge({
    shipmentId: parsed.data.shipmentId,
    kind: parsed.data.kind,
    description: parsed.data.description,
    amount: amount.value,
    currency: parsed.data.currency,
    basis: parsed.data.basis,
    creditAccountId: parsed.data.creditAccountId,
    occurredAt: new Date(`${parsed.data.occurredAt}T12:00:00.000Z`),
    ...(capitalise ? {} : { capitalise: false, debitAccountId: parsed.data.debitAccountId ?? '' }),
  });

  revalidatePath(`/stock/shipments/${parsed.data.shipmentId}`);
  revalidatePath('/stock/shipments');
  revalidatePath('/stock');

  if (!result.ok) return { status: 'error', message: describeError(result.error) };

  const { toInventory, toCogs } = result.value.preview;
  return {
    status: 'done',
    message: capitalise
      ? BigInt(toCogs.minorUnits) === 0n
        ? `Added. ${toInventory.amount} ${toInventory.currency} went onto the stock.`
        : `Added. ${toInventory.amount} went onto the stock still held, and ${toCogs.amount} ${toCogs.currency} to cost of sales for the part already sold.`
      : 'Added. Nothing was added to the stock, because this charge is reclaimable.',
  };
}

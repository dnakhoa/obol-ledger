'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { describe as describeError } from '@/server/domain/errors';
import { COSTING_METHODS } from '@/server/domain/costing';
import { SUPPORTED_CURRENCIES, parseDecimal } from '@/lib/money';
import { SUPPORTED_UNITS, defaultPrecision, parseQuantity, type Unit } from '@/lib/quantity';

export type StockState = {
  readonly status: 'idle' | 'error' | 'done';
  readonly message?: string;
};

/**
 * Three things a person does with stock: add a product, book in a delivery,
 * ship it out.
 *
 * Every one of them reports back in the same shape so the screen can say what
 * happened in one sentence, beside the button that caused it. The audience
 * runs an import business rather than a finance department, and a refusal —
 * "only 300 m² on hand" — is information they can act on, not a fault to be
 * shown on an error page.
 */

const quantityField = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/u, 'Enter a plain number, for example 1250 or 24.687');

export async function createItemAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      sku: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(120),
      unit: z.enum(SUPPORTED_UNITS),
      inventoryAccountId: z.string().trim().min(1),
      cogsAccountId: z.string().trim().min(1),
      costingMethod: z.enum(['', ...COSTING_METHODS]).optional(),
    })
    .safeParse({
      sku: formData.get('sku'),
      name: formData.get('name'),
      unit: formData.get('unit'),
      inventoryAccountId: formData.get('inventoryAccountId'),
      cogsAccountId: formData.get('cogsAccountId'),
      costingMethod: formData.get('costingMethod') ?? '',
    });

  if (!parsed.success) {
    return { status: 'error', message: 'Fill in a code, a name and a unit of measure.' };
  }

  const method = parsed.data.costingMethod;
  const result = await writer.services.inventory.createItem({
    sku: parsed.data.sku,
    name: parsed.data.name,
    unit: parsed.data.unit,
    inventoryAccountId: parsed.data.inventoryAccountId,
    cogsAccountId: parsed.data.cogsAccountId,
    ...(method ? { costingMethod: method } : {}),
  });

  revalidatePath('/stock');
  return result.ok
    ? {
        status: 'done',
        message: `Added ${parsed.data.name}. You can book a delivery against it now.`,
      }
    : { status: 'error', message: describeError(result.error) };
}

export async function receiveAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      itemId: z.string().trim().min(1),
      unit: z.enum(SUPPORTED_UNITS),
      quantity: quantityField,
      cost: quantityField,
      currency: z.enum(SUPPORTED_CURRENCIES),
      creditAccountId: z.string().trim().min(1),
      occurredAt: z.iso.date(),
      reference: z.string().trim().max(60).optional(),
    })
    .safeParse({
      itemId: formData.get('itemId'),
      unit: formData.get('unit'),
      quantity: formData.get('quantity'),
      cost: formData.get('cost'),
      currency: formData.get('currency'),
      creditAccountId: formData.get('creditAccountId'),
      occurredAt: formData.get('occurredAt'),
      reference: formData.get('reference') ?? '',
    });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the quantity and the amount.',
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return {
      status: 'error',
      message:
        quantity.error === 'too_many_decimals'
          ? `This product is measured to ${precision} decimal place${precision === 1 ? '' : 's'}. Round the quantity, or change the product's precision.`
          : 'Enter the quantity as a plain number.',
    };
  }

  const cost = parseDecimal(parsed.data.cost, parsed.data.currency);
  if (!cost.ok) return { status: 'error', message: 'Enter the amount paid as a plain number.' };

  const result = await writer.services.inventory.receive({
    itemId: parsed.data.itemId,
    quantity: quantity.value,
    cost: cost.value,
    currency: parsed.data.currency,
    creditAccountId: parsed.data.creditAccountId,
    occurredAt: atNoon(parsed.data.occurredAt),
    ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
  });

  revalidatePath('/stock');
  revalidatePath(`/stock/${parsed.data.itemId}`);
  return result.ok
    ? {
        status: 'done',
        message: `Booked in ${parsed.data.quantity} ${parsed.data.unit}. The purchase has been posted to the ledger as well.`,
      }
    : { status: 'error', message: describeError(result.error) };
}

export async function issueAction(_previous: StockState, formData: FormData): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: refusalMessage(writer.reason) };

  const parsed = z
    .object({
      itemId: z.string().trim().min(1),
      unit: z.enum(SUPPORTED_UNITS),
      quantity: quantityField,
      occurredAt: z.iso.date(),
      reference: z.string().trim().max(60).optional(),
      layerId: z.string().trim().optional(),
    })
    .safeParse({
      itemId: formData.get('itemId'),
      unit: formData.get('unit'),
      quantity: formData.get('quantity'),
      occurredAt: formData.get('occurredAt'),
      reference: formData.get('reference') ?? '',
      layerId: formData.get('layerId') ?? '',
    });

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the quantity.',
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return { status: 'error', message: 'Enter the quantity as a plain number.' };
  }

  const result = await writer.services.inventory.issue({
    itemId: parsed.data.itemId,
    quantity: quantity.value,
    occurredAt: atNoon(parsed.data.occurredAt),
    ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
    ...(parsed.data.layerId ? { layerId: parsed.data.layerId } : {}),
  });

  revalidatePath('/stock');
  revalidatePath(`/stock/${parsed.data.itemId}`);

  if (!result.ok) return { status: 'error', message: describeError(result.error) };

  // Naming the lots is the point of the whole feature, so the confirmation
  // names them: the person can check the answer against the yard.
  const lots = result.value.movement.drawnFrom
    .map((draw) => draw.layerReference)
    .filter((reference): reference is string => Boolean(reference));

  return {
    status: 'done',
    message: lots.length
      ? `Shipped, costed from ${lots.join(' then ')}. The cost of goods sold has been posted.`
      : 'Shipped, and the cost of goods sold has been posted.',
  };
}

/** Midday UTC, so a date typed anywhere lands on the day the person meant. */
function atNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function precisionFor(unit: Unit, supplied: FormDataEntryValue | null): number {
  const parsed = Number(supplied);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : defaultPrecision(unit);
}

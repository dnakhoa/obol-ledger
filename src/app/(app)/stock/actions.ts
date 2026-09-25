'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refusalMessage, requireWriter } from '@/server/auth/guard';
import { COSTING_METHODS, WRITE_OFF_REASONS } from '@/server/domain/costing';
import { describeError, translations } from '@/server/i18n';
import { formatAmount } from '@/lib/format';
import { SUPPORTED_CURRENCIES, parseDecimal } from '@/lib/money';
import {
  SUPPORTED_UNITS,
  defaultPrecision,
  parseQuantity,
  toQuantityString,
  unitLabel,
  type Unit,
} from '@/lib/quantity';

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
  .regex(/^\d+(\.\d+)?$/u);

export async function createItemAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

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

  const { locale, t } = await translations();
  if (!parsed.success) return { status: 'error', message: t.stockOutcome.checkProduct };

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
    ? { status: 'done', message: t.stockOutcome.added(parsed.data.name) }
    : { status: 'error', message: describeError(result.error, locale) };
}

export async function receiveAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

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

  const { locale, t } = await translations();
  if (!parsed.success) {
    return {
      status: 'error',
      message: plainNumberIssue(parsed.error.issues)
        ? t.stockOutcome.plainNumber
        : t.stockOutcome.checkQuantityAndAmount,
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return {
      status: 'error',
      message:
        quantity.error === 'too_many_decimals'
          ? t.stockOutcome.tooManyDecimals(precision)
          : t.stockOutcome.quantityPlain,
    };
  }

  const cost = parseDecimal(parsed.data.cost, parsed.data.currency);
  if (!cost.ok) return { status: 'error', message: t.stockOutcome.amountPlain };

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
        message: t.stockOutcome.bookedIn(parsed.data.quantity, unitLabel(parsed.data.unit)),
      }
    : { status: 'error', message: describeError(result.error, locale) };
}

export async function issueAction(_previous: StockState, formData: FormData): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

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

  const { locale, t } = await translations();
  if (!parsed.success) {
    return {
      status: 'error',
      message: plainNumberIssue(parsed.error.issues)
        ? t.stockOutcome.plainNumber
        : t.stockOutcome.checkQuantity,
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return {
      status: 'error',
      message:
        quantity.error === 'too_many_decimals'
          ? t.stockOutcome.tooManyDecimals(precision)
          : t.stockOutcome.quantityPlain,
    };
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

  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };

  // Naming the lots is the point of the whole feature, so the confirmation
  // names them: the person can check the answer against the yard.
  const lots = result.value.movement.drawnFrom
    .map((draw) => draw.layerReference)
    .filter((reference): reference is string => Boolean(reference));

  return {
    status: 'done',
    message: lots.length
      ? t.stockOutcome.shippedFrom(lots.join(t.stockOutcome.lotsJoiner))
      : t.stockOutcome.shipped,
  };
}

/**
 * Stock leaving without a sale.
 *
 * The reason is required here as it is in the database: a write-off nobody
 * can filter by cause is a shrinkage figure nobody can act on.
 */
export async function writeOffAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const parsed = z
    .object({
      itemId: z.string().trim().min(1),
      unit: z.enum(SUPPORTED_UNITS),
      quantity: quantityField,
      reason: z.enum(WRITE_OFF_REASONS),
      expenseAccountId: z.string().trim().min(1),
      occurredAt: z.iso.date(),
      reference: z.string().trim().max(60).optional(),
      layerId: z.string().trim().optional(),
    })
    .safeParse({
      itemId: formData.get('itemId'),
      unit: formData.get('unit'),
      quantity: formData.get('quantity'),
      reason: formData.get('reason'),
      expenseAccountId: formData.get('expenseAccountId'),
      occurredAt: formData.get('occurredAt'),
      reference: formData.get('reference') ?? '',
      layerId: formData.get('layerId') ?? '',
    });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: 'error',
      message:
        field === 'reason'
          ? t.stockOutcome.chooseReason
          : plainNumberIssue(parsed.error.issues)
            ? t.stockOutcome.plainNumber
            : t.stockOutcome.checkQuantity,
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return {
      status: 'error',
      message:
        quantity.error === 'too_many_decimals'
          ? t.stockOutcome.tooManyDecimals(precision)
          : t.stockOutcome.quantityPlain,
    };
  }

  const result = await writer.services.inventory.writeOff({
    itemId: parsed.data.itemId,
    quantity: quantity.value,
    reason: parsed.data.reason,
    expenseAccountId: parsed.data.expenseAccountId,
    occurredAt: atNoon(parsed.data.occurredAt),
    ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
    ...(parsed.data.layerId ? { layerId: parsed.data.layerId } : {}),
  });

  revalidatePath('/stock');
  revalidatePath(`/stock/${parsed.data.itemId}`);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };

  const lots = result.value.movement.drawnFrom
    .map((draw) => draw.layerReference)
    .filter((reference): reference is string => Boolean(reference));
  const written = toQuantityString(quantity.value, precision);
  const unit = unitLabel(parsed.data.unit);
  return {
    status: 'done',
    message: lots.length
      ? t.stockOutcome.writtenOffFrom(written, unit, lots.join(t.stockOutcome.lotsJoiner))
      : t.stockOutcome.writtenOff(written, unit),
  };
}

/** True when the first problem is a number that is not a plain decimal. */
function plainNumberIssue(issues: readonly { path: readonly PropertyKey[] }[]): boolean {
  const field = issues[0]?.path[0];
  return field === 'quantity' || field === 'cost';
}

/** Midday UTC, so a date typed anywhere lands on the day the person meant. */
function atNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function precisionFor(unit: Unit, supplied: FormDataEntryValue | null): number {
  const parsed = Number(supplied);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : defaultPrecision(unit);
}

/**
 * Goods going back to the supplier they came from.
 *
 * The refund is read in the delivery's own currency, which is taken from the
 * lot on the server rather than trusted from the page.
 */
export async function returnToSupplierAction(
  _previous: StockState,
  formData: FormData,
): Promise<StockState> {
  const writer = await requireWriter();
  if (!writer.allowed) return { status: 'error', message: await refusalMessage(writer.reason) };

  const { locale, t } = await translations();
  const optionalId = z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined);
  const parsed = z
    .object({
      itemId: z.string().trim().min(1),
      unit: z.enum(SUPPORTED_UNITS),
      layerId: z.string().trim().min(1),
      quantity: quantityField,
      refund: z
        .string()
        .trim()
        .regex(/^(\d+(\.\d+)?)?$/u),
      counterpartyAccountId: optionalId,
      expenseAccountId: optionalId,
      taxCodeId: optionalId,
      occurredAt: z.iso.date(),
      reference: z.string().trim().min(1).max(60),
      reason: z.string().trim().max(280).optional(),
    })
    .safeParse({
      itemId: formData.get('itemId'),
      unit: formData.get('unit'),
      layerId: formData.get('layerId') ?? '',
      quantity: formData.get('quantity'),
      refund: formData.get('refund') ?? '',
      counterpartyAccountId: formData.get('counterpartyAccountId') ?? '',
      expenseAccountId: formData.get('expenseAccountId') ?? '',
      taxCodeId: formData.get('taxCodeId') ?? '',
      occurredAt: formData.get('occurredAt'),
      reference: formData.get('reference') ?? '',
      reason: formData.get('reason') ?? '',
    });

  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      status: 'error',
      message:
        field === 'layerId'
          ? t.stockOutcome.chooseDelivery
          : field === 'reference'
            ? t.creditNotes.checkForm
            : field === 'quantity' || field === 'refund'
              ? t.stockOutcome.plainNumber
              : t.stockOutcome.checkQuantity,
    };
  }

  const precision = precisionFor(parsed.data.unit, formData.get('precision'));
  const quantity = parseQuantity(parsed.data.quantity, precision);
  if (!quantity.ok) {
    return {
      status: 'error',
      message:
        quantity.error === 'too_many_decimals'
          ? t.stockOutcome.tooManyDecimals(precision)
          : t.stockOutcome.quantityPlain,
    };
  }

  const lot = (await writer.services.supplierReturns.returnable(parsed.data.itemId)).find(
    (candidate) => candidate.layerId === parsed.data.layerId,
  );
  if (!lot) return { status: 'error', message: t.stockOutcome.chooseDelivery };

  let refund: bigint | undefined;
  if (parsed.data.refund) {
    const amount = parseDecimal(parsed.data.refund, lot.currency);
    if (!amount.ok) return { status: 'error', message: t.stockOutcome.plainNumber };
    refund = amount.value;
  }

  const result = await writer.services.supplierReturns.returnToSupplier({
    layerId: lot.layerId,
    quantity: quantity.value,
    reference: parsed.data.reference,
    refund,
    counterpartyAccountId: parsed.data.counterpartyAccountId,
    expenseAccountId: parsed.data.expenseAccountId,
    taxCodeId: parsed.data.taxCodeId,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    occurredAt: atNoon(parsed.data.occurredAt),
    actor: { userId: writer.viewer.userId, via: 'ui' },
  });

  revalidatePath('/stock');
  revalidatePath(`/stock/${parsed.data.itemId}`);
  if (!result.ok) return { status: 'error', message: describeError(result.error, locale) };

  const done = result.value.supplierReturn;
  return {
    status: 'done',
    message: t.stockOutcome.returnedToSupplier(
      toQuantityString(quantity.value, precision),
      unitLabel(parsed.data.unit),
      done.layerReference ?? done.reference,
      `${formatAmount(done.gross, locale)} ${done.gross.currency}`,
    ),
  };
}

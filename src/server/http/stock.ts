import { parseDecimal, type CurrencyCode } from '@/lib/money';
import { parseQuantity, toQuantityString } from '@/lib/quantity';
import type {
  ItemSummary,
  LayerSummary,
  MovementResult,
  MovementSummary,
} from '@/server/services/inventory';
import type { MarginReport, SaleResult, SaleSummary } from '@/server/services/sales';
import type { CreditNoteResult, CreditNoteSummary } from '@/server/services/credit-notes';
import type {
  SupplierReturnResult,
  SupplierReturnSummary,
} from '@/server/services/supplier-returns';
import type { Services } from '@/server/container';
import { problem, problemFor, problemResponse } from './problem';
import { unprocessable } from './route';

/**
 * Quantities across the wire.
 *
 * A quantity arrives as `"24.687"` and is only meaningful against an item's
 * precision, which the schema cannot know — the same position an amount is in
 * with its currency. Parsing happens here, after the item has been read, and a
 * digit too many is a 422 naming the precision rather than a silent rounding.
 *
 * On the way out the services give scaled integers (`quantityMinor`), which
 * are exact and what a client should store. Each one is sent with its decimal
 * reading beside it, as money is, so a client never has to know a scale to
 * print what it sent.
 */

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly response: Response };

/** The item a request names, or the ordinary `item_not_found` problem. */
export async function itemOr404(
  services: Services,
  itemId: string,
  requestId: string,
): Promise<Parsed<ItemSummary>> {
  const item = await services.inventory.item(itemId);
  return item
    ? { ok: true, value: item }
    : {
        ok: false,
        response: problemResponse(problemFor({ code: 'item_not_found', itemId }, requestId)),
      };
}

export function quantityFor(
  item: { readonly id: string; readonly quantityPrecision: number; readonly unit: string },
  input: string,
  field: string,
  requestId: string,
  /** A credit note line that returns nothing is a price allowance, not a mistake. */
  options: { readonly allowZero?: boolean } = {},
): Parsed<bigint> {
  const parsed = parseQuantity(input, item.quantityPrecision);
  if (parsed.ok && (parsed.value > 0n || (options.allowZero && parsed.value === 0n))) {
    return { ok: true, value: parsed.value };
  }

  const places = `${item.quantityPrecision} decimal place${item.quantityPrecision === 1 ? '' : 's'}`;
  const detail = !parsed.ok
    ? parsed.error === 'too_many_decimals'
      ? `"${input}" has more decimals than item ${item.id} is counted to: ${places} of ${item.unit}.`
      : `"${input}" is not a quantity that can be stored.`
    : 'A quantity must be greater than zero.';

  return {
    ok: false,
    response: problemResponse({
      ...problem(422, 'unprocessable-quantity', 'Quantity could not be interpreted', detail, {
        field,
        itemId: item.id,
        precision: item.quantityPrecision,
        unit: item.unit,
      }),
      requestId,
    }),
  };
}

export function amountIn(
  input: string,
  currency: CurrencyCode,
  field: string,
  requestId: string,
): Parsed<bigint> {
  const parsed = parseDecimal(input, currency);
  return parsed.ok
    ? { ok: true, value: parsed.value }
    : {
        ok: false,
        response: unprocessable(requestId, `"${input}" is not representable in ${currency}.`, {
          field,
          currency,
        }),
      };
}

/** `"1050"` at precision 2 → `"10.50"`. The services send scaled integers as strings. */
function decimal(minor: string, precision: number): string {
  return toQuantityString(BigInt(minor), precision);
}

export function presentItem(item: ItemSummary) {
  return { ...item, onHand: decimal(item.onHandMinor, item.quantityPrecision) };
}

export function presentLayer(layer: LayerSummary, precision: number) {
  return {
    ...layer,
    quantity: decimal(layer.quantityMinor, precision),
    remainingQuantity: decimal(layer.remainingQuantityMinor, precision),
  };
}

export function presentMovement(movement: MovementSummary, precision: number) {
  return {
    ...movement,
    quantity: decimal(movement.quantityMinor, precision),
    drawnFrom: movement.drawnFrom.map((draw) => ({
      ...draw,
      quantity: decimal(draw.quantityMinor, precision),
    })),
  };
}

export function presentMovementResult(result: MovementResult, precision: number) {
  return { movement: presentMovement(result.movement, precision), entry: result.entry };
}

export function presentSale(sale: SaleSummary) {
  return {
    ...sale,
    lines: sale.lines.map((line) => ({
      ...line,
      quantity: decimal(line.quantityMinor, line.quantityPrecision),
      creditedQuantity: decimal(line.creditedQuantityMinor, line.quantityPrecision),
      drawnFrom: line.drawnFrom.map((draw) => ({
        ...draw,
        quantity: decimal(draw.quantityMinor, line.quantityPrecision),
      })),
    })),
  };
}

export function presentCreditNote(note: CreditNoteSummary) {
  return {
    ...note,
    lines: note.lines.map((line) => ({
      ...line,
      quantity: decimal(line.quantityMinor, line.quantityPrecision),
    })),
  };
}

export function presentCreditNoteResult(result: CreditNoteResult) {
  return { creditNote: presentCreditNote(result.creditNote), entry: result.entry };
}

export function presentSupplierReturn(entry: SupplierReturnSummary) {
  return { ...entry, quantity: decimal(entry.quantityMinor, entry.quantityPrecision) };
}

export function presentSupplierReturnResult(result: SupplierReturnResult) {
  return { supplierReturn: presentSupplierReturn(result.supplierReturn), entry: result.entry };
}

export function presentSaleResult(result: SaleResult) {
  return { sale: presentSale(result.sale), entry: result.entry };
}

export function presentMargins(report: MarginReport) {
  return {
    ...report,
    byItem: report.byItem.map((row) => ({
      ...row,
      quantitySold: decimal(row.quantitySoldMinor, row.quantityPrecision),
    })),
  };
}

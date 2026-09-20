import { apportion } from '@/lib/apportion';
import { err, ok, type Result } from '@/lib/result';

/**
 * What the stone actually cost to get here.
 *
 * A supplier invoice is not the cost of imported goods. IAS 2 puts the cost of
 * purchase at the price *plus* import duties and other non-recoverable taxes,
 * plus transport, handling and anything else directly attributable to getting
 * the goods where they are. Ocean freight, customs duty, the broker's fee and
 * inland haulage all belong in the value of the stock sitting in the yard —
 * not in this month's expenses.
 *
 * Booking them as expenses understates inventory, overstates the period's
 * costs, and makes every subsequent cost of goods sold wrong by the same
 * margin. For an importer that margin is not small: freight and duty on a
 * container of stone routinely run a fifth of the invoice.
 *
 * Neither Xero nor QuickBooks Online does this natively. Importers do it in a
 * spreadsheet beside the accounts and type the answer back in, which is the
 * same spreadsheet this project keeps finding.
 *
 * ## What is *not* capitalised
 *
 * Recoverable import VAT. It is reclaimed from the revenue authority, so it
 * never was a cost — IAS 2 excludes taxes "subsequently recoverable by the
 * entity". It is an input-tax asset, and a charge marked as not capitalising
 * allocates nothing to the stock. That asymmetry is the whole accounting point
 * and it is why the flag exists rather than being inferred.
 */

/** What a charge is spread in proportion to. */
export const ALLOCATION_BASES = ['value', 'quantity', 'weight'] as const;
export type AllocationBasis = (typeof ALLOCATION_BASES)[number];

export type ChargeableLayer = {
  readonly id: string;
  /** What arrived, in the item's own scaled units. */
  readonly quantity: bigint;
  /** What is left of it. Zero once the lot has been sold through. */
  readonly remainingQuantity: bigint;
  /** What it cost in the functional currency, before this charge. */
  readonly baseCost: bigint;
  /** Kilograms, scaled; absent when nobody recorded it. */
  readonly weight: bigint | null;
  /** Two layers measured in different units cannot be compared by quantity. */
  readonly unit: string;
};

export type LayerCharge = {
  readonly layerId: string;
  /** The whole share this layer attracts. */
  readonly amount: bigint;
  /**
   * The part that lands on stock still held, raising its carrying amount.
   */
  readonly toInventory: bigint;
  /**
   * The part attributable to stock already sold.
   *
   * It cannot be added to a lot that has gone, and the cost of goods sold it
   * belongs to was posted last month and is append-only. So it goes to cost of
   * sales now, in the period the charge became known — which is both the only
   * option and the right answer: the expense belongs to the revenue it helped
   * earn, and that revenue is already recognised.
   */
  readonly toCogs: bigint;
};

export type ChargeAllocation = {
  readonly lines: readonly LayerCharge[];
  readonly toInventory: bigint;
  readonly toCogs: bigint;
};

export type LandedCostError =
  | { readonly code: 'no_layers' }
  | { readonly code: 'mixed_units'; readonly units: readonly string[] }
  | { readonly code: 'weight_missing'; readonly layerIds: readonly string[] }
  | { readonly code: 'nothing_to_allocate' };

/**
 * Spreads one charge across the lots a shipment brought in.
 *
 * Two apportionments, one after the other, both exact:
 *
 *  1. the charge across the lots, in proportion to the chosen basis;
 *  2. each lot's share between the stock still held and the stock already
 *     sold, in proportion to how much of the lot is left.
 *
 * Both go through `apportion`, so the lines add back up to the charge and the
 * two halves of each line add back up to the line. A freight invoice that does
 * not reconcile to the sum of what it was spread over is a freight invoice
 * somebody will spend an afternoon on.
 */
export function allocateCharge(
  layers: readonly ChargeableLayer[],
  amount: bigint,
  basis: AllocationBasis,
): Result<ChargeAllocation, LandedCostError> {
  if (layers.length === 0) return err({ code: 'no_layers' });
  if (amount === 0n) return err({ code: 'nothing_to_allocate' });

  if (basis === 'quantity') {
    const units = [...new Set(layers.map((layer) => layer.unit))];
    if (units.length > 1) {
      // Spreading by quantity across tonnes and square metres would be adding
      // them together. The numbers would come out; they would mean nothing.
      return err({ code: 'mixed_units', units });
    }
  }

  if (basis === 'weight') {
    const missing = layers.filter((layer) => layer.weight === null).map((layer) => layer.id);
    if (missing.length > 0) return err({ code: 'weight_missing', layerIds: missing });
  }

  const weightOf = (layer: ChargeableLayer): bigint => {
    switch (basis) {
      case 'value':
        return layer.baseCost;
      case 'quantity':
        return layer.quantity;
      case 'weight':
        return layer.weight ?? 0n;
    }
  };

  const lines = apportion(
    amount,
    layers.map((layer) => ({ weight: weightOf(layer), layer })),
  ).map(({ share, amount: theirs }): LayerCharge => {
    const { layer } = share;
    // The second split. Weighting by what is left against what has gone makes
    // a lot that is untouched take the whole share into stock and a lot that
    // has sold through take the whole share to cost of sales, with no special
    // cases for either end.
    const [held, sold] = apportion(theirs, [
      { weight: layer.remainingQuantity },
      { weight: layer.quantity - layer.remainingQuantity },
    ]);

    return {
      layerId: layer.id,
      amount: theirs,
      toInventory: held?.amount ?? 0n,
      toCogs: sold?.amount ?? 0n,
    };
  });

  return ok({
    lines,
    toInventory: lines.reduce((total, line) => total + line.toInventory, 0n),
    toCogs: lines.reduce((total, line) => total + line.toCogs, 0n),
  });
}

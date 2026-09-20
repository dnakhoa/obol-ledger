import { apportion } from '@/lib/apportion';
import { divideRounding } from '@/lib/fx';
import { err, ok, type Result } from '@/lib/result';

/**
 * Deciding what the stock that just left actually cost.
 *
 * This is the calculation that lives in a spreadsheet in every importer in the
 * world, and it is almost always the most complicated thing the business owns:
 * a sheet of purchase lots, a running balance per lot, and a macro that walks
 * them in order when a sale is entered. It works until someone inserts a row.
 *
 * The whole module is pure. It is handed the open layers and a quantity and it
 * returns which layers to draw from and what that draw costs; it opens no
 * transaction, reads no row and posts no entry. That is deliberate — this is
 * the part a person will want to check by hand against their own sheet, and a
 * function with no I/O can be checked by hand.
 */

/**
 * How to choose which layers a movement consumes.
 *
 * Four methods, and one of them is not available everywhere. See
 * `docs/adr/0013-inventory-costing.md`; the jurisdiction rule is enforced in
 * the schema, not here, because a rule this module owned would be a rule an
 * insert bypassing this module could break.
 */
export const COSTING_METHODS = ['fifo', 'weighted_average', 'specific', 'lifo'] as const;
export type CostingMethod = (typeof COSTING_METHODS)[number];

/** Permitted under US GAAP, prohibited under IFRS and Vietnamese VAS. */
export const US_ONLY_COSTING_METHODS: readonly CostingMethod[] = ['lifo'];

export type CostLayer = {
  readonly id: string;
  /** Scaled by the item's precision; what is left, not what arrived. */
  readonly remainingQuantity: bigint;
  /** What that remainder cost, in the currency it was bought in. */
  readonly remainingCost: bigint;
  /** The same, in the organisation's functional currency, frozen at purchase. */
  readonly remainingBaseCost: bigint;
  /** Ordering key for FIFO and LIFO. Ties break on id, which is time-ordered. */
  readonly acquiredAt: Date;
};

export type LayerDraw = {
  readonly layerId: string;
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly baseCost: bigint;
};

export type Allocation = {
  readonly draws: readonly LayerDraw[];
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly baseCost: bigint;
};

export type CostingError =
  | {
      readonly code: 'insufficient_stock';
      readonly requested: string;
      readonly available: string;
    }
  | { readonly code: 'layer_not_found'; readonly layerId: string }
  | { readonly code: 'layer_required' }
  | { readonly code: 'non_positive_quantity' };

/**
 * Which layers a movement of `quantity` draws from, and what it costs.
 *
 * Refusing to go negative is the whole value of the exercise. A spreadsheet
 * will happily cost a sale against a balance of -40 and produce a number that
 * looks like every other number on the sheet; this returns
 * `insufficient_stock` and names what is actually on hand. That refusal is the
 * error the macro cannot see, and it is why this belongs in a ledger rather
 * than beside one.
 */
export function allocate(
  layers: readonly CostLayer[],
  quantity: bigint,
  method: CostingMethod,
  /** Required by `specific`, ignored by the others. */
  layerId?: string | undefined,
): Result<Allocation, CostingError> {
  if (quantity <= 0n) return err({ code: 'non_positive_quantity' });

  const open = layers.filter((layer) => layer.remainingQuantity > 0n);
  const available = open.reduce((total, layer) => total + layer.remainingQuantity, 0n);

  if (method === 'specific') {
    if (!layerId) return err({ code: 'layer_required' });
    const layer = open.find((candidate) => candidate.id === layerId);
    if (!layer) return err({ code: 'layer_not_found', layerId });
    if (layer.remainingQuantity < quantity) {
      return err({
        code: 'insufficient_stock',
        requested: String(quantity),
        available: String(layer.remainingQuantity),
      });
    }
    return ok(total([draw(layer, quantity)]));
  }

  if (available < quantity) {
    return err({
      code: 'insufficient_stock',
      requested: String(quantity),
      available: String(available),
    });
  }

  const draws =
    method === 'weighted_average'
      ? proRata(open, quantity)
      : sequential(ordered(open, method), quantity);

  return ok(total(draws));
}

/**
 * The cost of one draw from one layer.
 *
 * Apportioned from what the layer has *left* rather than from a stored unit
 * cost, and the last draw takes the whole remainder. A unit cost cannot always
 * be represented — a thousand units for 40,001 dollars is 40.001 each, which
 * is not a number of cents — so a ledger that stored one would strand a
 * fraction in the layer on every issue and leave the account holding stock it
 * does not have. Apportioning from the remainder means the layer's cost is
 * exhausted exactly when its quantity is, whatever the arithmetic did on the
 * way.
 */
function draw(layer: CostLayer, quantity: bigint): LayerDraw {
  if (quantity === layer.remainingQuantity) {
    return {
      layerId: layer.id,
      quantity,
      cost: layer.remainingCost,
      baseCost: layer.remainingBaseCost,
    };
  }

  return {
    layerId: layer.id,
    quantity,
    cost: divideRounding(layer.remainingCost * quantity, layer.remainingQuantity),
    baseCost: divideRounding(layer.remainingBaseCost * quantity, layer.remainingQuantity),
  };
}

/** Oldest first, or newest first. Ties break on id, which is time-ordered. */
function ordered(layers: readonly CostLayer[], method: CostingMethod): readonly CostLayer[] {
  const direction = method === 'lifo' ? -1 : 1;
  return [...layers].sort((a, b) => {
    const byTime = a.acquiredAt.getTime() - b.acquiredAt.getTime();
    return direction * (byTime === 0 ? a.id.localeCompare(b.id) : byTime);
  });
}

/** Walk the order, taking whole layers until the last partial one. */
function sequential(layers: readonly CostLayer[], quantity: bigint): LayerDraw[] {
  const draws: LayerDraw[] = [];
  let outstanding = quantity;

  for (const layer of layers) {
    if (outstanding === 0n) break;
    const take = layer.remainingQuantity < outstanding ? layer.remainingQuantity : outstanding;
    draws.push(draw(layer, take));
    outstanding -= take;
  }

  return draws;
}

/**
 * Weighted average, drawn proportionally across every open layer.
 *
 * The textbook version blends the layers into one number and forgets which
 * purchase the stock came from. That is a real loss — "which container was
 * this" is a question importers ask constantly — and it is avoidable: drawing
 * the same *proportion* out of every layer costs exactly the pool average,
 * because the sum of each layer's share of its own cost is the average times
 * the quantity. Two layers, 100 at 10 and 50 at 15: the pool averages 11⅔, and
 * a draw of 30 takes 20 from the first at 200 and 10 from the second at 150,
 * which is 350, which is 30 × 11⅔. The audit trail survives the method.
 *
 * Quantities are apportioned by largest remainder so they sum to exactly what
 * was asked for; a naive round-per-layer loses or gains units, and the unit it
 * loses is the one that later makes a layer impossible to close.
 */
function proRata(layers: readonly CostLayer[], quantity: bigint): LayerDraw[] {
  // The apportionment itself is `lib/apportion`: dividing a whole number
  // across shares so the pieces add back up is the same operation whether the
  // thing being divided is a quantity coming out of lots or a freight invoice
  // going into them, and one implementation is one place for it to be wrong.
  return apportion(
    quantity,
    layers.map((layer) => ({ weight: layer.remainingQuantity, layer })),
  )
    .filter((allocation) => allocation.amount > 0n)
    .map((allocation) => draw(allocation.share.layer, allocation.amount));
}

function total(draws: readonly LayerDraw[]): Allocation {
  return {
    draws,
    quantity: draws.reduce((sum, d) => sum + d.quantity, 0n),
    cost: draws.reduce((sum, d) => sum + d.cost, 0n),
    baseCost: draws.reduce((sum, d) => sum + d.baseCost, 0n),
  };
}

/**
 * What the pool is worth per unit right now, for display only.
 *
 * Never used to cost a movement — see the note on `draw`. It exists because
 * "what is my stock worth per square metre" is a question people ask, and
 * answering it with a rounded number on screen is harmless as long as nothing
 * posts from it.
 */
export function averageUnitCost(layers: readonly CostLayer[]): bigint | null {
  const open = layers.filter((layer) => layer.remainingQuantity > 0n);
  const quantity = open.reduce((sum, layer) => sum + layer.remainingQuantity, 0n);
  if (quantity === 0n) return null;
  const cost = open.reduce((sum, layer) => sum + layer.remainingCost, 0n);
  return divideRounding(cost, quantity);
}

export function onHand(layers: readonly CostLayer[]): {
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly baseCost: bigint;
} {
  return {
    quantity: layers.reduce((sum, layer) => sum + layer.remainingQuantity, 0n),
    cost: layers.reduce((sum, layer) => sum + layer.remainingCost, 0n),
    baseCost: layers.reduce((sum, layer) => sum + layer.remainingBaseCost, 0n),
  };
}

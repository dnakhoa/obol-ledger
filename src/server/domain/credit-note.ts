import { apportion } from '@/lib/apportion';
import { divideRounding } from '@/lib/fx';

/**
 * What a credit note takes back, decided by arithmetic alone.
 *
 * Pure, like `costing.ts` and `sale.ts` beside it: the service reads the sale,
 * its lines and the credits already issued against it, and this decides the
 * figures. Every rule here has the same shape as the one the costing module
 * uses to empty a lot — **the credit that finishes something takes exactly
 * what is left of it**, rather than a freshly rounded share. That is what lets
 * a sale be credited in three instalments and still end at zero: rounding each
 * instalment independently leaves a dong of revenue, or of tax, that belongs
 * to no invoice and can never be credited.
 */

/** What is left of something that can be credited: an invoice line, or a total. */
export type Remaining = {
  /** What it started at. */
  readonly original: bigint;
  /** How much of it earlier credit notes already took. */
  readonly taken: bigint;
};

/**
 * A share of `whole` proportional to `part` out of `of`, finishing exactly.
 *
 * When `part` is everything still outstanding, the answer is everything still
 * outstanding of `whole` — not `whole × part / of` rounded, which would leave
 * the rounding behind. Otherwise it is the proportional share of what is
 * *left*, so a sequence of partial credits converges on the total rather than
 * drifting past it.
 */
export function shareOf(whole: Remaining, part: bigint, of: Remaining): bigint {
  const leftOfWhole = whole.original - whole.taken;
  const leftOfBasis = of.original - of.taken;
  if (part <= 0n || leftOfBasis <= 0n) return 0n;
  if (part >= leftOfBasis) return leftOfWhole;
  return divideRounding(leftOfWhole * part, leftOfBasis);
}

/**
 * Each sale line's net total in the invoice currency.
 *
 * A line raised since migration 0030 recorded its own; one raised before it
 * did not, and gets the invoice's net apportioned across the lines by their
 * functional-currency revenue. That is exact for an invoice in the books' own
 * currency — its lines' revenue *is* their amount — and for a foreign one it is
 * the closest figure the ledger holds, arrived at the same way every time so a
 * credit note sees the same line totals as the next one.
 */
export function lineAmounts(
  invoiceNet: bigint,
  lines: readonly { readonly amount: bigint | null; readonly revenueBase: bigint }[],
): bigint[] {
  if (lines.every((line) => line.amount !== null)) {
    return lines.map((line) => line.amount ?? 0n);
  }
  return apportion(
    invoiceNet,
    lines.map((line) => ({ weight: line.revenueBase })),
  ).map((allocation) => allocation.amount);
}

/** One draw an invoice line made from a lot, and how much of it came back already. */
export type ReturnableDraw = {
  readonly consumptionId: string;
  readonly layerId: string;
  /** When the lot arrived, to decide which goes back first. */
  readonly acquiredAt: Date;
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly baseCost: bigint;
  readonly restoredQuantity: bigint;
  readonly restoredCost: bigint;
  readonly restoredBaseCost: bigint;
};

export type Restoration = {
  readonly consumptionId: string;
  readonly layerId: string;
  readonly quantity: bigint;
  readonly cost: bigint;
  readonly baseCost: bigint;
};

export type RestoreResult =
  | { readonly ok: true; readonly restorations: readonly Restoration[] }
  | { readonly ok: false; readonly returnable: bigint };

/**
 * Which lots returned goods go back into, and at what cost.
 *
 * **Into the lots they left from, at the cost they left at.** A returned paver
 * is not a new purchase: opening a fresh lot at today's price would change
 * what the yard is worth for goods that never changed hands with a supplier,
 * and would lose which container they belong to.
 *
 * **Newest lot first.** A line that shipped from two containers and comes
 * back in part undoes the end of its own draw — the last container it reached
 * into is the first it returns to — which leaves the older lot as spent as it
 * was, and the order the stock will leave in next time is the order it would
 * have left in had the goods never gone.
 *
 * Refuses rather than truncates when more comes back than is still out:
 * a return larger than the shipment is a typo, and absorbing it silently is
 * how a stock count ends up disagreeing with the lots.
 */
export function restore(draws: readonly ReturnableDraw[], quantity: bigint): RestoreResult {
  const returnable = draws.reduce((sum, draw) => sum + (draw.quantity - draw.restoredQuantity), 0n);
  if (quantity > returnable) return { ok: false, returnable };
  if (quantity <= 0n) return { ok: true, restorations: [] };

  const newestFirst = [...draws].sort((a, b) => {
    const byTime = b.acquiredAt.getTime() - a.acquiredAt.getTime();
    return byTime === 0 ? b.layerId.localeCompare(a.layerId) : byTime;
  });

  const restorations: Restoration[] = [];
  let outstanding = quantity;
  for (const draw of newestFirst) {
    if (outstanding === 0n) break;
    const open = draw.quantity - draw.restoredQuantity;
    if (open <= 0n) continue;
    const take = open < outstanding ? open : outstanding;
    const cost = shareOf({ original: draw.cost, taken: draw.restoredCost }, take, {
      original: draw.quantity,
      taken: draw.restoredQuantity,
    });
    const baseCost = shareOf({ original: draw.baseCost, taken: draw.restoredBaseCost }, take, {
      original: draw.quantity,
      taken: draw.restoredQuantity,
    });
    restorations.push({
      consumptionId: draw.consumptionId,
      layerId: draw.layerId,
      quantity: take,
      cost,
      baseCost,
    });
    outstanding -= take;
  }

  return { ok: true, restorations };
}

/**
 * The tax a credit takes back, in the invoice currency and the books' own.
 *
 * Worked out on the credited net at the invoice's own rate — a credit note
 * corrects that invoice, under the rules it was raised under — and capped by
 * what the invoice charged less what earlier notes took back. The credit that
 * brings the net to zero takes the rest of the tax exactly, for the reason in
 * the note at the top of this file.
 */
export function creditTax(input: {
  /** What the credit note credits, net, in the invoice currency. */
  readonly net: bigint;
  readonly invoice: {
    readonly net: Remaining;
    readonly tax: Remaining;
    readonly baseTax: Remaining;
  };
  /** Tax on `net` under the invoice's code, as the invoice would have charged it. */
  readonly taxOn: (net: bigint) => bigint;
  readonly toBase: (amount: bigint) => bigint;
}): { readonly tax: bigint; readonly baseTax: bigint } {
  const { invoice } = input;
  const netLeft = invoice.net.original - invoice.net.taken;
  const taxLeft = invoice.tax.original - invoice.tax.taken;
  const baseTaxLeft = invoice.baseTax.original - invoice.baseTax.taken;

  if (input.net >= netLeft) return { tax: taxLeft, baseTax: baseTaxLeft };

  const tax = clamp(input.taxOn(input.net), taxLeft);
  const baseTax = clamp(input.toBase(tax), baseTaxLeft);
  return { tax, baseTax };
}

function clamp(value: bigint, ceiling: bigint): bigint {
  if (value < 0n) return 0n;
  return value > ceiling ? ceiling : value;
}

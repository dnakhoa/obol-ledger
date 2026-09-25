/**
 * What a return to a supplier is worth, decided by arithmetic alone.
 *
 * Two figures meet on a supplier return and are not the same. The goods leave
 * the lot at what the lot **carries** them at — the supplier's price plus
 * whatever freight, duty and broker's fees landed on it. The supplier gives
 * back what it **refunds**, which is its own price for the goods and never the
 * forwarder's. The difference is landed cost spent on goods the business no
 * longer has; it goes to an expense rather than staying in stock.
 *
 * Pure, like `credit-note.ts`: the service reads the lot and the draw that
 * takes the goods out of it, and this decides the three figures.
 */

export type SupplierRefundInput = {
  /** What the draw takes out of the lot: the supplier's price, and the carrying amount. */
  readonly draw: { readonly cost: bigint; readonly baseCost: bigint };
  /**
   * What the supplier agreed to give back, in the lot's currency. Absent means
   * its own price for the goods — the share of the invoice they represent.
   */
  readonly refund?: bigint | undefined;
  /** Whether anything beyond the supplier's price has been added to the lot. */
  readonly landed: boolean;
  /** The lot's currency to the books' own, at the rate the lot was bought at. */
  readonly toBase: (amount: bigint) => bigint;
};

export type SupplierRefund = {
  /** Given back, in the lot's currency. */
  readonly refund: bigint;
  /** The same, in the books' own currency at the lot's rate. */
  readonly refundBase: bigint;
  /** What the goods were carried at. */
  readonly carrying: bigint;
  /** Carrying less refund: positive is a cost nobody refunds, negative a gain. */
  readonly unrecovered: bigint;
};

/**
 * Splits a return's carrying amount into what comes back and what does not.
 *
 * A lot with nothing landed on it, returned at the supplier's own price, is
 * the ordinary case and must come out at exactly zero unrecovered. Converting
 * the refund afresh would not guarantee that: the draw's carrying amount is
 * the remainder-exact share of the lot, while a fresh conversion is a rounded
 * one, and the two can differ by a unit — a dong of "unrefunded freight" on a
 * delivery that paid no freight. So that case takes the carrying amount as the
 * refund's value, and only a lot that has had landed cost added, or a refund
 * that differs from the supplier's price, is converted.
 */
export function supplierRefund(input: SupplierRefundInput): SupplierRefund {
  const refund = input.refund ?? input.draw.cost;
  const exact = !input.landed && refund === input.draw.cost;
  const refundBase = exact ? input.draw.baseCost : input.toBase(refund);
  return {
    refund,
    refundBase,
    carrying: input.draw.baseCost,
    unrecovered: input.draw.baseCost - refundBase,
  };
}

/**
 * Splitting a whole number across shares, exactly.
 *
 * The operation turns up wherever money or quantity has to be divided and the
 * pieces must add back up to what you started with: a freight invoice across
 * the containers it covers, a weighted-average draw across the lots it comes
 * out of, a tax across the lines it applies to.
 *
 * Doing it the obvious way — round each share independently — loses or gains
 * units. Three shares of ten split evenly round to 3, 3, 3 and the tenth unit
 * vanishes; three shares of twenty round to 7, 7, 7 and a twenty-first appears
 * from nowhere. Either way the books no longer balance, and the amount is too
 * small for anyone to notice until a lot will not close.
 *
 * So the remainder is *assigned* rather than rounded away. Each share takes
 * its floor, and the units left over go to the shares with the largest
 * fractional claim — the same apportionment a parliament uses for seats, and
 * for the same reason: it is the division nobody can argue is unfair to them.
 */

export type Share = {
  /** Whatever this share is proportional to. Must not be negative. */
  readonly weight: bigint;
};

export type Apportioned<T> = {
  readonly share: T;
  readonly amount: bigint;
};

/**
 * Divides `total` across `shares` in proportion to their weights.
 *
 * The results always sum to exactly `total`, including when the weights do not
 * divide it and including when `total` is negative — a credit note is
 * apportioned the same way an invoice is, and rounding it in the other
 * direction would leave a cent behind on every reversal.
 *
 * Shares of zero weight receive nothing. When *every* weight is zero there is
 * nothing to be proportional to, so the total goes to the first share rather
 * than being silently dropped; a caller that cares should not be calling this.
 */
export function apportion<T extends Share>(total: bigint, shares: readonly T[]): Apportioned<T>[] {
  if (shares.length === 0) return [];

  const weights = shares.map((share) => (share.weight < 0n ? 0n : share.weight));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);

  if (totalWeight === 0n) {
    return shares.map((share, index) => ({ share, amount: index === 0 ? total : 0n }));
  }

  // Negative totals are apportioned by magnitude and re-signed at the end, so
  // the remainder lands on the same shares it would for the positive amount.
  // Without that, floor division rounds toward negative infinity and the
  // largest-remainder step hands the leftovers to different shares depending
  // on the sign — which makes a reversal fail to mirror the entry it reverses.
  const negative = total < 0n;
  const magnitude = negative ? -total : total;

  const floors = weights.map((weight) => (magnitude * weight) / totalWeight);
  const remainders = weights.map((weight, index) => {
    const exact = magnitude * weight;
    return exact - floors[index]! * totalWeight;
  });

  let assigned = floors.reduce((sum, amount) => sum + amount, 0n);
  const extra = new Array<bigint>(shares.length).fill(0n);

  // Largest fractional claim first; ties go to the earlier share, which keeps
  // the result stable for a given input rather than depending on sort order.
  const order = shares
    .map((_, index) => index)
    .sort((a, b) => {
      if (remainders[a]! === remainders[b]!) return a - b;
      return remainders[a]! > remainders[b]! ? -1 : 1;
    });

  for (const index of order) {
    if (assigned >= magnitude) break;
    if (weights[index] === 0n) continue;
    extra[index] = 1n;
    assigned += 1n;
  }

  return shares.map((share, index) => {
    const amount = floors[index]! + extra[index]!;
    return { share, amount: negative ? -amount : amount };
  });
}

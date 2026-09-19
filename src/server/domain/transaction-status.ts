/**
 * The lifecycle of a journal entry.
 *
 * Money is authorised before it settles, and a ledger that cannot represent
 * that forces the application to invent it somewhere else — an out-of-band
 * "reserved" table that nothing reconciles against the balances.
 *
 *   pending   Amounts are fixed, funds are reserved, nothing has moved.
 *   posted    Settled. Immutable; correct it with a reversing entry.
 *   archived  Cancelled before settling. Immutable; reserves nothing.
 *
 * Only `pending` is a transient state, and the only transitions out of it are
 * the two below. There is no path back: a posted entry cannot become pending
 * again, because something downstream has already acted on it having settled.
 */
export const TRANSACTION_STATUSES = ['pending', 'posted', 'archived'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

const TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  pending: ['posted', 'archived'],
  posted: [],
  archived: [],
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** True when the entry's amounts contribute to the settled balance. */
export function isSettled(status: TransactionStatus): boolean {
  return status === 'posted';
}

/** True when the entry reserves funds without having moved them. */
export function reservesFunds(status: TransactionStatus): boolean {
  return status === 'pending';
}

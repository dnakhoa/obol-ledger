import type { MinorUnits } from '@/lib/money';

/**
 * The five account classes of double-entry bookkeeping, and which side of the
 * ledger *increases* each one.
 *
 * Postings are stored signed, with debit positive and credit negative (see
 * `docs/adr/0002-signed-postings.md`). That makes the balance invariant a plain
 * `SUM(amount) = 0`, but it means the stored sign is not what an accountant
 * expects to read: a liability you owe money on has a *negative* signed
 * balance. `presentedBalance` performs that single flip, in one place, so no UI
 * component or report has to remember the rule.
 */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = 'debit' | 'credit';

const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
};

export function normalBalanceOf(type: AccountType): NormalBalance {
  return NORMAL_BALANCE[type];
}

/**
 * Converts a stored signed balance into the figure a reader expects, where a
 * healthy account of any type shows a positive number.
 */
export function presentedBalance(signed: MinorUnits, type: AccountType): MinorUnits {
  return (normalBalanceOf(type) === 'debit' ? signed : -signed) as MinorUnits;
}

/** Inverse of `presentedBalance`, for turning user input back into storage form. */
export function signedFromPresented(presented: MinorUnits, type: AccountType): MinorUnits {
  return (normalBalanceOf(type) === 'debit' ? presented : -presented) as MinorUnits;
}

export const ACCOUNT_STATUSES = ['open', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * The accounting equation: assets = liabilities + equity, extended for the
 * period's revenue and expenses. Because every posting nets to zero, the signed
 * balances of *all* accounts must also net to zero — the trial balance. The
 * dashboard surfaces this as a live self-check.
 */
export function isTrialBalanced(signedBalances: readonly MinorUnits[]): boolean {
  return signedBalances.reduce((total, balance) => total + balance, 0n) === 0n;
}

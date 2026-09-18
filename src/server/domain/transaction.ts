import { err, ok, type Result } from '@/lib/result';
import {
  add,
  toDecimalString,
  ZERO,
  type CurrencyCode,
  type MinorUnits,
  isStorableAmount,
} from '@/lib/money';
import type { LedgerError } from './errors';

/**
 * A single line of a journal entry, before it is persisted.
 *
 * `amount` is signed: positive debits the account, negative credits it.
 */
export type DraftPosting = {
  readonly accountId: string;
  readonly amount: MinorUnits;
};

export type DraftTransaction = {
  readonly currency: CurrencyCode;
  readonly postings: readonly DraftPosting[];
};

/**
 * The structural rules a journal entry must satisfy, checked before any
 * database work happens.
 *
 * This is pure and total: same input, same answer, no I/O. That is what makes
 * it worth property-testing (see `tests/unit/transaction.property.test.ts`) and
 * what lets the API reject a malformed batch without opening a transaction.
 *
 * Rules that depend on *stored* state — does the account exist, is it closed,
 * would this overdraw it — deliberately live in the service layer, because they
 * are only meaningful while holding a row lock.
 */
export function validateDraft(draft: DraftTransaction): Result<DraftTransaction, LedgerError> {
  const { postings, currency } = draft;

  if (postings.length < 2) {
    return err({ code: 'too_few_postings', count: postings.length });
  }

  const seen = new Set<string>();
  let residual = ZERO;

  for (const [index, posting] of postings.entries()) {
    if (posting.amount === 0n) {
      return err({ code: 'zero_amount_posting', index });
    }
    if (seen.has(posting.accountId)) {
      return err({ code: 'duplicate_account_in_transaction', accountId: posting.accountId });
    }
    if (!isStorableAmount(posting.amount)) {
      return err({
        code: 'unbalanced_transaction',
        residual: toDecimalString(posting.amount, currency),
        currency,
      });
    }
    seen.add(posting.accountId);
    residual = add(residual, posting.amount);
  }

  if (residual !== 0n) {
    return err({
      code: 'unbalanced_transaction',
      residual: toDecimalString(residual, currency),
      currency,
    });
  }

  return ok(draft);
}

/**
 * Builds the two postings of a simple transfer. Expressed in terms of
 * `validateDraft` rather than beside it, so the transfer endpoint and the
 * general journal endpoint cannot drift apart in what they consider legal.
 */
export function transferDraft(input: {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: MinorUnits;
  readonly currency: CurrencyCode;
}): Result<DraftTransaction, LedgerError> {
  const { fromAccountId, toAccountId, amount, currency } = input;
  return validateDraft({
    currency,
    postings: [
      { accountId: toAccountId, amount },
      { accountId: fromAccountId, amount: -amount as MinorUnits },
    ],
  });
}

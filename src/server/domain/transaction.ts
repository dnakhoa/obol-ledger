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
  /**
   * The same movement in the organisation's functional currency, which is the
   * unit the balance rule applies to.
   *
   * Optional, defaulting to `amount` — correct exactly when the account is
   * already denominated in the functional currency, which is every posting in
   * a single-currency ledger. The service fills it in for the rest, because
   * only the service knows the account's currency and the rate. See
   * `docs/adr/0010-multi-currency.md`.
   */
  readonly baseAmount?: MinorUnits;
  /** The rate used to reach `baseAmount`, as a decimal string. For audit. */
  readonly fxRate?: string;
};

export type DraftTransaction = {
  /** The functional currency: the unit this entry's balance is asserted in. */
  readonly currency: CurrencyCode;
  readonly postings: readonly DraftPosting[];
};

/** What a posting contributes to the balance: its functional-currency amount. */
function balancingAmount(posting: DraftPosting): MinorUnits {
  return posting.baseAmount ?? posting.amount;
}

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
    if (!isStorableAmount(posting.amount) || !isStorableAmount(balancingAmount(posting))) {
      return err({
        code: 'unbalanced_transaction',
        residual: toDecimalString(posting.amount, currency),
        currency,
      });
    }
    seen.add(posting.accountId);
    // Summed in the functional currency, not in each posting's own. Across
    // currencies "sums to zero" needs a unit, and this is it.
    residual = add(residual, balancingAmount(posting));
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

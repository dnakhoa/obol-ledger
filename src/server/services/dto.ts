import type { AccountStatus, AccountType } from '@/server/domain/account';
import type { CurrencyCode } from '@/lib/money';

/**
 * The shapes the API and the UI consume.
 *
 * Amounts cross this boundary twice: once as `minorUnits`, a string holding an
 * exact integer, and once as `amount`, the same value rendered as a decimal.
 * JSON numbers are IEEE-754 doubles, so a balance past 2^53 minor units would
 * be silently corrupted by `JSON.parse` — sending strings keeps the wire format
 * lossless while `amount` stays readable for a human reading the response.
 */
export type MoneyDto = {
  readonly amount: string;
  readonly minorUnits: string;
  readonly currency: CurrencyCode;
};

export type AccountDto = {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly status: AccountStatus;
  readonly overdraftAllowed: boolean;
  /** Signed as an accountant would read it: positive means a healthy account. */
  readonly balance: MoneyDto;
  readonly createdAt: string;
};

export type PostingDto = {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly direction: 'debit' | 'credit';
  readonly amount: MoneyDto;
  readonly sequence: number;
};

export type TransactionDto = {
  readonly id: string;
  readonly description: string;
  readonly currency: CurrencyCode;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly postings: readonly PostingDto[];
};

export type Page<T> = {
  readonly items: readonly T[];
  /** Opaque keyset cursor; absent when the caller has reached the end. */
  readonly nextCursor: string | null;
};

export type TrialBalanceRow = {
  readonly currency: CurrencyCode;
  readonly debits: MoneyDto;
  readonly credits: MoneyDto;
  /** Zero in a consistent ledger. Anything else is a bug worth paging someone for. */
  readonly residual: MoneyDto;
  readonly balanced: boolean;
};

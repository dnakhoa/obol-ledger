import type { AccountStatus, AccountType } from '@/server/domain/account';
import type { TransactionStatus } from '@/server/domain/transaction-status';
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
  /** The number an accountant files this under. Absent on an uncoded chart. */
  readonly code: string | null;
  readonly name: string;
  readonly type: AccountType;
  readonly status: AccountStatus;
  readonly overdraftAllowed: boolean;
  /**
   * The settled balance. Kept as `balance` for compatibility with every
   * caller that predates two-phase entries and only ever meant "posted".
   */
  readonly balance: MoneyDto;
  /**
   * The same settled balance, in the organisation's functional currency.
   *
   * What a total is summed from. Adding a dollar balance to a dong one is a
   * number with no meaning, so anything that aggregates across accounts —
   * the accounting equation, a class subtotal — uses this and nothing else.
   */
  readonly baseBalance: MoneyDto;
  /** Settled plus in-flight. */
  readonly pendingBalance: MoneyDto;
  /** Settled minus in-flight outflows — what can still be spent. */
  readonly availableBalance: MoneyDto;
  /** Optimistic-concurrency token; pass as `lockVersion` to assert freshness. */
  readonly version: number;
  /** Caller-supplied annotation. Always present, empty when unset. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Structural job, if any — currently only `retained_earnings`. */
  readonly role: string | null;
  /** Retranslated at each period end when held in a foreign currency. */
  readonly monetary: boolean;
  readonly createdAt: string;
};

export type PostingDto = {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly direction: 'debit' | 'credit';
  /** What moved, in the account's own currency. */
  readonly amount: MoneyDto;
  /**
   * The same movement in the organisation's functional currency — the unit the
   * entry's balance is asserted in.
   *
   * Always present, and equal to `amount` whenever the account is already in
   * the functional currency. Returned rather than left to be recomputed,
   * because recomputing it needs the rate and the rate is a fact about the
   * moment the entry was written.
   */
  readonly baseAmount: MoneyDto;
  /** The rate used, as a decimal string. `"1"` for a domestic posting. */
  readonly fxRate: string;
  readonly sequence: number;
};

export type TransactionDto = {
  readonly id: string;
  readonly description: string;
  readonly currency: CurrencyCode;
  readonly status: TransactionStatus;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly postedAt: string | null;
  readonly archivedAt: string | null;
  readonly postings: readonly PostingDto[];
  /** Set when this entry exists to undo another one. */
  readonly reversesTransactionId: string | null;
  /**
   * Set when a later entry undid this one.
   *
   * Carried on the DTO rather than left for the caller to discover, because
   * "is this entry still in effect?" is the first thing a reader asks and it
   * is not answerable from the postings alone.
   */
  readonly reversedByTransactionId: string | null;
  /** Caller-supplied annotation. Always present, empty when unset. */
  readonly metadata: Readonly<Record<string, string>>;
};

export type Page<T> = {
  readonly items: readonly T[];
  /** Opaque keyset cursor for the next page; null at the end of the list. */
  readonly nextCursor: string | null;
  /** Cursor for the previous page; null on the first page. */
  readonly previousCursor: string | null;
};

export type TrialBalanceRow = {
  readonly currency: CurrencyCode;
  readonly debits: MoneyDto;
  readonly credits: MoneyDto;
  /** Zero in a consistent ledger. Anything else is a bug worth paging someone for. */
  readonly residual: MoneyDto;
  readonly balanced: boolean;
};

/**
 * A line on a financial statement.
 *
 * Statements are read by section, so each line carries its own class rather
 * than relying on position — a renderer that re-sorts must not change meaning.
 */
export type StatementLineDto = {
  readonly accountId: string;
  readonly accountName: string;
  readonly type: AccountType;
  readonly amount: MoneyDto;
};

export type StatementSection = {
  readonly label: string;
  readonly lines: readonly StatementLineDto[];
  readonly total: MoneyDto;
};

/**
 * The balance sheet: a position at a point in time.
 *
 * Assets = Liabilities + Equity, where equity includes the period's retained
 * earnings (revenue less expenses). A balance sheet that does not balance is
 * not a rounding problem — it means the ledger is inconsistent, so the identity
 * is reported rather than assumed.
 */
export type BalanceSheet = {
  readonly asOf: string;
  readonly currency: CurrencyCode;
  readonly assets: StatementSection;
  readonly liabilities: StatementSection;
  readonly equity: StatementSection;
  /** Revenue less expenses, folded into equity as it would be at period close. */
  readonly retainedEarnings: MoneyDto;
  readonly liabilitiesAndEquity: MoneyDto;
  readonly balanced: boolean;
};

/**
 * The income statement: performance over a period.
 *
 * Unlike the balance sheet this is bounded by dates, because revenue and
 * expenses are flows rather than positions — "revenue" with no period attached
 * is a meaningless number.
 */
export type IncomeStatement = {
  readonly from: string;
  readonly to: string;
  readonly currency: CurrencyCode;
  readonly revenue: StatementSection;
  readonly expenses: StatementSection;
  readonly netIncome: MoneyDto;
  readonly profitable: boolean;
};

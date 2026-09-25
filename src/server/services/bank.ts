import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { ledgerMessages } from '@/lib/i18n';
import { minorUnits, toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import {
  MATCH_WINDOW_DAYS,
  feedFingerprint,
  readStatement,
  suggestMatches,
  type StatementProblem,
  type StatementRow,
} from '@/server/domain/bank';
import type { LedgerError } from '@/server/domain/errors';
import type { DraftPosting } from '@/server/domain/transaction';
import {
  accounts,
  bankImports,
  bankLines,
  bankMatches,
  postings,
  transactions,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { counterpartyLeg } from './counterparty';
import { inFunctional, organisation } from './inventory';
import { createJournalService } from './journal';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Bank reconciliation: the bank's record of an account beside the books'.
 *
 * Statement lines come in from a file somebody exported from online banking,
 * or from a feed. Each is kept exactly as the bank gave it, once — a file
 * imported twice or a feed that resends a day adds nothing the second time.
 * A line is then matched to the posting that records the same movement, or,
 * when the books have nothing for it yet (a bank fee, interest, a transfer
 * nobody booked), an entry is written from it and matched in the same step.
 *
 * What is left unmatched on either side is the reconciliation: money the
 * bank moved that the books do not know about, and entries in the books the
 * bank has not seen yet. See `docs/adr/0025-bank-reconciliation.md`.
 */

export type BankAccountSummary = {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly currency: CurrencyCode;
  readonly balance: MoneyDto;
  readonly lines: number;
  readonly unmatched: number;
  readonly lastLineOn: string | null;
};

export type PreviewLine = {
  readonly row: number;
  readonly occurredOn: string;
  readonly amount: MoneyDto;
  readonly description: string;
  readonly reference: string | null;
  /** Already imported: this line would be skipped. */
  readonly duplicate: boolean;
};

export type StatementPreview = {
  readonly lines: readonly PreviewLine[];
  readonly problems: readonly StatementProblem[];
  readonly added: number;
  readonly skipped: number;
};

export type FeedLine = {
  /** The bank's own id for the transaction. What makes a resend harmless. */
  readonly externalId: string;
  readonly occurredOn: string;
  /** Signed, in the account's currency: money in positive. */
  readonly amount: bigint;
  readonly description: string;
  readonly reference?: string | undefined;
  readonly balance?: bigint | undefined;
};

export type ImportResult = {
  readonly importId: string;
  readonly added: number;
  readonly skipped: number;
};

export type Candidate = {
  readonly postingId: string;
  readonly transactionId: string;
  readonly occurredOn: string;
  readonly description: string;
};

export type StatementLine = {
  readonly id: string;
  readonly occurredOn: string;
  readonly amount: MoneyDto;
  readonly description: string;
  readonly reference: string | null;
  readonly balance: MoneyDto | null;
  /** The posting it is matched to, and the entry that posting belongs to. */
  readonly match: {
    readonly postingId: string;
    readonly transactionId: string;
    readonly description: string;
  } | null;
  /** For an unmatched line: postings of the same amount nearby, nearest first. */
  readonly candidates: readonly Candidate[];
  /** The candidate to propose, when there is no doubt which it is. */
  readonly suggested: string | null;
};

export type BookOnlyPosting = {
  readonly postingId: string;
  readonly transactionId: string;
  readonly occurredOn: string;
  readonly description: string;
  readonly amount: MoneyDto;
};

export type Reconciliation = {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  /** The books' own currency: what an entry booked from a line may be posted against. */
  readonly functionalCurrency: CurrencyCode;
  /** What the books say the account holds. */
  readonly ledger: MoneyDto;
  /** The bank's own balance after its latest line, when the statement carries one. */
  readonly statement: MoneyDto | null;
  readonly statementOn: string | null;
  /** On the statement, not yet in the books. */
  readonly bankOnly: { readonly total: MoneyDto; readonly count: number };
  /** In the books, not yet on the statement. */
  readonly booksOnly: {
    readonly total: MoneyDto;
    readonly lines: readonly BookOnlyPosting[];
  };
  /**
   * Statement less (books − in books only + on statement only). Zero means
   * every difference between the two is explained by a line on one side the
   * other has not caught up with. Null without a statement balance.
   */
  readonly difference: MoneyDto | null;
  readonly reconciled: boolean;
};

export type RecordInput = {
  readonly lineId: string;
  /** The other side: an expense for a fee, revenue for interest, a receivable for a payment. */
  readonly counterAccountId: string;
  readonly description?: string | undefined;
  readonly userId?: string | undefined;
  /** Which route wrote it, for the audit trail. */
  readonly via?: 'ui' | 'api' | undefined;
};

export function createBankService(database: Database, orgId: string) {
  return {
    /** Every account a statement can be reconciled against. */
    async accounts(): Promise<readonly BankAccountSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            code: accounts.code,
            currency: accounts.currency,
            balance: accounts.balanceMinor,
            lines: sql<number>`(SELECT count(*)::int FROM ${bankLines} l WHERE l.account_id = "accounts"."id")`,
            unmatched: sql<number>`(
              SELECT count(*)::int FROM ${bankLines} l
               WHERE l.account_id = "accounts"."id"
                 AND NOT EXISTS (SELECT 1 FROM ${bankMatches} m
                                  WHERE m.line_id = l.id AND m.removed_at IS NULL))`,
            lastLineOn: sql<
              string | null
            >`(SELECT max(l.occurred_on)::text FROM ${bankLines} l WHERE l.account_id = "accounts"."id")`,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.status, 'open'),
              eq(accounts.monetary, true),
              isNull(accounts.role),
              eq(accounts.openItems, false),
              inArray(accounts.type, ['asset', 'liability']),
            ),
          )
          .orderBy(asc(accounts.code), asc(accounts.name));
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          currency: row.currency as CurrencyCode,
          balance: toMoneyDto(row.balance as MinorUnits, row.currency as CurrencyCode),
          lines: row.lines,
          unmatched: row.unmatched,
          lastLineOn: row.lastLineOn,
        }));
      });
    },

    /** What importing this file would do, without doing it. */
    async preview(accountId: string, text: string): Promise<Result<StatementPreview, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const account = await reconcilable(tx, accountId);
        if (!account.ok) return account;
        const read = readStatement(text, account.value.currency);
        if (!read.ok) return err({ code: 'bank_statement_unreadable', missing: read.missing });
        const existing = await knownFingerprints(tx, accountId, read.rows);
        return ok(describePreview(read.rows, read.problems, existing, account.value.currency));
      });
    },

    /**
     * Imports a statement file: every line, or none.
     *
     * A row that cannot be read stops the whole import and is named, like the
     * stock importer — a reconciliation built on a file that quietly lost a
     * line is wrong where nobody will look. Lines already imported are
     * skipped, so importing overlapping months is safe.
     */
    async importFile(input: {
      readonly accountId: string;
      readonly text: string;
      readonly filename?: string | undefined;
      readonly userId?: string | undefined;
    }): Promise<Result<ImportResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const account = await reconcilable(tx, input.accountId);
        if (!account.ok) return account;
        const read = readStatement(input.text, account.value.currency);
        if (!read.ok) return err({ code: 'bank_statement_unreadable', missing: read.missing });
        if (read.problems.length > 0) {
          return err({
            code: 'bank_statement_has_problems',
            rows: read.problems.map((problem) => problem.row),
          });
        }
        return ok(
          await store(tx, orgId, account.value, read.rows, {
            source: 'file',
            filename: input.filename ?? null,
            userId: input.userId ?? null,
          }),
        );
      });
    },

    /** Lines pushed by a bank feed. Identified by the bank's own id, so a resend adds nothing. */
    async feed(input: {
      readonly accountId: string;
      readonly lines: readonly FeedLine[];
    }): Promise<Result<ImportResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const account = await reconcilable(tx, input.accountId);
        if (!account.ok) return account;
        const rows: StatementRow[] = input.lines
          .filter((line) => line.amount !== 0n)
          .map((line, index) => ({
            row: index + 1,
            occurredOn: line.occurredOn,
            amount: line.amount,
            description: line.description.slice(0, 500),
            reference: line.reference ?? null,
            balance: line.balance ?? null,
            fingerprint: feedFingerprint(line.externalId),
          }));
        return ok(
          await store(tx, orgId, account.value, rows, {
            source: 'feed',
            filename: null,
            userId: null,
          }),
        );
      });
    },

    /** The statement, newest first, each unmatched line with what it probably is. */
    async lines(accountId: string, options: { limit?: number } = {}) {
      return withTenant(database, orgId, async (tx): Promise<readonly StatementLine[]> => {
        const account = await reconcilable(tx, accountId);
        if (!account.ok) return [];
        const currency = account.value.currency;
        const money = (value: bigint) => toMoneyDto(value as MinorUnits, currency);

        const rows = await tx
          .select({
            line: bankLines,
            postingId: bankMatches.postingId,
            transactionId: postings.transactionId,
            entryDescription: transactions.description,
          })
          .from(bankLines)
          .leftJoin(
            bankMatches,
            and(eq(bankMatches.lineId, bankLines.id), isNull(bankMatches.removedAt)),
          )
          .leftJoin(postings, eq(postings.id, bankMatches.postingId))
          .leftJoin(transactions, eq(transactions.id, postings.transactionId))
          .where(eq(bankLines.accountId, accountId))
          .orderBy(desc(bankLines.occurredOn), desc(bankLines.createdAt), desc(bankLines.id))
          .limit(options.limit ?? 200);

        const unmatchedLines = rows.filter((row) => row.postingId === null);
        const open = await openPostings(
          tx,
          accountId,
          earliest(rows.map((r) => r.line.occurredOn)),
        );
        const suggestions = new Map(
          suggestMatches(
            unmatchedLines.map((row) => ({
              id: row.line.id,
              on: row.line.occurredOn,
              amount: row.line.amountMinor,
            })),
            open.map((posting) => ({
              id: posting.postingId,
              on: posting.occurredOn,
              amount: posting.amount,
            })),
          ).map((suggestion) => [suggestion.lineId, suggestion]),
        );
        const byPosting = new Map(open.map((posting) => [posting.postingId, posting]));

        return rows.map(({ line, postingId, transactionId, entryDescription }) => {
          const suggestion = suggestions.get(line.id);
          return {
            id: line.id,
            occurredOn: line.occurredOn,
            amount: money(line.amountMinor),
            description: line.description,
            reference: line.reference,
            balance: line.balanceMinor === null ? null : money(line.balanceMinor),
            match:
              postingId && transactionId
                ? { postingId, transactionId, description: entryDescription ?? '' }
                : null,
            candidates: (suggestion?.candidates ?? []).flatMap((id) => {
              const posting = byPosting.get(id);
              return posting
                ? [
                    {
                      postingId: posting.postingId,
                      transactionId: posting.transactionId,
                      occurredOn: posting.occurredOn,
                      description: posting.description,
                    },
                  ]
                : [];
            }),
            suggested: suggestion?.suggested ?? null,
          };
        });
      });
    },

    /** Says a statement line and a posting are the same movement of money. */
    async match(input: {
      readonly lineId: string;
      readonly postingId: string;
      readonly userId?: string | undefined;
    }): Promise<Result<StatementLineRef, LedgerError>> {
      return withTenant(database, orgId, (tx) =>
        matchIn(tx, orgId, input.lineId, input.postingId, input.userId ?? null),
      );
    },

    /**
     * Matches every line whose suggestion is beyond doubt, in one go.
     *
     * Only the suggestions `suggestMatches` makes — the same amount, each the
     * other's nearest within two weeks. Anything ambiguous is left for a
     * person, which is the whole reason it is not matched automatically on
     * import.
     */
    async matchSuggested(accountId: string, userId?: string): Promise<number> {
      const suggested = (await this.lines(accountId, { limit: 1000 })).filter(
        (line) => line.match === null && line.suggested !== null,
      );
      let matched = 0;
      for (const line of suggested) {
        const result = await this.match({
          lineId: line.id,
          postingId: line.suggested ?? '',
          userId,
        });
        if (result.ok) matched += 1;
      }
      return matched;
    },

    /** Postings on the account from a day on that no statement line is matched to. */
    async unmatchedPostings(accountId: string, from: string) {
      return withTenant(database, orgId, (tx) => openPostings(tx, accountId, from, 0));
    },

    /** Undoes a match. The record that it was made stays. */
    async unmatch(input: {
      readonly lineId: string;
      readonly userId?: string | undefined;
    }): Promise<Result<StatementLineRef, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [line] = await tx
          .select({ id: bankLines.id, accountId: bankLines.accountId })
          .from(bankLines)
          .where(eq(bankLines.id, input.lineId))
          .limit(1);
        if (!line) return err({ code: 'bank_line_not_found', lineId: input.lineId });
        const undone = await tx
          .update(bankMatches)
          .set({ removedAt: new Date(), removedBy: input.userId ?? null })
          .where(and(eq(bankMatches.lineId, line.id), isNull(bankMatches.removedAt)))
          .returning({ id: bankMatches.id });
        return undone.length === 1
          ? ok({ lineId: line.id, accountId: line.accountId })
          : err({ code: 'bank_line_not_matched', lineId: line.id });
      });
    },

    /**
     * Writes the entry a statement line needs, and matches it, in one step.
     *
     * For money the bank moved that the books never heard of: the monthly
     * fee, interest, a customer's transfer nobody booked. The entry is dated
     * the day the bank moved the money and posts the line's own amount, so
     * the match that follows cannot disagree with it.
     */
    async record(
      input: RecordInput,
    ): Promise<Result<{ entry: TransactionDto; lineId: string }, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [line] = await tx
          .select()
          .from(bankLines)
          .where(eq(bankLines.id, input.lineId))
          .for('update')
          .limit(1);
        if (!line) return err({ code: 'bank_line_not_found', lineId: input.lineId });
        if (await activeMatchFor(tx, line.id)) {
          return err({ code: 'bank_line_already_matched', lineId: line.id });
        }

        const org = await organisation(tx, orgId);
        const currency = line.currency as CurrencyCode;
        const occurredAt = new Date(`${line.occurredOn}T12:00:00.000Z`);
        const magnitude = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
        const base = await inFunctional(tx, orgId, magnitude, currency, org, occurredAt);
        if (!base.ok) return base;
        const sign = line.amountMinor < 0n ? -1n : 1n;

        const bankLeg: DraftPosting = {
          accountId: line.accountId,
          amount: line.amountMinor as MinorUnits,
          baseAmount: (base.value.amount * sign) as MinorUnits,
          fxRate: base.value.rate,
        };
        const other = await counterpartyLeg(
          tx,
          input.counterAccountId,
          { amount: magnitude, currency },
          { amount: base.value.amount, rate: base.value.rate, currency: org.functionalCurrency },
          sign === 1n ? -1n : 1n,
        );
        if (!other.ok) return other;

        const entry = await createJournalService(tx, orgId).postEntry({
          description:
            input.description?.trim() ||
            ledgerMessages(org.locale).fromBankStatement(line.description),
          currency: org.functionalCurrency,
          occurredAt,
          metadata: {
            bankLine: line.id,
            ...(line.reference ? { reference: line.reference } : {}),
          },
          actor: { ...(input.userId ? { userId: input.userId } : {}), via: input.via ?? 'ui' },
          postings: [bankLeg, other.value],
        });
        if (!entry.ok) return entry;

        const posting = entry.value.transaction.postings.find(
          (candidate) => candidate.accountId === line.accountId,
        );
        if (!posting) return err({ code: 'bank_posting_not_on_account', postingId: '' });
        const matched = await matchIn(tx, orgId, line.id, posting.id, input.userId ?? null);
        if (!matched.ok) return matched;
        return ok({ entry: entry.value.transaction, lineId: line.id });
      });
    },

    /**
     * The reconciliation statement a controller signs at month end.
     *
     * The books' balance, the bank's, and the two lists that explain the
     * difference between them. When every difference is a line one side has
     * not caught up with yet, what is left is zero and the account is
     * reconciled.
     */
    async reconciliation(accountId: string): Promise<Result<Reconciliation, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const account = await reconcilable(tx, accountId);
        if (!account.ok) return account;
        const currency = account.value.currency;
        const money = (value: bigint) => toMoneyDto(value as MinorUnits, currency);

        const [bankOnly] = await tx
          .select({
            total: sql<string>`coalesce(sum(${bankLines.amountMinor}), 0)::text`,
            count: sql<number>`count(*)::int`,
          })
          .from(bankLines)
          .where(
            and(
              eq(bankLines.accountId, accountId),
              sql`NOT EXISTS (SELECT 1 FROM ${bankMatches} m WHERE m.line_id = ${bankLines.id} AND m.removed_at IS NULL)`,
            ),
          );
        const [first] = await tx
          .select({ on: sql<string | null>`min(${bankLines.occurredOn})::text` })
          .from(bankLines)
          .where(eq(bankLines.accountId, accountId));
        const [latest] = await tx
          .select({ on: bankLines.occurredOn, balance: bankLines.balanceMinor })
          .from(bankLines)
          .where(
            and(eq(bankLines.accountId, accountId), sql`${bankLines.balanceMinor} IS NOT NULL`),
          )
          .orderBy(desc(bankLines.occurredOn), desc(bankLines.createdAt), desc(bankLines.id))
          .limit(1);

        // From the first statement line: anything earlier is the opening
        // balance the statement starts from, not a difference.
        const booksOnly = first?.on ? await openPostings(tx, accountId, first.on, 0) : [];
        const booksOnlyTotal = booksOnly.reduce((sum, posting) => sum + posting.amount, 0n);
        const bankOnlyTotal = BigInt(bankOnly?.total ?? '0');
        const ledger = account.value.balance;
        const statement = latest?.balance ?? null;
        const difference =
          statement === null ? null : statement - (ledger - booksOnlyTotal + bankOnlyTotal);

        const org = await organisation(tx, orgId);
        return ok({
          accountId,
          currency,
          functionalCurrency: org.functionalCurrency,
          ledger: money(ledger),
          statement: statement === null ? null : money(statement),
          statementOn: latest?.on ?? null,
          bankOnly: { total: money(bankOnlyTotal), count: bankOnly?.count ?? 0 },
          booksOnly: {
            total: money(booksOnlyTotal),
            lines: booksOnly.map((posting) => ({
              postingId: posting.postingId,
              transactionId: posting.transactionId,
              occurredOn: posting.occurredOn,
              description: posting.description,
              amount: money(posting.amount),
            })),
          },
          difference: difference === null ? null : money(difference),
          reconciled: difference === 0n && (bankOnly?.count ?? 0) === 0,
        });
      });
    },
  };
}

export type BankService = ReturnType<typeof createBankService>;

export type StatementLineRef = { readonly lineId: string; readonly accountId: string };

type ReconcilableAccount = {
  readonly id: string;
  readonly currency: CurrencyCode;
  readonly balance: bigint;
};

/**
 * Money held or owed that a bank sends a statement for.
 *
 * A bank account, a card, a loan: monetary, and not a customer or supplier
 * ledger — those are reconciled against invoices, not statements — and not
 * an account with a structural job such as FX gains.
 */
async function reconcilable(
  tx: Transactional,
  accountId: string,
): Promise<Result<ReconcilableAccount, LedgerError>> {
  const [row] = await tx
    .select({
      id: accounts.id,
      type: accounts.type,
      currency: accounts.currency,
      balance: accounts.balanceMinor,
      monetary: accounts.monetary,
      openItems: accounts.openItems,
      role: accounts.role,
      status: accounts.status,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return err({ code: 'account_not_found', accountId });
  if (
    (row.type !== 'asset' && row.type !== 'liability') ||
    !row.monetary ||
    row.openItems ||
    row.role !== null ||
    row.status !== 'open'
  ) {
    return err({ code: 'bank_account_not_reconcilable', accountId });
  }
  return ok({ id: row.id, currency: row.currency as CurrencyCode, balance: row.balance });
}

async function knownFingerprints(
  tx: Transactional,
  accountId: string,
  rows: readonly StatementRow[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const found = await tx
    .select({ fingerprint: bankLines.fingerprint })
    .from(bankLines)
    .where(
      and(
        eq(bankLines.accountId, accountId),
        inArray(
          bankLines.fingerprint,
          rows.map((row) => row.fingerprint),
        ),
      ),
    );
  return new Set(found.map((row) => row.fingerprint));
}

function describePreview(
  rows: readonly StatementRow[],
  problems: readonly StatementProblem[],
  existing: Set<string>,
  currency: CurrencyCode,
): StatementPreview {
  const lines = rows.map((row) => ({
    row: row.row,
    occurredOn: row.occurredOn,
    amount: toMoneyDto(row.amount as MinorUnits, currency),
    description: row.description,
    reference: row.reference,
    duplicate: existing.has(row.fingerprint),
  }));
  const skipped = lines.filter((line) => line.duplicate).length;
  return { lines, problems, added: lines.length - skipped, skipped };
}

async function store(
  tx: Transactional,
  orgId: string,
  account: ReconcilableAccount,
  rows: readonly StatementRow[],
  meta: { source: 'file' | 'feed'; filename: string | null; userId: string | null },
): Promise<ImportResult> {
  const importId = newId('bankImport');
  const existing = await knownFingerprints(tx, account.id, rows);
  const fresh = rows.filter((row) => !existing.has(row.fingerprint));
  // Within one batch, too: a feed that sends the same id twice in one call.
  const unique = [...new Map(fresh.map((row) => [row.fingerprint, row])).values()];

  await tx.insert(bankImports).values({
    id: importId,
    orgId,
    accountId: account.id,
    source: meta.source,
    filename: meta.filename,
    linesAdded: unique.length,
    linesSkipped: rows.length - unique.length,
    importedBy: meta.userId,
  });
  if (unique.length > 0) {
    await tx
      .insert(bankLines)
      .values(
        unique.map((row) => ({
          id: newId('bankLine'),
          orgId,
          accountId: account.id,
          currency: account.currency,
          importId,
          occurredOn: row.occurredOn,
          amountMinor: row.amount,
          description: row.description,
          reference: row.reference,
          balanceMinor: row.balance,
          fingerprint: row.fingerprint,
        })),
      )
      // Two imports of the same file racing each other: the second adds nothing.
      .onConflictDoNothing({ target: [bankLines.accountId, bankLines.fingerprint] });
  }
  return { importId, added: unique.length, skipped: rows.length - unique.length };
}

type OpenPosting = {
  readonly postingId: string;
  readonly transactionId: string;
  readonly occurredOn: string;
  readonly description: string;
  readonly amount: bigint;
};

/**
 * Postings on the account no statement line has been matched to.
 *
 * As candidates for a match, from two weeks before the first statement line
 * — a cheque written on the 30th clears on the 2nd. As differences in the
 * reconciliation, from the first line itself.
 */
async function openPostings(
  tx: Transactional,
  accountId: string,
  from: string | null,
  lookbackDays = MATCH_WINDOW_DAYS,
): Promise<OpenPosting[]> {
  if (!from) return [];
  const since = new Date(`${from}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const rows = await tx
    .select({
      postingId: postings.id,
      transactionId: postings.transactionId,
      occurredAt: transactions.occurredAt,
      description: transactions.description,
      amount: postings.amountMinor,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(transactions.status, 'posted'),
        gte(transactions.occurredAt, since),
        sql`NOT EXISTS (SELECT 1 FROM ${bankMatches} m WHERE m.posting_id = ${postings.id} AND m.removed_at IS NULL)`,
      ),
    )
    .orderBy(asc(transactions.occurredAt), asc(postings.id));
  return rows.map((row) => ({
    postingId: row.postingId,
    transactionId: row.transactionId,
    occurredOn: row.occurredAt.toISOString().slice(0, 10),
    description: row.description,
    amount: row.amount,
  }));
}

async function activeMatchFor(tx: Transactional, lineId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: bankMatches.id })
    .from(bankMatches)
    .where(and(eq(bankMatches.lineId, lineId), isNull(bankMatches.removedAt)))
    .limit(1);
  return Boolean(row);
}

async function matchIn(
  tx: Transactional,
  orgId: string,
  lineId: string,
  postingId: string,
  userId: string | null,
): Promise<Result<StatementLineRef, LedgerError>> {
  const [line] = await tx
    .select()
    .from(bankLines)
    .where(eq(bankLines.id, lineId))
    .for('update')
    .limit(1);
  if (!line) return err({ code: 'bank_line_not_found', lineId });
  const [posting] = await tx
    .select({ accountId: postings.accountId, amount: postings.amountMinor })
    .from(postings)
    .where(eq(postings.id, postingId))
    .limit(1);
  if (!posting || posting.accountId !== line.accountId) {
    return err({ code: 'bank_posting_not_on_account', postingId });
  }
  if (posting.amount !== line.amountMinor) {
    const currency = line.currency as CurrencyCode;
    return err({
      code: 'bank_match_amount_mismatch',
      lineAmount: toDecimalString(minorUnits(line.amountMinor), currency),
      postingAmount: toDecimalString(minorUnits(posting.amount), currency),
      currency,
    });
  }
  if (await activeMatchFor(tx, line.id)) return err({ code: 'bank_line_already_matched', lineId });
  const [taken] = await tx
    .select({ id: bankMatches.id })
    .from(bankMatches)
    .where(and(eq(bankMatches.postingId, postingId), isNull(bankMatches.removedAt)))
    .limit(1);
  if (taken) return err({ code: 'bank_posting_already_matched', postingId });

  await tx.insert(bankMatches).values({
    id: newId('bankMatch'),
    orgId,
    accountId: line.accountId,
    lineId: line.id,
    postingId,
    matchedBy: userId,
  });
  return ok({ lineId: line.id, accountId: line.accountId });
}

function earliest(days: readonly string[]): string | null {
  return days.reduce<string | null>((min, day) => (min === null || day < min ? day : min), null);
}

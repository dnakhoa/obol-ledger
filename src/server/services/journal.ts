import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { presentedBalance, type AccountType } from '@/server/domain/account';
import type { LedgerError } from '@/server/domain/errors';
import { validateDraft, type DraftPosting } from '@/server/domain/transaction';
import { accounts, idempotencyKeys, postings, transactions } from '@/server/db/schema';
import type { AccountRow } from '@/server/db/schema';
import type { Database, Transactional } from '@/server/db/types';
import { toPostingDto, toTransactionDto } from './serialize';
import type { Page, TransactionDto } from './dto';
import { IDEMPOTENCY_RETENTION_MS } from './idempotency';
import { decodeCursor, encodeCursor } from './cursor';

export type PostEntryInput = {
  readonly description: string;
  readonly currency: CurrencyCode;
  readonly occurredAt?: Date;
  readonly postings: readonly DraftPosting[];
  /**
   * Supplied by the HTTP layer, which fingerprints the *raw* request body. A
   * retry is "the same request" from the client's point of view, so the hash
   * has to be taken over what the client sent, not over defaults we filled in.
   */
  readonly idempotency?: { readonly key: string; readonly fingerprint: string };
};

export type PostEntryResult = {
  readonly transaction: TransactionDto;
  /** True when a stored response was returned instead of new work being done. */
  readonly replayed: boolean;
};

/**
 * Carries a domain error out of a database transaction.
 *
 * drizzle commits whatever the callback *returns*, so returning an `Err` from
 * inside `database.transaction` would persist the half-written entry we were
 * trying to reject. Throwing is the only way to roll back, so domain failures
 * travel as this sentinel and are converted back into an `Err` immediately
 * outside the transaction — the throw is an implementation detail of the
 * rollback, never part of the service's contract.
 */
class DomainAbort extends Error {
  constructor(readonly ledgerError: LedgerError) {
    super(ledgerError.code);
    this.name = 'DomainAbort';
  }
}

export function createJournalService(database: Database) {
  /**
   * Records a balanced journal entry.
   *
   * Order of operations matters and is deliberate:
   *  1. structural validation, which needs no database at all;
   *  2. claim the idempotency key, so a concurrent duplicate blocks here;
   *  3. load and vet the accounts;
   *  4. project the resulting balances and reject an overdraft with a useful
   *     error, before Postgres rejects it with a constraint name;
   *  5. insert, letting the deferred trigger have the final word at COMMIT.
   */
  async function postEntry(input: PostEntryInput): Promise<Result<PostEntryResult, LedgerError>> {
    const draft = validateDraft({ currency: input.currency, postings: input.postings });
    if (!draft.ok) return draft;

    try {
      const result = await database.transaction(async (tx) => {
        if (input.idempotency) {
          const replay = await claimIdempotencyKey(tx, input.idempotency);
          if (replay) return { transaction: replay, replayed: true };
        }

        const accountRows = await loadAccounts(tx, input.postings);
        const entry = await writeEntry(tx, input, accountRows);

        if (input.idempotency) {
          await tx
            .update(idempotencyKeys)
            .set({
              transactionId: entry.id,
              responseStatus: 201,
              responseBody: entry,
            })
            .where(eq(idempotencyKeys.key, input.idempotency.key));
        }

        return { transaction: entry, replayed: false };
      });

      return ok(result);
    } catch (error) {
      if (error instanceof DomainAbort) return err(error.ledgerError);
      throw error;
    }
  }

  /**
   * Inserts the key before doing any work, so that a second request with the
   * same key blocks on the primary-key index until this transaction settles,
   * rather than racing it and posting the entry twice.
   *
   * Returns the stored response when this is a replay, `undefined` when the key
   * is new, and aborts when the key was reused for a different body.
   */
  async function claimIdempotencyKey(
    tx: Transactional,
    idempotency: { key: string; fingerprint: string },
  ): Promise<TransactionDto | undefined> {
    const claimed = await tx
      .insert(idempotencyKeys)
      .values({
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        responseStatus: 0,
        responseBody: {},
        expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length > 0) return undefined;

    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idempotency.key))
      .limit(1);

    if (!existing) throw new Error(`idempotency key ${idempotency.key} vanished mid-transaction`);
    if (existing.fingerprint !== idempotency.fingerprint) {
      throw new DomainAbort({ code: 'idempotency_key_reused', key: idempotency.key });
    }
    return existing.responseBody as TransactionDto;
  }

  /** Loads every referenced account and checks it can legally be posted to. */
  async function loadAccounts(
    tx: Transactional,
    draftPostings: readonly DraftPosting[],
  ): Promise<Map<string, AccountRow>> {
    const ids = draftPostings.map((posting) => posting.accountId);
    const rows = await tx.select().from(accounts).where(inArray(accounts.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const posting of draftPostings) {
      const account = byId.get(posting.accountId);
      if (!account) {
        throw new DomainAbort({ code: 'account_not_found', accountId: posting.accountId });
      }
      if (account.status !== 'open') {
        throw new DomainAbort({ code: 'account_closed', accountId: posting.accountId });
      }
    }

    return byId;
  }

  async function writeEntry(
    tx: Transactional,
    input: PostEntryInput,
    accountRows: Map<string, AccountRow>,
  ): Promise<TransactionDto> {
    assertCurrenciesMatch(input.currency, input.postings, accountRows);
    assertNoOverdraft(input.currency, input.postings, accountRows);

    const transactionId = newId('transaction');
    const occurredAt = input.occurredAt ?? new Date();

    const [transactionRow] = await tx
      .insert(transactions)
      .values({
        id: transactionId,
        description: input.description,
        currency: input.currency,
        occurredAt,
      })
      .returning();
    if (!transactionRow) throw new Error('INSERT ... RETURNING produced no transaction row');

    // Sequence records the order the caller wrote the entry in; the rows are
    // *inserted* in account-id order so that concurrent entries touching the
    // same pair of accounts always take row locks in the same order and cannot
    // deadlock against each other.
    const rows = input.postings
      .map((posting, sequence) => ({
        id: newId('posting'),
        transactionId,
        accountId: posting.accountId,
        amountMinor: posting.amount,
        currency: input.currency,
        sequence,
      }))
      .sort((left, right) => (left.accountId < right.accountId ? -1 : 1));

    const postingRows = await tx.insert(postings).values(rows).returning();

    const dtos = postingRows
      .map((row) => toPostingDto(row, accountRows.get(row.accountId)?.name ?? 'unknown'))
      .sort((left, right) => left.sequence - right.sequence);

    return toTransactionDto(transactionRow, dtos);
  }

  function assertCurrenciesMatch(
    currency: CurrencyCode,
    draftPostings: readonly DraftPosting[],
    accountRows: Map<string, AccountRow>,
  ): void {
    for (const posting of draftPostings) {
      const account = accountRows.get(posting.accountId);
      if (account && account.currency !== currency) {
        throw new DomainAbort({
          code: 'currency_mismatch',
          expected: account.currency as CurrencyCode,
          received: currency,
          accountId: posting.accountId,
        });
      }
    }
  }

  /**
   * Rejects an entry that would push a no-overdraft account below zero.
   *
   * The same rule exists as a CHECK constraint, but a constraint can only say
   * "accounts_overdraft_check failed". Projecting the balance here lets the API
   * answer with the account, its available funds, and what was requested.
   */
  function assertNoOverdraft(
    currency: CurrencyCode,
    draftPostings: readonly DraftPosting[],
    accountRows: Map<string, AccountRow>,
  ): void {
    const deltas = new Map<string, bigint>();
    for (const posting of draftPostings) {
      deltas.set(posting.accountId, (deltas.get(posting.accountId) ?? 0n) + posting.amount);
    }

    for (const [accountId, delta] of deltas) {
      const account = accountRows.get(accountId);
      if (!account || account.overdraftAllowed) continue;

      const type = account.type as AccountType;
      const projected = presentedBalance((account.balanceMinor + delta) as MinorUnits, type);
      if (projected < 0n) {
        throw new DomainAbort({
          code: 'insufficient_funds',
          accountId,
          available: toDecimalString(
            presentedBalance(account.balanceMinor as MinorUnits, type),
            currency,
          ),
          requested: toDecimalString(
            presentedBalance(-delta as MinorUnits, type) as MinorUnits,
            currency,
          ),
          currency,
        });
      }
    }
  }

  return {
    postEntry,

    async byId(id: string): Promise<TransactionDto | undefined> {
      const [row] = await database
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))
        .limit(1);
      if (!row) return undefined;
      const [entry] = await hydrate(database, [row]);
      return entry;
    },

    /**
     * Keyset pagination over `(occurredAt, id)`, not OFFSET.
     *
     * `OFFSET n` makes Postgres walk and discard n rows, so page 500 costs 500
     * times page 1, and a concurrent insert shifts every subsequent page —
     * a reader paging through a busy ledger would see an entry twice or not at
     * all. Seeking on the last row's key is a single index dive and is stable
     * while rows are being written.
     *
     * The comparison is row-wise — `(occurred_at, id) < ($1, $2)` — which
     * Postgres can satisfy directly from the `(occurred_at, id)` index rather
     * than by rewriting it as an OR of two conditions.
     */
    async list(options: {
      limit: number;
      cursor?: string | undefined;
    }): Promise<Page<TransactionDto>> {
      const limit = Math.min(Math.max(options.limit, 1), 100);
      const after = options.cursor ? decodeCursor(options.cursor) : undefined;

      const rows = await database
        .select()
        .from(transactions)
        .where(
          after
            ? sql`(${transactions.occurredAt}, ${transactions.id}) < (${after.occurredAt}, ${after.id})`
            : undefined,
        )
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const items = await hydrate(database, page);
      const last = page.at(-1);

      return {
        items,
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ occurredAt: last.occurredAt, id: last.id })
            : null,
      };
    },
  };
}

/** Fetches the postings for a page of entries in one round trip, not N. */
async function hydrate(
  database: Database,
  rows: readonly (typeof transactions.$inferSelect)[],
): Promise<TransactionDto[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const lines = await database
    .select({ posting: postings, accountName: accounts.name })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(inArray(postings.transactionId, ids))
    .orderBy(asc(postings.transactionId), asc(postings.sequence));

  const byTransaction = new Map<string, ReturnType<typeof toPostingDto>[]>();
  for (const line of lines) {
    const bucket = byTransaction.get(line.posting.transactionId) ?? [];
    bucket.push(toPostingDto(line.posting, line.accountName));
    byTransaction.set(line.posting.transactionId, bucket);
  }

  return rows.map((row) => toTransactionDto(row, byTransaction.get(row.id) ?? []));
}

export type JournalService = ReturnType<typeof createJournalService>;

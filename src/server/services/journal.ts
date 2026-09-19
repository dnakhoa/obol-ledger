import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { deriveBalances, presentedBalance, type AccountType } from '@/server/domain/account';
import type { LedgerError } from '@/server/domain/errors';
import { canTransition, type TransactionStatus } from '@/server/domain/transaction-status';
import { validateDraft, type DraftPosting } from '@/server/domain/transaction';
import { accounts, idempotencyKeys, postings, transactions } from '@/server/db/schema';
import type { AccountRow } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { recordOutcome, traced } from '@/server/observability/tracing';
import type { Database, Transactional } from '@/server/db/types';
import { toPostingDto, toTransactionDto } from './serialize';
import type { Page, TransactionDto } from './dto';
import { IDEMPOTENCY_RETENTION_MS } from './idempotency';
import { buildPage, decodeCursor, type PageDirection } from './cursor';

export type PostEntryInput = {
  readonly description: string;
  readonly currency: CurrencyCode;
  readonly occurredAt?: Date;
  readonly postings: readonly DraftPosting[];
  /**
   * `pending` reserves funds without moving them; `posted` settles
   * immediately. Defaults to posted, which is what a simple transfer wants.
   */
  readonly status?: 'pending' | 'posted' | undefined;
  /**
   * Optimistic concurrency: apply only if these accounts are still at the
   * versions the caller last read. Lets a caller compute a decision from a
   * balance and commit it without holding a lock across the round trip.
   */
  readonly expectedVersions?: Readonly<Record<string, number>> | undefined;
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

export function createJournalService(database: Database, orgId: string) {
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
    return traced(
      'ledger.post_entry',
      {
        'ledger.org_id': orgId,
        'ledger.currency': input.currency,
        'ledger.status': input.status ?? 'posted',
        'ledger.posting_count': input.postings.length,
        'ledger.idempotent': input.idempotency !== undefined,
      },
      async (span) => {
        const result = await postEntryInner(input);
        // A refusal is the system working, not failing, so the span stays OK
        // and carries the reason instead of an exception.
        recordOutcome(
          span,
          result.ok ? 'posted' : 'rejected',
          result.ok ? undefined : result.error.code,
        );
        if (result.ok) span.setAttribute('ledger.transaction_id', result.value.transaction.id);
        return result;
      },
    );
  }

  async function postEntryInner(
    input: PostEntryInput,
  ): Promise<Result<PostEntryResult, LedgerError>> {
    const draft = validateDraft({ currency: input.currency, postings: input.postings });
    if (!draft.ok) return draft;

    try {
      // `withTenant` opens the transaction and stamps it with the tenant, so
      // this does not open a second one: tenancy and atomicity share a scope.
      const result = await withTenant(database, orgId, async (tx) => {
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
        orgId,
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
    reversesTransactionId?: string,
  ): Promise<TransactionDto> {
    assertCurrenciesMatch(input.currency, input.postings, accountRows);
    assertVersions(input.expectedVersions, accountRows);
    assertNoOverdraft(input.currency, input.postings, accountRows);

    const transactionId = newId('transaction');
    const occurredAt = input.occurredAt ?? new Date();
    const status = input.status ?? 'posted';

    const [transactionRow] = await tx
      .insert(transactions)
      .values({
        id: transactionId,
        orgId,
        description: input.description,
        currency: input.currency,
        occurredAt,
        status,
        // The CHECK constraint requires the timestamps to agree with the
        // status, so they are set together rather than backfilled later.
        ...(status === 'posted' ? { postedAt: new Date() } : {}),
        ...(reversesTransactionId ? { reversesTransactionId } : {}),
      })
      .returning();
    if (!transactionRow) throw new Error('INSERT ... RETURNING produced no transaction row');

    // Sequence records the order the caller wrote the entry in; the rows are
    // *inserted* in account-id order so that concurrent entries touching the
    // same pair of accounts always take row locks in the same order and cannot
    // deadlock against each other.
    //
    // This is not a hopeful comment: `tests/concurrency/transfers.test.ts`
    // fires transfers in both directions at once over real connections, and
    // deleting this `.sort` makes Postgres report `40P01 deadlock detected`.
    const rows = input.postings
      .map((posting, sequence) => ({
        id: newId('posting'),
        orgId,
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
  /**
   * Rejects a write whose accounts have moved since the caller read them.
   *
   * This is what lets a caller decide "they can afford it" from a balance and
   * then commit that decision safely: if anything touched the account in
   * between, the version has advanced and the write is refused rather than
   * applied against a world that no longer matches the one it was reasoned
   * about. A lock held across the round trip would be the alternative, and a
   * far more expensive one.
   */
  function assertVersions(
    expected: Readonly<Record<string, number>> | undefined,
    accountRows: Map<string, AccountRow>,
  ): void {
    if (!expected) return;
    for (const [accountId, version] of Object.entries(expected)) {
      const account = accountRows.get(accountId);
      if (!account) continue;
      if (account.version !== version) {
        throw new DomainAbort({
          code: 'stale_account_version',
          accountId,
          expected: version,
          actual: account.version,
        });
      }
    }
  }

  /*
   * Deliberately the same check for pending and posted entries.
   *
   * Projecting against `available` happens to be correct for both: a posted
   * outflow reduces the posted balance, and a pending one reduces it via the
   * reservation, so `available + presentedDelta` is the resulting spendable
   * figure either way. A pending *inflow* is the only asymmetric case — it
   * does not raise `available` until it settles — and the formula is merely
   * permissive there, which is harmless because an inflow cannot overdraw.
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
      const balances = deriveBalances({
        signedPosted: account.balanceMinor as MinorUnits,
        pendingInflow: account.pendingInflowMinor as MinorUnits,
        pendingOutflow: account.pendingOutflowMinor as MinorUnits,
        type,
      });

      // Checked against *available*, not posted. A pending withdrawal has
      // already reserved its funds, so the next one must see them gone —
      // otherwise two authorisations against the same balance both succeed.
      const presentedDelta = presentedBalance(delta as MinorUnits, type);
      const projected = (balances.available + presentedDelta) as MinorUnits;

      if (projected < 0n) {
        throw new DomainAbort({
          code: 'insufficient_funds',
          accountId,
          available: toDecimalString(balances.available, currency),
          requested: toDecimalString(
            presentedBalance(-delta as MinorUnits, type) as MinorUnits,
            currency,
          ),
          currency,
        });
      }
    }
  }

  /**
   * Undoes an entry by posting its mirror image.
   *
   * The only correction a ledger permits. `postings` and `transactions` reject
   * UPDATE and DELETE, so a mistake cannot be edited away — it is cancelled by
   * a second entry with the opposite postings, leaving both on the record and
   * the net effect at zero. An auditor can see what was recorded, that it was
   * wrong, and what was done about it.
   *
   * Three things make this safe rather than merely convenient:
   *
   *  - The reversal is a normal entry, so it goes through the same balance
   *    rule, the same overdraft check and the same deferred constraint. A
   *    reversal that would overdraw an account is refused, which is correct:
   *    the money has already moved on.
   *  - `reverses_transaction_id` records the link, so "is this entry still in
   *    effect?" is answerable. Without it a reversal is just another entry
   *    with opposite signs.
   *  - A partial unique index allows one reversal per entry. Two concurrent
   *    requests both pass the check below and one loses at the index, which is
   *    where that race belongs — an application check cannot win it.
   */
  async function reverseEntry(input: {
    readonly transactionId: string;
    readonly description?: string | undefined;
    readonly occurredAt?: Date | undefined;
    readonly idempotency?: { readonly key: string; readonly fingerprint: string } | undefined;
  }): Promise<Result<PostEntryResult, LedgerError>> {
    try {
      const result = await withTenant(database, orgId, async (tx) => {
        if (input.idempotency) {
          const replay = await claimIdempotencyKey(tx, input.idempotency);
          if (replay) return { transaction: replay, replayed: true };
        }

        const [original] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        if (!original) {
          throw new DomainAbort({ code: 'entry_not_found', transactionId: input.transactionId });
        }

        const [existing] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.reversesTransactionId, original.id))
          .limit(1);
        if (existing) {
          throw new DomainAbort({
            code: 'already_reversed',
            transactionId: original.id,
            reversedBy: existing.id,
          });
        }

        const original_postings = await tx
          .select()
          .from(postings)
          .where(eq(postings.transactionId, original.id))
          .orderBy(asc(postings.sequence));

        const accountRows = await loadAccounts(
          tx,
          original_postings.map((posting) => ({
            accountId: posting.accountId,
            amount: posting.amountMinor as MinorUnits,
          })),
        );

        const entry = await writeEntry(
          tx,
          {
            description: input.description ?? `Reversal of ${original.description}`,
            currency: original.currency as CurrencyCode,
            ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
            // The mirror image: every amount negated, order preserved.
            postings: original_postings.map((posting) => ({
              accountId: posting.accountId,
              amount: -posting.amountMinor as MinorUnits,
            })),
          },
          accountRows,
          original.id,
        );

        if (input.idempotency) {
          await tx
            .update(idempotencyKeys)
            .set({ transactionId: entry.id, responseStatus: 201, responseBody: entry })
            .where(eq(idempotencyKeys.key, input.idempotency.key));
        }

        return { transaction: entry, replayed: false };
      });

      return ok(result);
    } catch (error) {
      if (error instanceof DomainAbort) return err(error.ledgerError);
      // The partial unique index is the authority on double reversal, so a
      // concurrent loser surfaces here rather than as an opaque 500.
      if (isUniqueViolation(error, 'transactions_one_reversal_per_entry')) {
        return err({
          code: 'already_reversed',
          transactionId: input.transactionId,
          reversedBy: 'a concurrent request',
        });
      }
      throw error;
    }
  }

  /**
   * Settles or cancels a pending entry.
   *
   * The amounts never change — they were fixed when the entry was written.
   * What changes is whether they count as reserved or as moved, and the
   * database moves them between the two balance columns in a trigger, so the
   * three balances cannot disagree with the postings behind them.
   *
   * Posting re-checks the overdraft rule. A reservation made when funds were
   * available can still fail to settle if something else drained the account
   * first, and silently overdrawing at settlement would be the worst possible
   * time to discover it.
   */
  async function transitionEntry(input: {
    readonly transactionId: string;
    readonly to: 'posted' | 'archived';
  }): Promise<Result<TransactionDto, LedgerError>> {
    try {
      const result = await withTenant(database, orgId, async (tx) => {
        const [entry] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, input.transactionId))
          .limit(1);
        if (!entry) {
          throw new DomainAbort({ code: 'entry_not_found', transactionId: input.transactionId });
        }

        const from = entry.status as TransactionStatus;
        if (!canTransition(from, input.to)) {
          throw new DomainAbort({
            code: 'invalid_status_transition',
            transactionId: entry.id,
            from,
            to: input.to,
          });
        }

        const now = new Date();
        await tx
          .update(transactions)
          .set(
            input.to === 'posted'
              ? { status: 'posted', postedAt: now }
              : { status: 'archived', archivedAt: now },
          )
          .where(eq(transactions.id, entry.id));

        const [updated] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, entry.id))
          .limit(1);
        if (!updated) throw new Error('transaction vanished mid-transition');

        const [dto] = await hydrate(tx, [updated]);
        if (!dto) throw new Error('failed to hydrate the transitioned entry');
        return dto;
      });

      return ok(result);
    } catch (error) {
      if (error instanceof DomainAbort) return err(error.ledgerError);
      // The overdraft CHECK is the authority on whether a reservation can
      // still settle, so a violation at this point is a business outcome
      // rather than a fault.
      if (isCheckViolation(error, 'accounts_overdraft_check')) {
        return err({
          code: 'insufficient_funds',
          accountId: 'one of the entry\u2019s accounts',
          available: 'less than required',
          requested: 'the entry amount',
          currency: 'USD',
        });
      }
      throw error;
    }
  }

  return {
    postEntry,
    reverseEntry,
    /** Settle a pending entry: its amounts move from reserved to posted. */
    postPending: (transactionId: string) => transitionEntry({ transactionId, to: 'posted' }),
    /** Cancel a pending entry: the reservation is released and nothing moves. */
    archivePending: (transactionId: string) => transitionEntry({ transactionId, to: 'archived' }),

    async byId(id: string): Promise<TransactionDto | undefined> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
        if (!row) return undefined;
        const [entry] = await hydrate(tx, [row]);
        return entry;
      });
    },

    /**
     * Keyset pagination over `(occurredAt, id)`, not OFFSET.
     *
     * `OFFSET n` makes Postgres walk and discard n rows, so page 500 costs 500
     * times page 1, and a concurrent insert shifts every subsequent page — a
     * reader paging through a busy ledger would see an entry twice or not at
     * all. Seeking on the last row's key is a single index dive and is stable
     * while rows are being written.
     *
     * The comparison is row-wise — `(occurred_at, id) < ($1, $2)` — which
     * Postgres satisfies directly from the `(occurred_at, id)` index rather
     * than by rewriting it as an OR of two conditions.
     *
     * Paging *backward* is its own query, not a reversal of this one: it seeks
     * with `>` in ascending order and the rows are flipped for display. A
     * forward cursor simply does not contain the information needed to walk
     * back, which is the trade keyset pagination makes for its stability.
     */
    async list(options: {
      limit: number;
      cursor?: string | undefined;
      direction?: PageDirection | undefined;
      /** Restrict to entries touching this account. */
      accountId?: string | undefined;
      /** Case-insensitive substring of the description. */
      search?: string | undefined;
      /** Restrict to one lifecycle state. */
      status?: TransactionStatus | undefined;
    }): Promise<Page<TransactionDto>> {
      const limit = Math.min(Math.max(options.limit, 1), 100);
      const direction = options.direction ?? 'forward';
      const after = options.cursor ? decodeCursor(options.cursor) : undefined;
      const backward = direction === 'backward' && after !== undefined;

      return withTenant(database, orgId, async (tx) => {
        // Filters combine with the keyset predicate rather than replacing it,
        // so a filtered list pages exactly as an unfiltered one does. The
        // account filter is a semi-join: an entry qualifies if *any* of its
        // postings touch the account, and `exists` stops at the first match
        // instead of materialising them all.
        const filters = [
          after
            ? backward
              ? sql`(${transactions.occurredAt}, ${transactions.id}) > (${after.occurredAt}, ${after.id})`
              : sql`(${transactions.occurredAt}, ${transactions.id}) < (${after.occurredAt}, ${after.id})`
            : undefined,
          options.accountId
            ? sql`exists (
                select 1 from postings p
                 where p.transaction_id = ${transactions.id}
                   and p.account_id = ${options.accountId}
              )`
            : undefined,
          options.search
            ? sql`${transactions.description} ilike ${`%${options.search}%`}`
            : undefined,
          options.status ? eq(transactions.status, options.status) : undefined,
        ].filter((clause) => clause !== undefined);

        const rows = await tx
          .select()
          .from(transactions)
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(
            ...(backward
              ? [asc(transactions.occurredAt), asc(transactions.id)]
              : [desc(transactions.occurredAt), desc(transactions.id)]),
          )
          .limit(limit + 1);

        const page = buildPage({
          rows,
          limit,
          direction: backward ? 'backward' : 'forward',
          hasCursor: after !== undefined,
          keyOf: (row) => ({ occurredAt: row.occurredAt, id: row.id }),
        });

        return { ...page, items: await hydrate(tx, page.items) };
      });
    },
  };
}

/** Fetches the postings for a page of entries in one round trip, not N. */
async function hydrate(
  database: Transactional,
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

  // Which of these entries have since been reversed. One query for the page
  // rather than one per row: "is this still in effect?" is asked of every
  // entry on screen, and N+1 for a boolean would be a poor trade.
  const reversals = await database
    .select({ original: transactions.reversesTransactionId, reversal: transactions.id })
    .from(transactions)
    .where(inArray(transactions.reversesTransactionId, ids));

  const reversedBy = new Map(
    reversals.filter((row) => row.original !== null).map((row) => [row.original!, row.reversal]),
  );

  return rows.map((row) =>
    toTransactionDto(row, byTransaction.get(row.id) ?? [], reversedBy.get(row.id) ?? null),
  );
}

export type JournalService = ReturnType<typeof createJournalService>;

/** Walks the cause chain for a check-violation on a named constraint. */
function isCheckViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const candidate = current as { code?: unknown; constraint?: unknown };
    if (candidate.code === '23514' && candidate.constraint === constraint) return true;
    current = current.cause;
  }
  return false;
}

/** Walks the cause chain for a unique-violation on a named constraint. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    const candidate = current as { code?: unknown; constraint?: unknown };
    if (candidate.code === '23505' && candidate.constraint === constraint) return true;
    current = current.cause;
  }
  return false;
}

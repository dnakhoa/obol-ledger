import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { MinorUnits, CurrencyCode } from '@/lib/money';
import { ledgerMessages, type Locale } from '@/lib/i18n';
import type { LedgerError } from '@/server/domain/errors';
import {
  endOfMonth,
  isClosable,
  monthOf,
  TEMPORARY_ACCOUNT_TYPES,
  type PeriodStatus,
} from '@/server/domain/period';
import {
  accountingPeriods,
  accounts,
  organizations,
  postings,
  transactions,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import type { TransactionDto } from './dto';
import { createJournalService } from './journal';

export type PeriodDto = {
  readonly id: string;
  readonly periodMonth: string;
  readonly status: PeriodStatus;
  readonly closedAt: string | null;
  readonly closingTransactionId: string | null;
  /** When foreign balances were last retranslated for this month. */
  readonly revaluedAt: string | null;
  /** Entries dated inside this month, whatever its status. */
  readonly entryCount: number;
};

type PeriodRow = typeof accountingPeriods.$inferSelect;

function toDto(row: PeriodRow, entryCount: number): PeriodDto {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    status: row.status,
    closedAt: row.closedAt?.toISOString() ?? null,
    closingTransactionId: row.closingTransactionId,
    revaluedAt: row.revaluedAt?.toISOString() ?? null,
    entryCount,
  };
}

/**
 * Closing and reopening months.
 *
 * The closing entry is an *ordinary journal entry*, posted through the same
 * service every other entry goes through. It could have been a bespoke write
 * — it is generated rather than typed, after all — and that is exactly why it
 * must not be: a closing entry that skipped the balance rule would be the one
 * entry in the ledger nothing checked, and it is the entry an auditor looks at
 * first.
 */
export function createPeriodService(database: Database, orgId: string) {
  /*
   * The journal is constructed *inside* the period's transaction, from the
   * transaction handle rather than from the pool.
   *
   * A service built on the pool opens its own connection, so calling it from
   * inside another transaction waits on locks that transaction is holding —
   * a deadlock, and on the single-connection Postgres the tests run against,
   * an immediate one. Handed the transaction instead, `withTenant` opens a
   * savepoint on the same connection, and the close stays atomic: no writer
   * can slip an entry into the month between the closing entry and the lock.
   */
  const journalIn = (tx: Transactional) => createJournalService(tx, orgId);

  return {
    /** Every month that has entries or a period row, newest first. */
    async list(): Promise<PeriodDto[]> {
      return withTenant(database, orgId, async (tx) => {
        const months = await tx
          .select({
            month: sql<string>`to_char(date_trunc('month', ${transactions.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
            count: sql<string>`count(*)::text`,
          })
          .from(transactions)
          .groupBy(sql`date_trunc('month', ${transactions.occurredAt} at time zone 'UTC')`);

        const rows = await tx
          .select()
          .from(accountingPeriods)
          .orderBy(desc(accountingPeriods.periodMonth));

        const counts = new Map(months.map((row) => [row.month, Number(row.count)]));
        const byMonth = new Map(rows.map((row) => [row.periodMonth, row]));

        // A month with entries but no period row is open — the row is created
        // when it is closed, so an untouched ledger does not accumulate one
        // row per month for months nobody looked at.
        const all = new Set([...counts.keys(), ...byMonth.keys()]);
        return [...all]
          .sort((left, right) => (left < right ? 1 : -1))
          .map((month) => {
            const row = byMonth.get(month);
            return row
              ? toDto(row, counts.get(month) ?? 0)
              : {
                  id: `virtual_${month}`,
                  periodMonth: month,
                  status: 'open' as const,
                  closedAt: null,
                  closingTransactionId: null,
                  revaluedAt: null,
                  entryCount: counts.get(month) ?? 0,
                };
          });
      });
    },

    /**
     * Closes a month: posts the closing entry, then locks the month.
     *
     * The order is load-bearing and is the opposite of what reads naturally.
     * The closing entry is itself dated inside the period, so locking first
     * would make the lock reject the entry that performs the close. Both
     * happen in one transaction, so no other writer can slip an entry in
     * between.
     */
    async close(
      periodMonth: string,
      now: Date = new Date(),
    ): Promise<Result<PeriodDto, LedgerError>> {
      if (!isClosable(periodMonth, now)) {
        return err({ code: 'period_not_finished', periodMonth });
      }

      return withTenant(database, orgId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(accountingPeriods)
          .where(eq(accountingPeriods.periodMonth, periodMonth))
          .limit(1);
        if (existing?.status === 'closed') {
          return err({ code: 'period_already_closed', periodMonth });
        }

        // Periods close in order. Closing August while July is open would
        // carry an unclosed month's profit forward into a figure that claims
        // to be final, and the correction would have to reopen both.
        const [earliestOpen] = await tx
          .select({
            month: sql<string>`to_char(min(date_trunc('month', ${transactions.occurredAt} at time zone 'UTC')), 'YYYY-MM-DD')`,
          })
          .from(transactions)
          .where(
            sql`date_trunc('month', ${transactions.occurredAt} at time zone 'UTC') < ${periodMonth}::date
                and not exists (
                  select 1 from accounting_periods p
                   where p.org_id = ${orgId}
                     and p.status = 'closed'
                     and p.period_month = date_trunc('month', ${transactions.occurredAt} at time zone 'UTC')::date
                )`,
          );
        if (earliestOpen?.month) {
          return err({ code: 'earlier_period_open', periodMonth, open: earliestOpen.month });
        }

        /*
         * The gate.
         *
         * A month holding foreign currency has to be retranslated before it
         * is sealed, or the balance sheet it produces is stated at rates that
         * were out of date when it was signed. Refusing is the point: an
         * automatic revaluation inside the close would hide a policy decision
         * — which rate, which accounts — inside an operation nobody reviews,
         * and a warning would be a warning people learn to click past.
         *
         * "We retranslated and nothing had moved" satisfies this, because the
         * period carries a timestamp for it. "Nobody retranslated" does not.
         */
        const unrevalued = await foreignBalancesAwaitingRevaluation(tx, existing);
        if (unrevalued.length > 0) {
          return err({ code: 'revaluation_required', periodMonth, accounts: unrevalued });
        }

        const retained = await retainedEarnings(tx);
        if (!retained) return err({ code: 'retained_earnings_missing' });

        const balances = await temporaryBalances(tx, periodMonth);
        const closingEntry = await postClosingEntry(tx, {
          balances,
          retainedAccountId: retained.id,
          currency: retained.currency as CurrencyCode,
          periodMonth,
        });
        if (closingEntry && !closingEntry.ok) return closingEntry;

        const closingTransactionId = closingEntry?.value.id ?? null;
        if (!closingTransactionId) {
          // Nothing to close out — no revenue or expense moved this month.
          // The period still locks; an empty month is a fact about the month,
          // not a reason to leave it editable.
          return lock(tx, { periodMonth, existing, now, closingTransactionId: null });
        }

        return lock(tx, { periodMonth, existing, now, closingTransactionId });
      });
    },

    /**
     * Reopens a month by reversing its closing entry.
     *
     * The original close stays on the record and a reversing entry cancels it,
     * the same way every other correction works here. Deleting the closing
     * entry would leave no evidence that the month was ever closed, which is
     * the fact a reopening most needs to record.
     */
    async reopen(periodMonth: string): Promise<Result<PeriodDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(accountingPeriods)
          .where(eq(accountingPeriods.periodMonth, periodMonth))
          .limit(1);
        if (!row || row.status !== 'closed') {
          return err({ code: 'period_not_closed', periodMonth });
        }

        // Unlocked before the reversal, not after: the reversing entry is
        // dated inside the month, so the lock would reject the very entry
        // that undoes it. Both happen in one transaction, so the month is
        // never observably unlocked-but-still-closed.
        await tx
          .update(accountingPeriods)
          .set({ status: 'open', closedAt: null, closingTransactionId: null })
          .where(eq(accountingPeriods.id, row.id));

        if (row.closingTransactionId) {
          const reversal = await journalIn(tx).reverseEntry({
            transactionId: row.closingTransactionId,
            description: ledgerMessages(await booksLocale(tx)).reopening(periodMonth.slice(0, 7)),
            /*
             * Dated inside the month being reopened, not today.
             *
             * A reversal ordinarily happens when it happens — it is a new
             * economic event. Undoing a *close* is not: it erases a move that
             * only ever existed at the month's boundary. Dated today it would
             * leave the closing entry counted inside the month and its
             * reversal outside, so closing again would zero the month's
             * revenue against a figure that still carried the first close.
             * The test that caught this is "can close again after reopening".
             */
            occurredAt: endOfMonth(periodMonth),
          });
          if (!reversal.ok) return reversal;
        }

        const [reopened] = await tx
          .select()
          .from(accountingPeriods)
          .where(eq(accountingPeriods.id, row.id))
          .limit(1);
        return ok(toDto(reopened ?? row, 0));
      });
    },
  };

  /**
   * Foreign monetary balances this month has not had retranslated.
   *
   * Empty when the period carries a revaluation timestamp, and empty when
   * there is nothing foreign to retranslate — a single-currency ledger never
   * meets this gate at all.
   */
  async function foreignBalancesAwaitingRevaluation(
    tx: Transactional,
    period: PeriodRow | undefined,
  ): Promise<string[]> {
    if (period?.revaluedAt) return [];

    const [org] = await tx
      .select({ functional: organizations.functionalCurrency })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const functional = org?.functional ?? 'USD';

    const rows = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.monetary, true),
          ne(accounts.currency, functional),
          ne(accounts.balanceMinor, 0n),
          sql`${accounts.type} in ('asset', 'liability')`,
        ),
      )
      .orderBy(accounts.code, accounts.name);

    return rows.map((row) => row.name);
  }

  async function retainedEarnings(
    tx: Transactional,
  ): Promise<{ id: string; currency: string } | undefined> {
    const [row] = await tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.role, 'retained_earnings'))
      .limit(1);
    return row;
  }

  /**
   * What each revenue and expense account did during the month, in signed
   * storage terms.
   *
   * Computed from the month's *postings* rather than from the account's
   * cached balance, and the difference matters: the balance is since the
   * account opened, while a close is about one month. Using the balance would
   * zero out prior months a second time.
   */
  async function temporaryBalances(
    tx: Transactional,
    periodMonth: string,
  ): Promise<{ accountId: string; signed: bigint }[]> {
    const rows = await tx
      .select({
        accountId: postings.accountId,
        signed: sql<string>`sum(${postings.amountMinor})::text`,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(
        and(
          eq(transactions.status, 'posted'),
          inArray(accounts.type, [...TEMPORARY_ACCOUNT_TYPES]),
          sql`date_trunc('month', ${transactions.occurredAt} at time zone 'UTC')::date = ${periodMonth}::date`,
        ),
      )
      .groupBy(postings.accountId)
      .orderBy(asc(postings.accountId));

    return rows
      .map((row) => ({ accountId: row.accountId, signed: BigInt(row.signed) }))
      .filter((row) => row.signed !== 0n);
  }

  /**
   * The closing entry: every temporary account moved back to zero, with the
   * difference — the month's profit or loss — landing in retained earnings.
   *
   * Posted through the journal service, so it passes the same balance rule,
   * the same deferred constraint and the same overdraft check as an entry
   * somebody typed.
   */
  /** The language this tenant keeps its books in; see ADR 14. */
  async function booksLocale(tx: Transactional): Promise<Locale> {
    const [row] = await tx
      .select({ locale: organizations.locale })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return row?.locale ?? 'en';
  }

  async function postClosingEntry(
    tx: Transactional,
    input: {
      balances: { accountId: string; signed: bigint }[];
      retainedAccountId: string;
      currency: CurrencyCode;
      periodMonth: string;
    },
  ): Promise<Result<TransactionDto, LedgerError> | undefined> {
    if (input.balances.length === 0) return undefined;

    // Each account is offset by the negative of what it accumulated, which is
    // what takes it to zero. The residual is the profit, and it is what
    // retained earnings absorbs — so the entry balances by construction
    // rather than by arithmetic performed twice.
    const legs = input.balances.map((balance) => ({
      accountId: balance.accountId,
      amount: -balance.signed as MinorUnits,
    }));
    const residual = legs.reduce((total, leg) => total + BigInt(leg.amount), 0n);

    const result = await journalIn(tx).postEntry({
      description: ledgerMessages(await booksLocale(tx)).closingEntry(
        input.periodMonth.slice(0, 7),
      ),
      currency: input.currency,
      occurredAt: endOfMonth(input.periodMonth),
      metadata: { closingPeriod: input.periodMonth.slice(0, 7) },
      postings: [...legs, { accountId: input.retainedAccountId, amount: -residual as MinorUnits }],
    });

    return result.ok ? ok(result.value.transaction) : result;
  }

  async function lock(
    tx: Transactional,
    input: {
      periodMonth: string;
      existing: PeriodRow | undefined;
      now: Date;
      closingTransactionId: string | null;
    },
  ): Promise<Result<PeriodDto, LedgerError>> {
    // A period with no closing entry stays representable only because the
    // CHECK pairs `closed_at` with `closing_transaction_id`. An empty month
    // has nothing to zero, so it is recorded as open-with-no-entries rather
    // than closed-with-no-entry — the constraint is right, and this is the
    // case it caught.
    if (!input.closingTransactionId) {
      const [row] = input.existing
        ? [input.existing]
        : await tx
            .insert(accountingPeriods)
            .values({ id: newId('period'), orgId, periodMonth: input.periodMonth })
            .returning();
      return row
        ? ok(toDto(row, 0))
        : err({ code: 'period_not_closed', periodMonth: input.periodMonth });
    }

    const values = {
      status: 'closed' as const,
      closedAt: input.now,
      closingTransactionId: input.closingTransactionId,
    };

    const [row] = input.existing
      ? await tx
          .update(accountingPeriods)
          .set(values)
          .where(eq(accountingPeriods.id, input.existing.id))
          .returning()
      : await tx
          .insert(accountingPeriods)
          .values({ id: newId('period'), orgId, periodMonth: input.periodMonth, ...values })
          .returning();

    return row
      ? ok(toDto(row, 0))
      : err({ code: 'period_not_closed', periodMonth: input.periodMonth });
  }
}

export type PeriodService = ReturnType<typeof createPeriodService>;
export { monthOf };

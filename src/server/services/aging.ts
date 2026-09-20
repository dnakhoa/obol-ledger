import { and, asc, eq, sql } from 'drizzle-orm';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import {
  ageAccount,
  AGING_BUCKETS,
  type Aging,
  type AgingBucket,
  type AgingEntry,
} from '@/server/domain/aging';
import { normalBalanceOf } from '@/server/domain/account';
import { accounts, organizations, postings, transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { toMoneyDto } from './serialize';
import type { MoneyDto } from './dto';

/**
 * Who owes what, and for how long.
 *
 * Built from the postings, like everything else here — there is no separate
 * receivables ledger to fall out of step with the accounts. What the domain
 * adds is the settlement convention: nothing records which invoice a payment
 * cleared, so the oldest open item is taken first. See `domain/aging.ts`.
 */

export type AgedItem = {
  readonly id: string;
  readonly occurredAt: Date;
  readonly description: string;
  readonly reference: string | null;
  readonly outstanding: MoneyDto;
  readonly ageDays: number;
  readonly bucket: AgingBucket;
};

export type AgedAccount = {
  readonly accountId: string;
  readonly accountName: string;
  readonly accountCode: string | null;
  readonly currency: CurrencyCode;
  readonly total: MoneyDto;
  readonly byBucket: Readonly<Record<AgingBucket, MoneyDto>>;
  readonly overdueBasisPoints: number;
  readonly items: readonly AgedItem[];
};

export type AgedReport = {
  readonly asOf: Date;
  readonly accounts: readonly AgedAccount[];
  /** Totals across accounts, in the functional currency. */
  readonly byBucket: Readonly<Record<AgingBucket, MoneyDto>>;
  readonly total: MoneyDto;
};

export function createAgingService(database: Database, orgId: string) {
  return {
    /**
     * Receivables, payables, or both.
     *
     * `asset` ages what customers owe and `liability` what is owed to
     * suppliers; the sign convention is the only difference and the domain
     * takes it as an argument rather than having two copies.
     */
    async report(type: 'asset' | 'liability', asOf: Date = new Date()): Promise<AgedReport> {
      return withTenant(database, orgId, async (tx) => {
        const functional = await functionalCurrency(tx, orgId);

        // Only accounts managed as open items. `monetary` cannot do this job:
        // a bank account is a monetary asset with a balance exactly like a
        // receivable, and ageing it produces a confident, meaningless table.
        // See the note on `accounts.openItems`.
        const candidates = await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            code: accounts.code,
            currency: accounts.currency,
            type: accounts.type,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.type, type),
              eq(accounts.openItems, true),
              eq(accounts.status, 'open'),
              // An account nobody has posted to has nothing to age, and
              // listing it would bury the two that matter.
              sql`${accounts.balanceMinor} <> 0`,
            ),
          )
          .orderBy(accounts.code, accounts.name);

        const aged: AgedAccount[] = [];

        for (const account of candidates) {
          const rows = await tx
            .select({
              id: postings.transactionId,
              occurredAt: transactions.occurredAt,
              amount: postings.amountMinor,
              description: transactions.description,
              metadata: transactions.metadata,
            })
            .from(postings)
            .innerJoin(transactions, eq(transactions.id, postings.transactionId))
            .where(
              and(
                eq(postings.accountId, account.id),
                // Pending entries reserve funds without moving them; nobody
                // owes anything on an invoice that has not been raised.
                eq(transactions.status, 'posted'),
              ),
            )
            .orderBy(asc(transactions.occurredAt), asc(postings.id));

          const entries = rows.map((row): AgingEntry => ({
            id: row.id,
            occurredAt: row.occurredAt,
            amount: row.amount,
            description: row.description,
            reference: row.metadata['invoice'] ?? row.metadata['reference'] ?? null,
          }));

          const aging = ageAccount(entries, asOf, normalBalanceOf(type));
          if (aging.items.length === 0) continue;

          const currency = account.currency as CurrencyCode;
          aged.push({
            accountId: account.id,
            accountName: account.name,
            accountCode: account.code,
            currency,
            total: toMoneyDto(aging.total as MinorUnits, currency),
            byBucket: bucketsAsMoney(aging, currency),
            overdueBasisPoints: aging.overdueBasisPoints,
            items: aging.items.map((item): AgedItem => ({
              id: item.id,
              occurredAt: item.occurredAt,
              description: item.description,
              reference: item.reference,
              outstanding: toMoneyDto(item.outstanding as MinorUnits, currency),
              ageDays: item.ageDays,
              bucket: item.bucket,
            })),
          });
        }

        // Cross-account totals are deliberately absent for now: adding a
        // dollar receivable to a dong one needs each open item converted at
        // the rate on its own day, and a total that silently used today's
        // would be wrong in a way nobody could see. Each account totals in
        // its own currency, which is always true.
        const zero = toMoneyDto(0n as MinorUnits, functional);
        return {
          asOf,
          accounts: aged,
          byBucket: Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, zero])) as Record<
            AgingBucket,
            MoneyDto
          >,
          total: zero,
        };
      });
    },
  };
}

export type AgingService = ReturnType<typeof createAgingService>;

function bucketsAsMoney(aging: Aging, currency: CurrencyCode): Record<AgingBucket, MoneyDto> {
  return Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [
      bucket,
      toMoneyDto((aging.byBucket[bucket] ?? 0n) as MinorUnits, currency),
    ]),
  ) as Record<AgingBucket, MoneyDto>;
}

async function functionalCurrency(tx: Transactional, orgId: string): Promise<CurrencyCode> {
  const [row] = await tx
    .select({ currency: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return (row?.currency ?? 'USD') as CurrencyCode;
}

import { and, desc, eq, lte } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { parseRate } from '@/lib/fx';
import type { CurrencyCode } from '@/lib/money';
import type { LedgerError } from '@/server/domain/errors';
import { exchangeRates } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';

/**
 * Exchange rates, as point-in-time facts.
 *
 * Never updated. A rate that changes is a new row with a later `as_of`, and a
 * lookup asks for the most recent one *at or before* a given date — so
 * re-running last quarter's reports uses last quarter's rates. That is the
 * only way a restated figure can be explained to the person who signed the
 * original.
 *
 * The consequence worth naming: recording today's rate does not change
 * yesterday's numbers, and nothing here ever rewrites a posting. A
 * retranslation is a new entry, which is what makes the movement visible
 * rather than silent.
 */

export type RateDto = {
  readonly id: string;
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: string;
  readonly asOf: string;
  readonly source: string;
};

export function createRateService(database: Database, orgId: string) {
  return {
    /** Records a rate. Re-recording the same pair, day and source replaces it. */
    async record(input: {
      base: CurrencyCode;
      quote: CurrencyCode;
      rate: string;
      asOf: string;
      source?: string;
    }): Promise<Result<RateDto, LedgerError>> {
      if (input.base === input.quote) {
        return err({ code: 'invalid_fx_rate', accountId: '', rate: input.rate });
      }
      if (typeof parseRate(input.rate) !== 'bigint') {
        return err({ code: 'invalid_fx_rate', accountId: '', rate: input.rate });
      }

      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .insert(exchangeRates)
          .values({
            id: newId('rate'),
            orgId,
            baseCurrency: input.base,
            quoteCurrency: input.quote,
            rate: input.rate,
            asOf: input.asOf,
            source: input.source ?? 'manual',
          })
          // A correction to today's rate from the same source is a correction,
          // not a second opinion — two rows claiming different rates for the
          // same pair, day and source would make every lookup arbitrary.
          .onConflictDoUpdate({
            target: [
              exchangeRates.orgId,
              exchangeRates.baseCurrency,
              exchangeRates.quoteCurrency,
              exchangeRates.asOf,
              exchangeRates.source,
            ],
            set: { rate: input.rate },
          })
          .returning();

        if (!row) throw new Error('INSERT ... RETURNING produced no rate row');
        return ok(toDto(row));
      });
    },

    async list(limit = 100): Promise<RateDto[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(exchangeRates)
          .orderBy(desc(exchangeRates.asOf), desc(exchangeRates.createdAt))
          .limit(Math.min(Math.max(limit, 1), 500));
        return rows.map(toDto);
      });
    },

    /** The rate that applied on a date: the most recent at or before it. */
    async on(
      base: CurrencyCode,
      quote: CurrencyCode,
      asOf: string,
    ): Promise<Result<string, LedgerError>> {
      return withTenant(database, orgId, async (tx) => rateOn(tx, orgId, base, quote, asOf));
    },
  };
}

/**
 * Rate lookup against an open transaction.
 *
 * Exported so the revaluation can read rates inside the same transaction it
 * writes the entry in — a service built on the pool would open a second
 * connection and wait on locks the first is holding.
 */
export async function rateOn(
  tx: Transactional,
  orgId: string,
  base: CurrencyCode,
  quote: CurrencyCode,
  asOf: string,
): Promise<Result<string, LedgerError>> {
  if (base === quote) return ok('1');

  const [row] = await tx
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.orgId, orgId),
        eq(exchangeRates.baseCurrency, base),
        eq(exchangeRates.quoteCurrency, quote),
        lte(exchangeRates.asOf, asOf),
      ),
    )
    // Most recent first. The index is (org, base, quote, as_of DESC), so this
    // is a backwards walk of exactly that key rather than a sort.
    .orderBy(desc(exchangeRates.asOf))
    .limit(1);

  return row ? ok(trimRate(row.rate)) : err({ code: 'rate_not_found', base, quote });
}

/**
 * `numeric(20, 10)` comes back padded — 25470.5 as "25470.5000000000".
 *
 * Trimmed wherever a rate leaves the database rather than at each call site,
 * because the padding is a storage detail and a caller comparing against
 * "25470.5" is not wrong to.
 */
export function trimRate(rate: string): string {
  return String(rate)
    .replace(/(\.\d*?)0+$/u, '$1')
    .replace(/\.$/u, '');
}

function toDto(row: typeof exchangeRates.$inferSelect): RateDto {
  return {
    id: row.id,
    base: row.baseCurrency as CurrencyCode,
    quote: row.quoteCurrency as CurrencyCode,
    // Trimmed of the zeros `numeric(20, 10)` pads with, so 25470.5 reads as
    // itself rather than as 25470.5000000000.
    rate: trimRate(row.rate),
    asOf: row.asOf,
    source: row.source,
  };
}

export type RateService = ReturnType<typeof createRateService>;

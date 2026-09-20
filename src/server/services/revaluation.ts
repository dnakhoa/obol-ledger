import { and, eq, ne, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { ledgerMessages, type Locale } from '@/lib/i18n';
import type { LedgerError } from '@/server/domain/errors';
import { endOfMonth, isClosable } from '@/server/domain/period';
import { accountingPeriods, accounts, organizations } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createJournalService } from './journal';
import { rateOn } from './rates';
import type { TransactionDto } from './dto';

/**
 * Retranslating what you still hold.
 *
 * Realized gain and loss answers "the rate moved between booking and paying".
 * This answers the other half: the rate moved and you have *not* paid. A
 * 40,000 USD payable on a dong ledger is worth a different number of dong at
 * month end than when it was booked, and that difference is real whether or
 * not anyone has settled anything.
 *
 * ## The shape of the entry
 *
 * A retranslation moves no foreign currency. The dollars in the bank are the
 * same dollars; only their worth in dong changed. So each leg carries
 * `amount = 0` and a non-zero base amount — a posting shape the ordinary sign
 * check forbade until migration 0015, and one that has a name: a
 * remeasurement.
 *
 * The offsetting leg is the FX gain/loss account, in the functional currency,
 * so the entry balances in base like every other entry.
 *
 * ## Cumulative, not reversing
 *
 * The carrying amount genuinely changes. IAS 21 *remeasures* the item; it does
 * not post a memo that is unwound on the first of the next month. So the entry
 * stands, and the next period's revaluation computes the difference between
 * what the balance is now worth and what it is currently carried at — which
 * needs no memory of the previous adjustment beyond the balance itself.
 *
 * The reversing alternative is common in systems that revalue only for
 * reporting, and it has one real advantage: the ledger keeps historical rates,
 * so a trial balance mid-period is unpolluted by an adjustment that has not
 * been realised. It was rejected because the balance sheet is then wrong
 * between the first of the month and the close, and a balance sheet that is
 * only right on one day of the month is a balance sheet people stop trusting.
 */

export type RevaluationLine = {
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: CurrencyCode;
  /** The foreign balance being retranslated. */
  readonly balanceMinor: string;
  /** What it is currently carried at, in the functional currency. */
  readonly carriedMinor: string;
  /** What it is worth at the closing rate. */
  readonly retranslatedMinor: string;
  readonly rate: string;
  /** Positive is a gain. */
  readonly differenceMinor: string;
};

export type RevaluationResult = {
  readonly periodMonth: string;
  readonly lines: readonly RevaluationLine[];
  readonly entry: TransactionDto | null;
};

export function createRevaluationService(database: Database, orgId: string) {
  return {
    /**
     * What a revaluation would post, without posting it.
     *
     * Separate from doing it because an accountant reviews the adjustment
     * before sealing a month, and because a preview that runs the same code
     * as the real thing is the only kind worth having.
     */
    async preview(periodMonth: string): Promise<Result<RevaluationResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const lines = await computeLines(tx, orgId, periodMonth);
        return lines.ok ? ok({ periodMonth, lines: lines.value, entry: null }) : lines;
      });
    },

    /**
     * Posts the retranslation for a month.
     *
     * Idempotent in the sense that matters: running it twice computes the
     * second difference from the already-adjusted carrying amount, which is
     * zero, so the second run posts nothing.
     */
    async revalue(
      periodMonth: string,
      now: Date = new Date(),
    ): Promise<Result<RevaluationResult, LedgerError>> {
      if (!isClosable(periodMonth, now)) {
        return err({ code: 'period_not_finished', periodMonth });
      }

      return withTenant(database, orgId, async (tx) => {
        const [period] = await tx
          .select()
          .from(accountingPeriods)
          .where(eq(accountingPeriods.periodMonth, periodMonth))
          .limit(1);
        if (period?.status === 'closed') {
          return err({ code: 'period_already_closed', periodMonth });
        }

        const computed = await computeLines(tx, orgId, periodMonth);
        if (!computed.ok) return computed;

        const lines = computed.value.filter((line) => line.differenceMinor !== '0');
        if (lines.length === 0) {
          // Nothing moved, or nothing foreign is held. The period is still
          // marked as revalued: "we looked and there was nothing" is a
          // different state from "nobody looked", and the close gate needs to
          // tell them apart.
          await markRevalued(tx, orgId, periodMonth, period?.id, now, null);
          return ok({ periodMonth, lines: computed.value, entry: null });
        }

        const fx = await fxAccount(tx);
        if (!fx) return err({ code: 'fx_account_missing' });

        const functional = await functionalCurrency(tx, orgId);

        const total = lines.reduce((sum, line) => sum + BigInt(line.differenceMinor), 0n);

        const entry = await createJournalService(tx, orgId).postEntry({
          description: ledgerMessages(await booksLocale(tx, orgId)).revaluation(
            periodMonth.slice(0, 7),
          ),
          // The journal resolves the entry's currency to the organisation's
          // functional one regardless; this is what it will be.
          currency: functional,
          occurredAt: endOfMonth(periodMonth),
          metadata: { revaluedPeriod: periodMonth.slice(0, 7) },
          postings: [
            ...lines.map((line) => ({
              accountId: line.accountId,
              // No currency moved: this is a remeasurement, not a payment.
              amount: 0n as MinorUnits,
              baseAmount: BigInt(line.differenceMinor) as MinorUnits,
              fxRate: line.rate,
            })),
            {
              accountId: fx.id,
              amount: -total as MinorUnits,
              baseAmount: -total as MinorUnits,
              fxRate: '1',
            },
          ],
        });
        if (!entry.ok) return entry;

        await markRevalued(tx, orgId, periodMonth, period?.id, now, entry.value.transaction.id);
        return ok({ periodMonth, lines, entry: entry.value.transaction });
      });
    },
  };

  /** The language the books are kept in; see `docs/adr/0014-two-locales.md`. */
  async function booksLocale(handle: Transactional, organizationId: string): Promise<Locale> {
    const [row] = await handle
      .select({ locale: organizations.locale })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return row?.locale ?? 'en';
  }

  async function functionalCurrency(
    handle: Transactional,
    organizationId: string,
  ): Promise<CurrencyCode> {
    const [row] = await handle
      .select({ currency: organizations.functionalCurrency })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return (row?.currency ?? 'USD') as CurrencyCode;
  }

  async function fxAccount(tx: Transactional): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.role, 'fx_gain_loss'))
      .limit(1);
    return row;
  }
}

/**
 * What each foreign monetary balance is worth at the closing rate, against
 * what it is carried at.
 *
 * Only assets and liabilities, only where the account's currency differs from
 * the functional one, and only where the account is marked monetary — IAS 21's
 * distinction, and the one this model's five account types cannot make.
 * Inventory bought in dollars stays at the rate it was bought at while the
 * payable it created moves every month end, which is one transaction with two
 * treatments.
 */
async function computeLines(
  tx: Transactional,
  orgId: string,
  periodMonth: string,
): Promise<Result<RevaluationLine[], LedgerError>> {
  const [org] = await tx
    .select({ functional: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const functional = (org?.functional ?? 'USD') as CurrencyCode;

  const rows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      currency: accounts.currency,
      balance: accounts.balanceMinor,
      base: accounts.baseBalanceMinor,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.monetary, true),
        ne(accounts.currency, functional),
        sql`${accounts.type} in ('asset', 'liability')`,
      ),
    )
    .orderBy(accounts.code, accounts.name);

  // The closing rate is the one in force on the last day of the month, which
  // is the most recent recorded at or before it — not today's.
  const asOf = endOfMonth(periodMonth).toISOString().slice(0, 10);
  const lines: RevaluationLine[] = [];

  for (const row of rows) {
    if (row.balance === 0n) continue;

    const currency = row.currency as CurrencyCode;
    const rate = await rateOn(tx, orgId, currency, functional, asOf);
    if (!rate.ok) return rate;

    const parsed = parseRate(rate.value);
    if (typeof parsed !== 'bigint') {
      return err({ code: 'invalid_fx_rate', accountId: row.id, rate: rate.value });
    }

    const retranslated = convert({
      amount: row.balance as MinorUnits,
      from: currency,
      to: functional,
      rate: parsed,
    });

    lines.push({
      accountId: row.id,
      accountName: row.name,
      currency,
      balanceMinor: String(row.balance),
      carriedMinor: String(row.base),
      retranslatedMinor: String(retranslated),
      rate: rate.value,
      differenceMinor: String(BigInt(retranslated) - BigInt(row.base)),
    });
  }

  return ok(lines);
}

async function markRevalued(
  tx: Transactional,
  orgId: string,
  periodMonth: string,
  periodId: string | undefined,
  now: Date,
  transactionId: string | null,
): Promise<void> {
  const values = { revaluedAt: now, revaluationTransactionId: transactionId };

  if (periodId) {
    await tx.update(accountingPeriods).set(values).where(eq(accountingPeriods.id, periodId));
    return;
  }

  await tx.insert(accountingPeriods).values({
    id: newId('period'),
    orgId,
    periodMonth,
    ...values,
  });
}

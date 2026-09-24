import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import type { DraftPosting } from '@/server/domain/transaction';
import type { LedgerError } from '@/server/domain/errors';
import { accounts } from '@/server/db/schema';
import type { Transactional } from '@/server/db/types';

/**
 * The leg an invoice leaves with the person on the other side of it.
 *
 * Stock, freight and a sale are each generated from one amount in one currency
 * — what the supplier billed, or what the customer was charged — and each
 * posts that amount against somebody: a payable, a receivable, a bank. The
 * stock and revenue legs are always in the books' own currency, and so is the
 * functional value every leg carries. The counterparty leg is the one that
 * cannot assume it.
 *
 * An importer who owes an Italian supplier in dollars keeps the payable in
 * dollars, because that is what is owed and because IAS 21 retranslates it
 * every month end. Writing the dong figure into that account records 10.16
 * million dollars owed on a forty-thousand-dollar invoice — and nothing
 * objects, because the entry balances in dong. It shipped that way; see
 * `tests/integration/foreign-supplier.test.ts`.
 *
 * So the leg takes the account's own currency:
 *
 *  - **the functional currency** — the invoice's value on the day, which is
 *    what a business that settles foreign bills in dong wants;
 *  - **the invoice's currency** — the invoiced amount itself, carrying its
 *    functional value at the rate used for the rest of the entry, so the
 *    settlement and the revaluation both start from the booked rate;
 *  - **anything else** — refused. A euro payable against a dollar invoice
 *    needs a cross rate nobody supplied, and guessing one produces a balance
 *    that is owed to nobody.
 */
export async function counterpartyLeg(
  tx: Transactional,
  accountId: string,
  invoiced: { readonly amount: bigint; readonly currency: CurrencyCode },
  functional: {
    readonly amount: bigint;
    readonly rate: string;
    readonly currency: CurrencyCode;
  },
  /** `-1n` credits the account (a payable, a bank paying out); `1n` debits it. */
  sign: 1n | -1n,
): Promise<Result<DraftPosting, LedgerError>> {
  const [account] = await tx
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return err({ code: 'account_not_found', accountId });

  const base = (functional.amount * sign) as MinorUnits;

  if (account.currency === functional.currency) {
    return ok({ accountId, amount: base, baseAmount: base, fxRate: '1' });
  }

  if (account.currency === invoiced.currency) {
    return ok({
      accountId,
      amount: (invoiced.amount * sign) as MinorUnits,
      baseAmount: base,
      fxRate: functional.rate,
    });
  }

  return err({
    code: 'currency_mismatch',
    expected: account.currency as CurrencyCode,
    received: invoiced.currency,
    accountId,
  });
}

import type { CurrencyCode, MinorUnits } from '@/lib/money';
import type { DraftPosting } from '@/server/domain/transaction';
import { toSignedMinorUnits, type CreateEntryBody } from './schemas';

/**
 * Turns a validated request body into domain postings.
 *
 * zod can prove `"1.5"` is a decimal string, but not that it is a legal amount
 * in JPY — that depends on the sibling `currency` field and on the exponent
 * registry. This is the one place where the two are brought together, and it
 * reports *which* posting was wrong rather than failing the whole body.
 */
export type PostingConversion =
  | { readonly ok: true; readonly postings: DraftPosting[] }
  | { readonly ok: false; readonly index: number; readonly amount: string };

export function toDraftPostings(
  body: Pick<CreateEntryBody, 'postings'>,
  currency: CurrencyCode,
): PostingConversion {
  const postings: DraftPosting[] = [];

  for (const [index, posting] of body.postings.entries()) {
    /*
     * The decimal is carried, not judged.
     *
     * Scaling needs the currency's exponent, and a posting's currency is its
     * *account's* — which this layer does not know without a database read it
     * avoids before opening a transaction. Judging "1000.00" against the
     * entry's currency would reject a perfectly good dollar posting on a
     * dong-denominated ledger, because VND has no minor unit.
     *
     * A provisional scaling is attempted anyway, so a single-currency entry
     * behaves exactly as it always did; the service redoes it against the
     * account row and is the authority.
     */
    const amount = toSignedMinorUnits(posting.amount, posting.direction, currency);

    const baseAmount =
      posting.baseAmount === undefined
        ? undefined
        : toSignedMinorUnits(posting.baseAmount, posting.direction, currency);
    // A base amount *is* in the functional currency, which is the entry's, so
    // this one is judged here — there is no account row that could change it.
    if (posting.baseAmount !== undefined && baseAmount === undefined) {
      return { ok: false, index, amount: posting.baseAmount };
    }

    postings.push({
      accountId: posting.accountId,
      ...(amount === undefined ? {} : { amount }),
      amountDecimal: posting.amount,
      direction: posting.direction,
      ...(baseAmount === undefined ? {} : { baseAmount }),
      ...(posting.fxRate === undefined ? {} : { fxRate: posting.fxRate }),
    });
  }

  return { ok: true, postings };
}

export function signedAmount(
  amount: string,
  direction: 'debit' | 'credit',
  currency: CurrencyCode,
): MinorUnits | undefined {
  return toSignedMinorUnits(amount, direction, currency);
}

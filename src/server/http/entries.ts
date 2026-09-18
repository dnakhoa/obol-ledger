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
    const amount = toSignedMinorUnits(posting.amount, posting.direction, currency);
    if (amount === undefined) return { ok: false, index, amount: posting.amount };
    postings.push({ accountId: posting.accountId, amount });
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

import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/server/domain/account';
import {
  parseDecimal,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
  type MinorUnits,
} from '@/lib/money';
import { ID_PREFIXES } from '@/lib/id';

/**
 * Request schemas.
 *
 * Two decisions shape everything here.
 *
 * Amounts arrive as **strings**. A JSON number is an IEEE-754 double, so
 * `12.10` is already `12.099999999999999` by the time it reaches the server and
 * no amount of care afterwards recovers the lost cent. A string is exact, and
 * parsing it against the currency's exponent is what rejects `1.5 JPY`.
 *
 * Postings carry an explicit **direction** rather than a signed amount. That is
 * how an accountant writes an entry, it makes `-` typos impossible to
 * misinterpret, and the mapping to the signed representation used in storage
 * happens once, here.
 */

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

export const accountIdSchema = z
  .string()
  .regex(new RegExp(`^${ID_PREFIXES.account}_[0-9A-HJKMNP-TV-Z]{26}$`, 'u'), {
    message: 'Expected an account id of the form acct_<26 characters>',
  });

const decimalAmountSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^\d+(\.\d+)?$/u, { message: 'Expected a non-negative decimal amount, e.g. "12.50"' });

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencySchema,
  overdraftAllowed: z.boolean().default(false),
});

export type CreateAccountBody = z.infer<typeof createAccountSchema>;

const postingSchema = z.object({
  accountId: accountIdSchema,
  direction: z.enum(['debit', 'credit']),
  amount: decimalAmountSchema,
});

export const createEntrySchema = z.object({
  description: z.string().trim().min(1).max(280),
  currency: currencySchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  postings: z.array(postingSchema).min(2).max(64),
});

export type CreateEntryBody = z.infer<typeof createEntrySchema>;

export const createTransferSchema = z.object({
  description: z.string().trim().min(1).max(280),
  currency: currencySchema,
  fromAccountId: accountIdSchema,
  toAccountId: accountIdSchema,
  amount: decimalAmountSchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export type CreateTransferBody = z.infer<typeof createTransferSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Cursors are base64url of `<timestamp>|<id>`; 256 leaves headroom without
  // accepting an unbounded string from a query parameter.
  cursor: z.string().min(1).max(256).optional(),
  // Which side of the cursor to read. Ignored without one — there is nothing
  // before the first page.
  direction: z.enum(['forward', 'backward']).default('forward'),
});

/**
 * Converts a validated decimal string into signed minor units.
 *
 * Returns `undefined` when the string has more decimal places than the currency
 * allows — a rule zod cannot express on its own, because it depends on a
 * sibling field.
 */
export function toSignedMinorUnits(
  amount: string,
  direction: 'debit' | 'credit',
  currency: CurrencyCode,
): MinorUnits | undefined {
  const parsed = parseDecimal(amount, currency);
  if (!parsed.ok) return undefined;
  return (direction === 'debit' ? parsed.value : -parsed.value) as MinorUnits;
}

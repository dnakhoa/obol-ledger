import { z } from 'zod';
import { ACCOUNT_TYPES } from '@/server/domain/account';
import { COSTING_METHODS, WRITE_OFF_REASONS } from '@/server/domain/costing';
import { WEBHOOK_EVENT_TYPES } from '@/server/domain/webhook';
import {
  parseDecimal,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
  type MinorUnits,
} from '@/lib/money';
import { MAX_PRECISION, SUPPORTED_UNITS } from '@/lib/quantity';
import { ID_PREFIXES, type EntityKind } from '@/lib/id';

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

/**
 * Caller-supplied annotation.
 *
 * String values only, and that is a deliberate refusal rather than laziness.
 * Allowing nested objects turns the column into a document store that every
 * balance query has to read past; allowing numbers reintroduces the float
 * problem this codebase spends a whole ADR avoiding, on a field nobody
 * validates. A caller who needs `{"amount": 12.10}` needs a posting.
 */
export const metadataSchema = z
  .record(z.string().min(1).max(64), z.string().max(500))
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'At most 20 metadata keys',
  })
  .default({});

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencySchema,
  overdraftAllowed: z.boolean().default(false),
  metadata: metadataSchema,
  /**
   * The number the account is filed under. Required on a statutory chart —
   * under Thông tư 200 the leading digit is the class — and optional elsewhere.
   */
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{1,10}$/u, 'An account code is up to ten digits')
    .optional(),
  /** A receivable or payable whose balance is a set of unsettled invoices, and so ages. */
  openItems: z.boolean().optional(),
  /** Days the customer or supplier has to pay. Only on an open-item account. */
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
});

export type CreateAccountBody = z.infer<typeof createAccountSchema>;

/** A rate as a decimal string: ten places, matching `numeric(20, 10)`. */
const fxRateSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,10})?$/u, { message: 'Expected a positive decimal with up to 10 places' });

const postingSchema = z.object({
  accountId: accountIdSchema,
  direction: z.enum(['debit', 'credit']),
  /** In the *account's* currency, which need not be the entry's. */
  amount: decimalAmountSchema,
  /**
   * What this posting was worth in the organisation's functional currency.
   *
   * Required for a posting on a foreign account unless `fxRate` is given.
   * Supplying it rather than a rate is how a caller keeps ownership of the
   * rounding — see `docs/adr/0010-multi-currency.md`.
   */
  baseAmount: decimalAmountSchema.optional(),
  /** Converted with, when `baseAmount` is absent. Ten decimal places. */
  fxRate: fxRateSchema.optional(),
});

export const createEntrySchema = z.object({
  description: z.string().trim().min(1).max(280),
  currency: currencySchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  postings: z.array(postingSchema).min(2).max(64),
  /**
   * Absorb a functional-currency difference into the FX gain/loss account.
   *
   * Only legal when the entry already balances within every transaction
   * currency — otherwise the adjustment would hide a mistyped amount, which
   * is the failure mode that makes automatic plugs untrustworthy.
   */
  fxAdjustment: z.boolean().default(false),
  /**
   * `pending` reserves the funds without moving them — an authorisation.
   * `posted` settles immediately. Defaults to posted so an ordinary transfer
   * needs no ceremony.
   */
  status: z.enum(['pending', 'posted']).default('posted'),
  /**
   * Optimistic concurrency: `{ "acct_…": 7 }` applies the entry only if each
   * named account is still at that version. Lets a caller read a balance,
   * decide on it, and commit without holding a lock across the round trip.
   */
  expectedVersions: z.record(accountIdSchema, z.number().int().min(0)).optional(),
  metadata: metadataSchema,
});

export type CreateEntryBody = z.infer<typeof createEntrySchema>;

export const createTransferSchema = z.object({
  description: z.string().trim().min(1).max(280),
  currency: currencySchema,
  fromAccountId: accountIdSchema,
  toAccountId: accountIdSchema,
  amount: decimalAmountSchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  metadata: metadataSchema,
});

export type CreateTransferBody = z.infer<typeof createTransferSchema>;

/**
 * `?format=csv` turns a listing into a download.
 *
 * A query parameter rather than content negotiation on `Accept`, because the
 * consumer is a link in a page. A browser sends its own `Accept` header on a
 * plain navigation and the person clicking cannot change it, so an
 * `Accept`-only design is one that works from curl and not from the product.
 */
export const formatSchema = z.enum(['json', 'csv']).default('json');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  // Cursors are base64url of `<timestamp>|<id>`; 256 leaves headroom without
  // accepting an unbounded string from a query parameter.
  cursor: z.string().min(1).max(256).optional(),
  // Which side of the cursor to read. Ignored without one — there is nothing
  // before the first page.
  direction: z.enum(['forward', 'backward']).default('forward'),
  format: formatSchema,
});

/**
 * Journal listing: pagination plus filters.
 *
 * A separate schema rather than optional fields on `paginationSchema`, because
 * the filters only mean something here. Keeping them off the shared schema is
 * also what stops the accounts statement quietly accepting a `search` it would
 * then ignore — zod strips unknown keys without complaint, so a filter sent to
 * the wrong endpoint disappears rather than failing.
 */
export const journalQuerySchema = paginationSchema.extend({
  accountId: accountIdSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['pending', 'posted', 'archived']).optional(),
  /**
   * `?metadataKey=invoice&metadataValue=INV-42`.
   *
   * Two flat parameters rather than the bracket syntax some APIs use
   * (`?metadata[invoice]=INV-42`), because bracket parsing is where query
   * strings grow ambiguity: a caller sending `metadata[a][b]` has a reasonable
   * expectation nothing here would honour. One pair is what the GIN index
   * answers efficiently, and it is the query people actually issue — find the
   * entry for this reference.
   */
  metadataKey: z.string().trim().min(1).max(64).optional(),
  metadataValue: z.string().trim().max(500).optional(),
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

/**
 * Webhook endpoint registration.
 *
 * `https` is required by the schema, by a CHECK constraint, and again by the
 * dispatcher. That looks like belt and braces until you notice each one covers
 * a different way in: the schema catches the API caller, the constraint
 * catches anything that writes the row another way, and the dispatcher catches
 * a row that was already there when the rule changed.
 *
 * An empty `eventTypes` means every type — the right default for a subscriber
 * that has not thought about it yet, because missing an event is worse than
 * receiving one you ignore.
 */
export const createEndpointSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => URL.canParse(value) && new URL(value).protocol === 'https:', {
      message: 'Expected an https:// URL',
    }),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).max(WEBHOOK_EVENT_TYPES.length).default([]),
});

export type CreateEndpointBody = z.infer<typeof createEndpointSchema>;

export const updateEndpointSchema = z.object({ enabled: z.boolean() });

export const deliveryQuerySchema = z.object({
  endpointId: z.string().trim().optional(),
  status: z.enum(['pending', 'delivering', 'succeeded', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** `2026-01`. A period is a month, so its name is a month. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/u, { message: 'Expected a month as YYYY-MM' });

export const recordRateSchema = z.object({
  base: currencySchema,
  quote: currencySchema,
  /** Ten decimal places, matching `numeric(20, 10)`. Never a JSON number. */
  rate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,10})?$/u, { message: 'Expected a positive decimal with up to 10 places' }),
  /** The date this rate was in force, as YYYY-MM-DD. */
  asOf: z.iso.date(),
  source: z.string().trim().min(1).max(60).default('manual'),
});

/** An id of the given kind: `item_…`, `layer_…`. Refused before any query runs. */
function idOf(kind: EntityKind) {
  const prefix = ID_PREFIXES[kind];
  return z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`, 'u'), {
    message: `Expected an id of the form ${prefix}_<26 characters>`,
  });
}

/**
 * A quantity, as a decimal string.
 *
 * Only the shape is checked here. How many places are allowed is a property
 * of the *item* — 24.687 tonnes is fine, 1.5 slabs is not — so the scaling
 * happens in the handler once the item has been read, the same way an amount
 * waits for its currency.
 */
const quantitySchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^\d+(\.\d+)?$/u, { message: 'Expected a non-negative decimal quantity, e.g. "24.687"' });

/** Container number, supplier invoice, stocktake sheet — what somebody will search for. */
const stockReferenceSchema = z.string().trim().min(1).max(60);

export const createItemSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  unit: z.enum(SUPPORTED_UNITS),
  /** Decimal places a quantity of this item is counted to. Defaults to the unit's usual one. */
  quantityPrecision: z.number().int().min(0).max(MAX_PRECISION).optional(),
  inventoryAccountId: accountIdSchema,
  cogsAccountId: accountIdSchema,
  /** Absent inherits the organisation's method, and follows it if that changes. */
  costingMethod: z.enum(COSTING_METHODS).optional(),
  metadata: metadataSchema,
});

export const receiveStockSchema = z.object({
  quantity: quantitySchema,
  /** What was paid for the whole delivery, in `currency`. */
  cost: decimalAmountSchema,
  currency: currencySchema,
  /** A payable for stock bought on terms, the bank for cash. */
  creditAccountId: accountIdSchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  reference: stockReferenceSchema.optional(),
  description: z.string().trim().min(1).max(280).optional(),
  /** Lets freight and duty that arrive later find this lot. */
  shipmentId: idOf('shipment').optional(),
  /**
   * Whole grams, as a string: a container of granite is 2.4 × 10^7 of them
   * and a weight is apportioned against, so it is kept exact like a quantity.
   */
  weightGrams: z
    .string()
    .trim()
    .regex(/^\d{1,15}$/u, { message: 'Expected whole grams as a string, e.g. "24000000"' })
    .optional(),
  metadata: metadataSchema,
});

export const issueStockSchema = z.object({
  quantity: quantitySchema,
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  /** Required when the item is costed by specific identification. */
  layerId: idOf('costLayer').optional(),
  reference: stockReferenceSchema.optional(),
  description: z.string().trim().min(1).max(280).optional(),
  metadata: metadataSchema,
});

export const writeOffStockSchema = issueStockSchema.extend({
  reason: z.enum(WRITE_OFF_REASONS),
  /** Where the loss is recognised: shrinkage, breakage, obsolescence. Not cost of sales. */
  expenseAccountId: accountIdSchema,
});

export const createSaleSchema = z.object({
  /** The invoice number. Unique, because a customer pays against it. */
  reference: stockReferenceSchema,
  /** The customer's receivable, or a bank account for a cash sale. */
  customerAccountId: accountIdSchema,
  revenueAccountId: accountIdSchema,
  /** What the invoice is in; every line amount is in it too. */
  currency: currencySchema,
  taxCodeId: idOf('taxCode').optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  /** When the customer agreed to pay. Absent means on receipt. */
  dueOn: z.iso.date().optional(),
  description: z.string().trim().min(1).max(280).optional(),
  lines: z
    .array(
      z.object({
        itemId: idOf('inventoryItem'),
        /** In the item's own unit, to no more places than it is counted to. */
        quantity: quantitySchema,
        /**
         * The line's net total — not a unit price — in the invoice currency.
         * A total because that is what is printed on the invoice and what the
         * customer agreed to; a unit price times a quantity to three places is
         * a rounding decision this API would otherwise be making for them.
         */
        amount: decimalAmountSchema,
        layerId: idOf('costLayer').optional(),
      }),
    )
    .min(1)
    .max(100),
  metadata: metadataSchema,
});

export type CreateSaleBody = z.infer<typeof createSaleSchema>;

export const createCreditNoteSchema = z.object({
  /** The credit note's own number. Unique, like an invoice number. */
  reference: stockReferenceSchema,
  /** Where the revenue comes back out. The sale's revenue account when absent. */
  revenueAccountId: accountIdSchema.optional(),
  /** Printed on the credit note. */
  reason: z.string().trim().min(1).max(280).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  lines: z
    .array(
      z.object({
        /** The invoice line being corrected: its `movementId` on the sale. */
        saleMovementId: idOf('inventoryMovement'),
        /** Goods coming back, in the item's unit. "0" for a price allowance. */
        quantity: quantitySchema.default('0'),
        /** Net credited, in the invoice currency. A total, not a unit price. */
        amount: decimalAmountSchema.default('0'),
      }),
    )
    .min(1)
    .max(100),
  metadata: metadataSchema,
});

export const createSupplierReturnSchema = z.object({
  /** The delivery the goods go back from: a lot of this product. */
  layerId: idOf('costLayer'),
  /** How much goes back, in the item's unit. */
  quantity: quantitySchema,
  /** The debit note number, or the supplier's return authorisation. Unique. */
  reference: stockReferenceSchema,
  /**
   * What the supplier gives back, net, in the lot's currency. Its own price
   * for the goods when absent.
   */
  refund: decimalAmountSchema.optional(),
  /** Who gives it back. The account the delivery was credited to when absent. */
  counterpartyAccountId: accountIdSchema.optional(),
  /** Where unrefunded cost goes. The product's cost of sales when absent. */
  expenseAccountId: accountIdSchema.optional(),
  /** The purchase tax code to reverse, for a delivery bought in the books' currency. */
  taxCodeId: idOf('taxCode').optional(),
  reason: z.string().trim().min(1).max(280).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  metadata: metadataSchema,
});

/** Money in positive, money out negative, as the account sees it. */
const signedDecimalSchema = z
  .string()
  .trim()
  .min(1)
  .max(33)
  .regex(/^-?\d+(\.\d+)?$/u, { message: 'Expected a signed decimal amount, e.g. "-12.50"' });

export const bankFeedSchema = z.object({
  lines: z
    .array(
      z.object({
        /** The bank's own id for the transaction. Sending it again adds nothing. */
        id: z.string().trim().min(1).max(160),
        date: z.iso.date(),
        /** In the account's currency: money in positive, money out negative. */
        amount: signedDecimalSchema,
        description: z.string().trim().min(1).max(500),
        reference: z.string().trim().max(120).optional(),
        /** The bank's running balance after this line, when it reports one. */
        balance: signedDecimalSchema.optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const bankMatchSchema = z.object({
  /** A posting on the same account, from `GET /entries/{id}`. */
  postingId: z.string().trim().min(1).max(60),
});

export const bankRecordSchema = z.object({
  /** The other side of the entry: bank fees, interest income, a customer's receivable. */
  counterAccountId: accountIdSchema,
  description: z.string().trim().min(1).max(280).optional(),
});

export const salesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * `[from, to)`, as calendar days.
 *
 * Dates rather than timestamps because a margin is asked about a month or a
 * quarter, and a day boundary is what the question means. `to` is exclusive
 * so consecutive periods tile without a day counted twice.
 */
export const grossMarginQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from < value.to, {
    message: 'from must be before to, which is exclusive',
    path: ['from'],
  });

export const revaluationQuerySchema = z.object({
  /** Compute the adjustment without posting it. */
  preview: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

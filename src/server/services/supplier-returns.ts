import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import { ledgerMessages } from '@/lib/i18n';
import { minorUnits, toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import type { Unit } from '@/lib/quantity';
import { allocate } from '@/server/domain/costing';
import type { LedgerError } from '@/server/domain/errors';
import { supplierRefund } from '@/server/domain/supplier-return';
import type { DraftPosting } from '@/server/domain/transaction';
import {
  accounts,
  costLayers,
  inventoryItems,
  inventoryMovements,
  postings,
  supplierReturns,
  transactions,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { counterpartyLeg } from './counterparty';
import {
  costingRefusal,
  legs,
  load,
  methodFor,
  organisation,
  recordDraws,
  toCostLayer,
  vetAccount,
} from './inventory';
import { createJournalService } from './journal';
import { calculateTax, recordTaxEntries } from './tax';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Returns to a supplier: part of a delivery going back where it came from.
 *
 * One entry, and one movement out of the named lot:
 *
 * ```
 * Dr  Payable (supplier), or bank     what the supplier gives back, at the lot's rate
 * Dr  Expense                         carrying cost the refund does not cover
 *   Cr  Inventory                       what the lot carried the goods at
 *   Cr  Input tax                       the tax on the refund, when it had some
 * ```
 *
 * The goods leave at the lot's own carrying amount — freight and duty
 * included — because that is what the inventory account holds for them. The
 * supplier refunds its own price, never the forwarder's, so the landed cost
 * spent on goods that have gone back is a cost of the period: left in stock,
 * it would be carried by goods that are no longer there. See
 * `docs/adr/0023-supplier-returns.md`.
 */

export type ReturnToSupplierInput = {
  /** The delivery the goods go back from. */
  readonly layerId: string;
  /** Scaled by the item's precision. */
  readonly quantity: bigint;
  /** The debit note or the supplier's return authorisation. */
  readonly reference: string;
  /**
   * What the supplier gives back, net, in the lot's currency. Absent means its
   * own price for the goods: their share of what the delivery cost.
   */
  readonly refund?: bigint | undefined;
  /** Who gives it back. The account the delivery was credited to when absent. */
  readonly counterpartyAccountId?: string | undefined;
  /** Where unrefunded cost goes. The product's cost of sales when absent. */
  readonly expenseAccountId?: string | undefined;
  /** The purchase tax code the refund is reversed under, if it carried tax. */
  readonly taxCodeId?: string | undefined;
  readonly reason?: string | undefined;
  readonly occurredAt?: Date | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly actor?:
    | { readonly userId?: string | undefined; readonly via: 'ui' | 'api' | 'system' | 'import' }
    | undefined;
};

export type SupplierReturnSummary = {
  readonly id: string;
  readonly reference: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly unit: Unit;
  readonly quantityPrecision: number;
  readonly layerId: string;
  readonly layerReference: string | null;
  readonly counterpartyAccountId: string;
  readonly counterpartyName: string;
  readonly expenseAccountId: string | null;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly quantityMinor: string;
  /** Given back, in the lot's currency: net, the tax on it, and the two together. */
  readonly refund: MoneyDto;
  readonly tax: MoneyDto;
  readonly gross: MoneyDto;
  /** In the books' own currency: what the goods were carried at, and what nobody refunds. */
  readonly carrying: MoneyDto;
  readonly unrecovered: MoneyDto;
  readonly transactionId: string;
};

export type SupplierReturnResult = {
  readonly supplierReturn: SupplierReturnSummary;
  readonly entry: TransactionDto;
};

/** What can still go back from one delivery, for the form and the API. */
export type ReturnableLot = {
  readonly layerId: string;
  readonly itemId: string;
  readonly reference: string | null;
  readonly currency: CurrencyCode;
  /** Scaled by the item's precision. */
  readonly remainingQuantityMinor: string;
  /** What is left of the supplier's price, in the lot's currency: the default refund for all of it. */
  readonly remainingCostMinor: string;
  /** How much more the supplier can refund on this delivery, in the lot's currency. */
  readonly refundableMinor: string;
  /** The account the delivery was credited to — the supplier, usually. */
  readonly supplierAccountId: string | null;
  /** Whether freight, duty or other landed cost has been added to the lot. */
  readonly landed: boolean;
};

export function createSupplierReturnService(database: Database, orgId: string) {
  return {
    async returnToSupplier(
      input: ReturnToSupplierInput,
    ): Promise<Result<SupplierReturnResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [taken] = await tx
          .select({ id: supplierReturns.id })
          .from(supplierReturns)
          .where(eq(supplierReturns.reference, input.reference))
          .limit(1);
        if (taken) {
          return err({ code: 'supplier_return_reference_taken', reference: input.reference });
        }

        // Locked for the length of the transaction: a sale and a return
        // drawing on the last of one delivery queue here, and so do two
        // debit notes against it. The database checks the caps again under
        // the same lock.
        const [lot] = await tx
          .select()
          .from(costLayers)
          .where(eq(costLayers.id, input.layerId))
          .for('update')
          .limit(1);
        if (!lot) return err({ code: 'cost_layer_not_found', layerId: input.layerId });

        const item = await load(tx, lot.itemId);
        if (!item.ok) return item;

        const occurredAt = input.occurredAt ?? new Date();
        if (occurredAt < lot.acquiredAt) {
          return err({
            code: 'supplier_return_before_receipt',
            returnedOn: occurredAt.toISOString().slice(0, 10),
            receivedOn: lot.acquiredAt.toISOString().slice(0, 10),
          });
        }

        const org = await organisation(tx, orgId);
        const functional = org.functionalCurrency;
        const currency = lot.currency as CurrencyCode;

        // ---- Who gives the money back, and where the rest goes -------------
        const receipt = await receiptOf(tx, lot, item.value.inventoryAccountId);
        const counterpartyAccountId = input.counterpartyAccountId ?? receipt.supplierAccountId;
        if (!counterpartyAccountId) {
          return err({ code: 'supplier_account_required', layerId: lot.id });
        }
        const counterparty = await vetCounterparty(
          tx,
          counterpartyAccountId,
          item.value.inventoryAccountId,
        );
        if (!counterparty.ok) return counterparty;

        const expenseAccountId = input.expenseAccountId ?? item.value.cogsAccountId;
        if (input.expenseAccountId) {
          const expense = await vetAccount(tx, input.expenseAccountId, 'expense', functional);
          if (!expense.ok) return expense;
        }

        // ---- The goods: out of this lot, at what it carries them at --------
        if (input.quantity <= 0n) return err({ code: 'zero_amount_posting', index: 0 });
        // Measured against this delivery alone: "only 783 m² on hand" would
        // be true of the product and wrong about what can go back from here.
        if (input.quantity > lot.remainingQuantityMinor) {
          return err({
            code: 'supplier_return_exceeds_lot',
            layerId: lot.id,
            remaining: String(lot.remainingQuantityMinor),
            requested: String(input.quantity),
            precision: item.value.quantityPrecision,
            unit: item.value.unit,
          });
        }
        const allocation = allocate([toCostLayer(lot)], input.quantity, 'specific', lot.id);
        if (!allocation.ok) return err(costingRefusal(allocation.error, item.value));

        // ---- The money: what the supplier gives back ------------------------
        const scaled = currency === functional ? null : parseRate(lot.fxRate);
        if (scaled !== null && typeof scaled !== 'bigint') {
          return err({ code: 'invalid_fx_rate', accountId: '', rate: lot.fxRate });
        }
        // The lot's own rate. The refund undoes part of that purchase; at
        // today's rate it would book an exchange difference no money moved to
        // create — and the payable's revaluation starts from the booked rate.
        const toBase = (amount: bigint): bigint =>
          scaled === null
            ? amount
            : convert({
                amount: amount as MinorUnits,
                from: currency,
                to: functional,
                rate: scaled,
              });

        const refunded = await refundedFrom(tx, lot.id);
        const refundable = lot.costMinor - refunded;
        if (input.refund !== undefined && (input.refund < 0n || input.refund > refundable)) {
          return err({
            code: 'supplier_refund_exceeds_lot',
            layerId: lot.id,
            remaining: toDecimalString(minorUnits(refundable < 0n ? 0n : refundable), currency),
            requested: toDecimalString(minorUnits(input.refund), currency),
            currency,
          });
        }
        const priceShare = allocation.value.cost;
        const figures = supplierRefund({
          draw: { cost: priceShare, baseCost: allocation.value.baseCost },
          refund: input.refund ?? (priceShare > refundable ? refundable : priceShare),
          landed: lot.baseCostMinor !== toBase(lot.costMinor),
          toBase,
        });

        // ---- The input tax that comes back out with it ----------------------
        let tax: {
          readonly id: string;
          readonly payable: bigint;
          readonly reclaimed: bigint;
          readonly legs: readonly (readonly [string, bigint])[];
          readonly code: Parameters<typeof recordTaxEntries>[2]['taxCode'];
        } | null = null;
        if (input.taxCodeId) {
          // Import tax is paid to customs and reclaimed from the state; the
          // supplier abroad never charged it and gives none of it back.
          if (currency !== functional) {
            return err({ code: 'supplier_return_tax_needs_local_currency', currency, functional });
          }
          const calculated = await calculateTax(tx, input.taxCodeId, 'purchase', figures.refund);
          if (!calculated.ok) return calculated;
          const { calculation, code } = calculated.value;
          tax = {
            id: code.id,
            payable: calculation.gross - calculation.net,
            reclaimed: calculation.tax,
            // The purchase's tax legs, undone.
            legs: calculation.legs.map((leg) => [leg.accountId, -leg.amount] as const),
            code,
          };
        }
        const taxPayable = tax?.payable ?? 0n;

        // ---- The entry ------------------------------------------------------
        const entryPostings: DraftPosting[] = [];
        const gross = figures.refund + taxPayable;
        if (gross > 0n) {
          const owed = await counterpartyLeg(
            tx,
            counterpartyAccountId,
            { amount: gross, currency },
            { amount: figures.refundBase + taxPayable, rate: lot.fxRate, currency: functional },
            1n,
          );
          if (!owed.ok) return owed;
          entryPostings.push(owed.value);
        }
        entryPostings.push(
          ...legs([
            [item.value.inventoryAccountId, -figures.carrying],
            [expenseAccountId, figures.unrecovered],
            ...(tax?.legs ?? []),
          ]),
        );
        if (entryPostings.length === 0) return err({ code: 'zero_amount_posting', index: 0 });

        const movementId = newId('inventoryMovement');
        const supplierReturnId = newId('supplierReturn');
        const books = ledgerMessages(org.locale);
        const entry = await createJournalService(tx, orgId).postEntry({
          description: books.returnedToSupplier(
            input.reference,
            item.value.name,
            lot.reference ?? lot.acquiredAt.toISOString().slice(0, 10),
          ),
          currency: functional,
          occurredAt,
          metadata: {
            ...(input.metadata ?? {}),
            supplierReturn: input.reference,
            reference: input.reference,
            inventoryItem: item.value.sku,
            inventoryMovement: movementId,
            // What the aged payables settle this against: the supplier's own
            // invoice for the delivery, when the receipt recorded one.
            ...(receipt.invoice ? { appliesTo: receipt.invoice } : {}),
          },
          ...(input.actor ? { actor: input.actor } : {}),
          postings: entryPostings,
        });
        if (!entry.ok) return entry;
        const transactionId = entry.value.transaction.id;

        await tx.insert(inventoryMovements).values({
          id: movementId,
          orgId,
          itemId: item.value.id,
          kind: 'supplier_return',
          quantityMinor: allocation.value.quantity,
          costMinor: allocation.value.cost,
          baseCostMinor: allocation.value.baseCost,
          occurredAt,
          transactionId,
          costingMethod: methodFor(item.value, org),
          reference: input.reference,
        });
        await recordDraws(tx, orgId, movementId, allocation.value.draws);

        await tx.insert(supplierReturns).values({
          id: supplierReturnId,
          orgId,
          reference: input.reference,
          itemId: item.value.id,
          layerId: lot.id,
          movementId,
          counterpartyAccountId,
          expenseAccountId: figures.unrecovered === 0n ? null : expenseAccountId,
          taxCodeId: tax?.id ?? null,
          currency,
          fxRate: lot.fxRate,
          quantityMinor: allocation.value.quantity,
          refundMinor: figures.refund,
          taxMinor: taxPayable,
          refundBaseMinor: figures.refundBase,
          taxBaseMinor: taxPayable,
          carryingBaseMinor: figures.carrying,
          unrecoveredBaseMinor: figures.unrecovered,
          reason: input.reason ?? null,
          occurredAt,
          transactionId,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        // The tax return reads these rows, so the reversal lands in the month
        // the goods went back — when the adjustment is declared.
        if (tax) {
          await recordTaxEntries(tx, orgId, {
            transactionId,
            taxCode: tax.code,
            supply: 'purchase',
            net: -figures.refundBase,
            tax: -tax.reclaimed,
            occurredAt,
          });
        }

        const summary = await describe(tx, supplierReturnId, functional);
        return summary
          ? ok({ supplierReturn: summary, entry: entry.value.transaction })
          : err({ code: 'supplier_return_not_found', supplierReturnId });
      });
    },

    async get(supplierReturnId: string): Promise<SupplierReturnSummary | null> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        return describe(tx, supplierReturnId, org.functionalCurrency);
      });
    },

    /** Newest first. */
    async list(options: { itemId?: string; limit?: number } = {}) {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const rows = await tx
          .select({ id: supplierReturns.id })
          .from(supplierReturns)
          .where(options.itemId ? eq(supplierReturns.itemId, options.itemId) : undefined)
          .orderBy(desc(supplierReturns.occurredAt), desc(supplierReturns.id))
          .limit(options.limit ?? 50);
        const out: SupplierReturnSummary[] = [];
        for (const row of rows) {
          const summary = await describe(tx, row.id, org.functionalCurrency);
          if (summary) out.push(summary);
        }
        return out;
      });
    },

    /** Every open delivery of a product, with what can still go back from it. */
    async returnable(itemId: string): Promise<readonly ReturnableLot[]> {
      return withTenant(database, orgId, async (tx) => {
        const item = await load(tx, itemId);
        if (!item.ok) return [];
        const org = await organisation(tx, orgId);
        const lots = await tx
          .select()
          .from(costLayers)
          .where(and(eq(costLayers.itemId, itemId), sql`${costLayers.remainingQuantityMinor} > 0`))
          .orderBy(asc(costLayers.acquiredAt), asc(costLayers.id));

        const out: ReturnableLot[] = [];
        for (const lot of lots) {
          const receipt = await receiptOf(tx, lot, item.value.inventoryAccountId);
          const refunded = await refundedFrom(tx, lot.id);
          const scaled = lot.currency === org.functionalCurrency ? null : parseRate(lot.fxRate);
          const purchaseBase =
            scaled === null || typeof scaled !== 'bigint'
              ? lot.costMinor
              : convert({
                  amount: lot.costMinor as MinorUnits,
                  from: lot.currency as CurrencyCode,
                  to: org.functionalCurrency,
                  rate: scaled,
                });
          const refundable = lot.costMinor - refunded;
          out.push({
            layerId: lot.id,
            itemId,
            reference: lot.reference,
            currency: lot.currency as CurrencyCode,
            remainingQuantityMinor: String(lot.remainingQuantityMinor),
            remainingCostMinor: String(lot.remainingCostMinor),
            refundableMinor: String(refundable < 0n ? 0n : refundable),
            supplierAccountId: receipt.supplierAccountId,
            landed: lot.baseCostMinor !== purchaseBase,
          });
        }
        return out;
      });
    },
  };
}

export type SupplierReturnService = ReturnType<typeof createSupplierReturnService>;

type LotRow = typeof costLayers.$inferSelect;

/**
 * The delivery's own entry: which account it was credited to, and the
 * supplier's invoice number if the receipt recorded one.
 *
 * The credited account is the supplier in the ordinary case and the natural
 * default for who gives the money back. A lot opened as an opening balance
 * has no entry, and the person has to say.
 */
async function receiptOf(
  tx: Transactional,
  lot: LotRow,
  inventoryAccountId: string,
): Promise<{ supplierAccountId: string | null; invoice: string | null }> {
  if (!lot.transactionId) return { supplierAccountId: null, invoice: null };
  const [credited] = await tx
    .select({ accountId: postings.accountId })
    .from(postings)
    .where(
      and(
        eq(postings.transactionId, lot.transactionId),
        sql`${postings.accountId} <> ${inventoryAccountId}`,
        sql`${postings.amountMinor} < 0`,
      ),
    )
    .orderBy(asc(postings.sequence))
    .limit(1);
  const [entry] = await tx
    .select({ metadata: transactions.metadata })
    .from(transactions)
    .where(eq(transactions.id, lot.transactionId))
    .limit(1);
  const metadata = entry?.metadata ?? {};
  return {
    supplierAccountId: credited?.accountId ?? null,
    invoice: metadata['invoice'] ?? metadata['reference'] ?? null,
  };
}

/** What earlier returns already took back from this delivery, in its currency. */
async function refundedFrom(tx: Transactional, layerId: string): Promise<bigint> {
  const [row] = await tx
    .select({ refunded: sql<string>`coalesce(sum(${supplierReturns.refundMinor}), 0)::text` })
    .from(supplierReturns)
    .where(eq(supplierReturns.layerId, layerId));
  return BigInt(row?.refunded ?? '0');
}

/** Somebody who can give money back: a payable, or money itself. */
async function vetCounterparty(
  tx: Transactional,
  accountId: string,
  inventoryAccountId: string,
): Promise<Result<true, LedgerError>> {
  const [row] = await tx
    .select({ type: accounts.type, status: accounts.status })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return err({ code: 'account_not_found', accountId });
  if (row.status === 'closed') return err({ code: 'account_closed', accountId });
  if ((row.type !== 'liability' && row.type !== 'asset') || accountId === inventoryAccountId) {
    return err({ code: 'account_wrong_type', accountId, expected: 'liability', actual: row.type });
  }
  return ok(true);
}

async function describe(
  tx: Transactional,
  supplierReturnId: string,
  functional: CurrencyCode,
): Promise<SupplierReturnSummary | null> {
  const [row] = await tx
    .select({
      entry: supplierReturns,
      item: inventoryItems,
      layerReference: costLayers.reference,
      counterpartyName: accounts.name,
    })
    .from(supplierReturns)
    .innerJoin(inventoryItems, eq(inventoryItems.id, supplierReturns.itemId))
    .innerJoin(costLayers, eq(costLayers.id, supplierReturns.layerId))
    .innerJoin(accounts, eq(accounts.id, supplierReturns.counterpartyAccountId))
    .where(eq(supplierReturns.id, supplierReturnId))
    .limit(1);
  if (!row) return null;
  const { entry, item } = row;
  const currency = entry.currency as CurrencyCode;
  const lotMoney = (value: bigint) => toMoneyDto(value as MinorUnits, currency);
  const base = (value: bigint) => toMoneyDto(value as MinorUnits, functional);

  return {
    id: entry.id,
    reference: entry.reference,
    itemId: item.id,
    sku: item.sku,
    itemName: item.name,
    unit: item.unit,
    quantityPrecision: item.quantityPrecision,
    layerId: entry.layerId,
    layerReference: row.layerReference,
    counterpartyAccountId: entry.counterpartyAccountId,
    counterpartyName: row.counterpartyName,
    expenseAccountId: entry.expenseAccountId,
    occurredAt: entry.occurredAt,
    reason: entry.reason,
    quantityMinor: String(entry.quantityMinor),
    refund: lotMoney(entry.refundMinor),
    tax: lotMoney(entry.taxMinor),
    gross: lotMoney(entry.refundMinor + entry.taxMinor),
    carrying: base(entry.carryingBaseMinor),
    unrecovered: base(entry.unrecoveredBaseMinor),
    transactionId: entry.transactionId,
  };
}

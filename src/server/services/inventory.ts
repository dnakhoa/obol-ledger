import { and, desc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { defaultPrecision, type Unit } from '@/lib/quantity';
import { allocate, onHand, type CostLayer, type CostingMethod } from '@/server/domain/costing';
import { ledgerMessages, type Locale } from '@/lib/i18n';
import type { LedgerError } from '@/server/domain/errors';
import {
  accounts,
  costLayers,
  inventoryItems,
  inventoryMovements,
  layerConsumptions,
  organizations,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createJournalService } from './journal';
import { rateOn } from './rates';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Stock, and what it cost.
 *
 * The division of labour here is the point. `domain/costing.ts` decides *which
 * lots* a movement draws from and *what that draw costs* — pure arithmetic,
 * checkable by hand against the spreadsheet it replaces. This module does the
 * rest: it reads the lots, posts the resulting entry through the ordinary
 * journal, and writes down which lots were consumed so the answer can be
 * audited later.
 *
 * Nothing here posts an entry by a private route. The cost of goods sold goes
 * through `postEntry` like a hand-typed transfer, so it obeys the balance rule,
 * the period lock and the append-only triggers. What the layers decide is the
 * amount; they decide nothing about the rules.
 */

export type CreateItemInput = {
  readonly sku: string;
  readonly name: string;
  readonly unit: Unit;
  readonly quantityPrecision?: number | undefined;
  readonly inventoryAccountId: string;
  readonly cogsAccountId: string;
  readonly costingMethod?: CostingMethod | undefined;
  readonly metadata?: Record<string, string> | undefined;
};

export type ReceiveInput = {
  readonly itemId: string;
  /** Scaled by the item's precision. */
  readonly quantity: bigint;
  /** What was paid, in `currency`'s minor units. */
  readonly cost: bigint;
  readonly currency: CurrencyCode;
  /** What is credited: a payable for stock on terms, a bank for cash. */
  readonly creditAccountId: string;
  readonly occurredAt?: Date | undefined;
  /** Container number, supplier invoice — what they will search for. */
  readonly reference?: string | undefined;
  readonly description?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  /**
   * The shipment this lot arrived on, when it arrived on one.
   *
   * What lets freight and duty find it six weeks later — a charge is spread
   * across the lots of one shipment. See `docs/adr/0015-landed-cost.md`.
   */
  readonly shipmentId?: string | undefined;
  /** Grams. Only needed if a charge will be apportioned by weight. */
  readonly weightGrams?: bigint | undefined;
};

export type IssueInput = {
  readonly itemId: string;
  readonly quantity: bigint;
  readonly occurredAt?: Date | undefined;
  /** Required when the item is costed by specific identification. */
  readonly layerId?: string | undefined;
  readonly reference?: string | undefined;
  readonly description?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
};

export type ItemSummary = {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly unit: Unit;
  readonly quantityPrecision: number;
  readonly costingMethod: CostingMethod;
  /** True when the method came from the organisation rather than the item. */
  readonly costingInherited: boolean;
  readonly status: 'active' | 'archived';
  readonly onHandMinor: string;
  readonly valueMinor: string;
  /** The same figure, ready to print. Always in the functional currency: it is
   * what the inventory account carries, and the only measure that can be added
   * across lots bought in different currencies. */
  readonly value: MoneyDto;
  readonly currency: CurrencyCode;
  readonly openLayers: number;
  readonly inventoryAccountId: string;
  readonly cogsAccountId: string;
};

export type LayerSummary = {
  readonly id: string;
  readonly reference: string | null;
  readonly acquiredAt: Date;
  readonly currency: CurrencyCode;
  readonly quantityMinor: string;
  readonly remainingQuantityMinor: string;
  readonly costMinor: string;
  readonly remainingCostMinor: string;
  readonly remainingBaseCostMinor: string;
  /** What was paid for this lot, in the currency it was paid in. */
  readonly cost: MoneyDto;
  /** What is left of it, in the books' own currency. */
  readonly remainingValue: MoneyDto;
  readonly transactionId: string | null;
};

export type MovementSummary = {
  readonly id: string;
  readonly kind: 'receipt' | 'issue' | 'writeoff';
  readonly quantityMinor: string;
  readonly baseCostMinor: string;
  readonly cost: MoneyDto;
  readonly occurredAt: Date;
  readonly reference: string | null;
  readonly costingMethod: CostingMethod;
  readonly transactionId: string;
  /** Which lots this movement drew from. Empty for a receipt. */
  readonly drawnFrom: readonly {
    readonly layerId: string;
    readonly layerReference: string | null;
    readonly quantityMinor: string;
    readonly baseCostMinor: string;
    readonly cost: MoneyDto;
  }[];
};

export type MovementResult = {
  readonly movement: MovementSummary;
  readonly entry: TransactionDto;
};

export function createInventoryService(database: Database, orgId: string) {
  return {
    async createItem(input: CreateItemInput): Promise<Result<ItemSummary, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);

        // The method is checked here *and* by a CHECK the composite key makes
        // possible. Here so the refusal explains itself; there because this
        // service is not the only thing that can write a row.
        if (input.costingMethod === 'lifo' && org.chartTemplate !== 'us_gaap') {
          return err({
            code: 'costing_method_not_permitted',
            method: 'lifo',
            chartTemplate: org.chartTemplate,
          });
        }

        const [existing] = await tx
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(eq(inventoryItems.sku, input.sku))
          .limit(1);
        if (existing) return err({ code: 'sku_taken', sku: input.sku });

        const inventoryAccount = await vetAccount(
          tx,
          input.inventoryAccountId,
          'asset',
          org.functionalCurrency,
        );
        if (!inventoryAccount.ok) return inventoryAccount;

        const cogsAccount = await vetAccount(
          tx,
          input.cogsAccountId,
          'expense',
          org.functionalCurrency,
        );
        if (!cogsAccount.ok) return cogsAccount;

        const id = newId('inventoryItem');
        await tx.insert(inventoryItems).values({
          id,
          orgId,
          sku: input.sku,
          name: input.name,
          unit: input.unit,
          quantityPrecision: input.quantityPrecision ?? defaultPrecision(input.unit),
          inventoryAccountId: input.inventoryAccountId,
          cogsAccountId: input.cogsAccountId,
          ...(input.costingMethod ? { costingMethod: input.costingMethod } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        const summary = await summarise(tx, orgId, id);
        return summary ? ok(summary) : err({ code: 'item_not_found', itemId: id });
      });
    },

    /**
     * Stock arrives: one ledger entry and one new lot, or neither.
     *
     * Posting the purchase and opening the layer in the same transaction is
     * the whole reason this is worth building. The two halves are the same
     * fact, and a system where they are separate steps is a system where the
     * inventory account and the stock records disagree — which, in every
     * business that runs a ledger beside a spreadsheet, is the first week.
     */
    async receive(input: ReceiveInput): Promise<Result<MovementResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const item = await load(tx, input.itemId);
        if (!item.ok) return item;
        if (item.value.status === 'archived') {
          return err({ code: 'item_archived', itemId: input.itemId });
        }

        const org = await organisation(tx, orgId);
        const occurredAt = input.occurredAt ?? new Date();

        // What this cost in the books' own currency, at the rate on the day it
        // arrived. Recorded once, here, and never revisited: inventory is
        // non-monetary, so this figure is the cost of goods sold forever.
        const base = await inFunctional(tx, orgId, input.cost, input.currency, org, occurredAt);
        if (!base.ok) return base;

        const layerId = newId('costLayer');
        const movementId = newId('inventoryMovement');

        const entry = await createJournalService(tx, orgId).postEntry({
          description:
            input.description ??
            ledgerMessages(org.locale).stockReceived(item.value.name, input.reference),
          currency: org.functionalCurrency,
          occurredAt,
          metadata: {
            ...(input.metadata ?? {}),
            inventoryItem: item.value.sku,
            inventoryMovement: movementId,
          },
          postings: [
            {
              accountId: item.value.inventoryAccountId,
              amount: base.value.amount as MinorUnits,
              baseAmount: base.value.amount as MinorUnits,
              fxRate: '1',
            },
            {
              accountId: input.creditAccountId,
              amount: -base.value.amount as MinorUnits,
              baseAmount: -base.value.amount as MinorUnits,
              fxRate: '1',
            },
          ],
        });
        if (!entry.ok) return entry;

        await tx.insert(costLayers).values({
          id: layerId,
          orgId,
          itemId: item.value.id,
          transactionId: entry.value.transaction.id,
          reference: input.reference ?? null,
          acquiredAt: occurredAt,
          currency: input.currency,
          fxRate: base.value.rate,
          quantityMinor: input.quantity,
          remainingQuantityMinor: input.quantity,
          costMinor: input.cost,
          remainingCostMinor: input.cost,
          ...(input.shipmentId ? { shipmentId: input.shipmentId } : {}),
          ...(input.weightGrams === undefined ? {} : { weightGrams: input.weightGrams }),
          baseCostMinor: base.value.amount,
          remainingBaseCostMinor: base.value.amount,
        });

        await tx.insert(inventoryMovements).values({
          id: movementId,
          orgId,
          itemId: item.value.id,
          kind: 'receipt',
          quantityMinor: input.quantity,
          costMinor: input.cost,
          baseCostMinor: base.value.amount,
          occurredAt,
          transactionId: entry.value.transaction.id,
          layerId,
          costingMethod: methodFor(item.value, org),
          reference: input.reference ?? null,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        const movement = await describeMovement(tx, orgId, movementId);
        return movement
          ? ok({ movement, entry: entry.value.transaction })
          : err({ code: 'item_not_found', itemId: input.itemId });
      });
    },

    /**
     * Stock leaves, and the layers say what it cost.
     *
     * The refusal is the feature. A shipment larger than what is on hand gets
     * `insufficient_stock` with the real figure, and nothing is written —
     * where a spreadsheet would cost it against a negative balance and produce
     * a number indistinguishable from a correct one.
     */
    async issue(input: IssueInput): Promise<Result<MovementResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const item = await load(tx, input.itemId);
        if (!item.ok) return item;
        if (item.value.status === 'archived') {
          return err({ code: 'item_archived', itemId: input.itemId });
        }

        const org = await organisation(tx, orgId);
        const method = methodFor(item.value, org);
        if (method === 'specific' && !input.layerId) {
          return err({ code: 'cost_layer_required', itemId: input.itemId });
        }

        // FOR UPDATE, because the allocation is read-then-write: two shipments
        // of the last container, computed concurrently, would both find it
        // available and both draw it down. Locking the open layers makes the
        // second wait and then see the first one's result.
        const open = await openLayers(tx, item.value.id, { lock: true });

        const allocation = allocate(
          open.map((layer): CostLayer => ({
            id: layer.id,
            remainingQuantity: layer.remainingQuantityMinor,
            remainingCost: layer.remainingCostMinor,
            remainingBaseCost: layer.remainingBaseCostMinor,
            acquiredAt: layer.acquiredAt,
          })),
          input.quantity,
          method,
          input.layerId,
        );

        if (!allocation.ok) {
          switch (allocation.error.code) {
            case 'insufficient_stock':
              return err({
                code: 'insufficient_stock',
                itemId: item.value.id,
                requested: allocation.error.requested,
                available: allocation.error.available,
                precision: item.value.quantityPrecision,
                unit: item.value.unit,
              });
            case 'layer_not_found':
              return err({ code: 'cost_layer_not_found', layerId: allocation.error.layerId });
            case 'layer_required':
              return err({ code: 'cost_layer_required', itemId: item.value.id });
            case 'non_positive_quantity':
              return err({ code: 'zero_amount_posting', index: 0 });
          }
        }

        const occurredAt = input.occurredAt ?? new Date();
        const movementId = newId('inventoryMovement');

        const entry = await createJournalService(tx, orgId).postEntry({
          description:
            input.description ??
            ledgerMessages(org.locale).costOfGoodsSold(item.value.name, input.reference),
          currency: org.functionalCurrency,
          occurredAt,
          metadata: {
            ...(input.metadata ?? {}),
            inventoryItem: item.value.sku,
            inventoryMovement: movementId,
          },
          postings: [
            {
              accountId: item.value.cogsAccountId,
              amount: allocation.value.baseCost as MinorUnits,
              baseAmount: allocation.value.baseCost as MinorUnits,
              fxRate: '1',
            },
            {
              accountId: item.value.inventoryAccountId,
              amount: -allocation.value.baseCost as MinorUnits,
              baseAmount: -allocation.value.baseCost as MinorUnits,
              fxRate: '1',
            },
          ],
        });
        if (!entry.ok) return entry;

        await tx.insert(inventoryMovements).values({
          id: movementId,
          orgId,
          itemId: item.value.id,
          kind: 'issue',
          quantityMinor: allocation.value.quantity,
          costMinor: allocation.value.cost,
          baseCostMinor: allocation.value.baseCost,
          occurredAt,
          transactionId: entry.value.transaction.id,
          costingMethod: method,
          reference: input.reference ?? null,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        for (const draw of allocation.value.draws) {
          await tx.insert(layerConsumptions).values({
            id: newId('layerConsumption'),
            orgId,
            movementId,
            layerId: draw.layerId,
            quantityMinor: draw.quantity,
            costMinor: draw.cost,
            baseCostMinor: draw.baseCost,
          });

          // The only mutation a layer permits. Expressed as a decrement rather
          // than a computed new value so it cannot be written from a stale
          // read — and the CHECK in 0017 refuses the result if the money
          // outlasts the stock.
          await tx
            .update(costLayers)
            .set({
              remainingQuantityMinor: sql`${costLayers.remainingQuantityMinor} - ${draw.quantity}`,
              remainingCostMinor: sql`${costLayers.remainingCostMinor} - ${draw.cost}`,
              remainingBaseCostMinor: sql`${costLayers.remainingBaseCostMinor} - ${draw.baseCost}`,
            })
            .where(eq(costLayers.id, draw.layerId));
        }

        const movement = await describeMovement(tx, orgId, movementId);
        return movement
          ? ok({ movement, entry: entry.value.transaction })
          : err({ code: 'item_not_found', itemId: input.itemId });
      });
    },

    async list(): Promise<readonly ItemSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .orderBy(inventoryItems.sku);

        const summaries: ItemSummary[] = [];
        for (const row of rows) {
          const summary = await summarise(tx, orgId, row.id);
          if (summary) summaries.push(summary);
        }
        return summaries;
      });
    },

    async item(itemId: string): Promise<ItemSummary | null> {
      return withTenant(database, orgId, (tx) => summarise(tx, orgId, itemId));
    },

    /** Open lots, oldest first — the order FIFO will take them in. */
    async layers(itemId: string): Promise<readonly LayerSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const rows = await openLayers(tx, itemId, { lock: false });
        return rows.map((row): LayerSummary => ({
          id: row.id,
          reference: row.reference,
          acquiredAt: row.acquiredAt,
          currency: row.currency as CurrencyCode,
          quantityMinor: String(row.quantityMinor),
          remainingQuantityMinor: String(row.remainingQuantityMinor),
          costMinor: String(row.costMinor),
          remainingCostMinor: String(row.remainingCostMinor),
          remainingBaseCostMinor: String(row.remainingBaseCostMinor),
          cost: toMoneyDto(row.costMinor as MinorUnits, row.currency as CurrencyCode),
          remainingValue: toMoneyDto(
            row.remainingBaseCostMinor as MinorUnits,
            org.functionalCurrency,
          ),
          transactionId: row.transactionId,
        }));
      });
    },

    async movements(itemId: string, limit = 50): Promise<readonly MovementSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({ id: inventoryMovements.id })
          .from(inventoryMovements)
          .where(eq(inventoryMovements.itemId, itemId))
          .orderBy(desc(inventoryMovements.occurredAt), desc(inventoryMovements.id))
          .limit(limit);

        const out: MovementSummary[] = [];
        for (const row of rows) {
          const movement = await describeMovement(tx, orgId, row.id);
          if (movement) out.push(movement);
        }
        return out;
      });
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;

type ItemRow = typeof inventoryItems.$inferSelect;
type OrgRow = {
  chartTemplate: string;
  costingMethod: CostingMethod;
  functionalCurrency: CurrencyCode;
  /** The language the *books* are in — see `docs/adr/0014-two-locales.md`. */
  locale: Locale;
};

async function organisation(tx: Transactional, orgId: string): Promise<OrgRow> {
  const [row] = await tx
    .select({
      chartTemplate: organizations.chartTemplate,
      costingMethod: organizations.costingMethod,
      functionalCurrency: organizations.functionalCurrency,
      locale: organizations.locale,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  return {
    chartTemplate: row?.chartTemplate ?? 'generic',
    costingMethod: row?.costingMethod ?? 'fifo',
    functionalCurrency: (row?.functionalCurrency ?? 'USD') as CurrencyCode,
    locale: row?.locale ?? 'en',
  };
}

/** The item's own method, or the organisation's when it has none. */
function methodFor(item: ItemRow, org: OrgRow): CostingMethod {
  return item.costingMethod ?? org.costingMethod;
}

async function load(tx: Transactional, itemId: string): Promise<Result<ItemRow, LedgerError>> {
  const [row] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  return row ? ok(row) : err({ code: 'item_not_found', itemId });
}

/**
 * The account has to be the right class and in the books' own currency.
 *
 * The currency rule is not a simplification. Stock is a non-monetary item: its
 * carrying amount is fixed at the rate on the day it arrived and must never be
 * retranslated (IAS 21.23(b), and see `docs/adr/0012-fx-revaluation.md`). An
 * inventory account denominated in a foreign currency would be claiming a
 * standing foreign balance, which is exactly the thing that gets retranslated.
 * The foreign cost is recorded on the layer instead, where it belongs — as a
 * fact about a purchase rather than a property of an account.
 */
async function vetAccount(
  tx: Transactional,
  accountId: string,
  expected: 'asset' | 'expense',
  functional: CurrencyCode,
): Promise<Result<true, LedgerError>> {
  const [row] = await tx
    .select({ type: accounts.type, currency: accounts.currency, status: accounts.status })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!row) return err({ code: 'account_not_found', accountId });
  if (row.status === 'closed') return err({ code: 'account_closed', accountId });
  if (row.type !== expected) {
    return err({ code: 'account_wrong_type', accountId, expected, actual: row.type });
  }
  if (row.currency !== functional) {
    return err({
      code: 'inventory_account_not_functional',
      accountId,
      currency: row.currency as CurrencyCode,
      functional,
    });
  }
  return ok(true);
}

/** What a foreign purchase cost in the books' own currency, on its own day. */
async function inFunctional(
  tx: Transactional,
  orgId: string,
  amount: bigint,
  currency: CurrencyCode,
  org: OrgRow,
  occurredAt: Date,
): Promise<Result<{ amount: bigint; rate: string }, LedgerError>> {
  if (currency === org.functionalCurrency) return ok({ amount, rate: '1' });

  // The rate in force on the day it arrived, not today's: the whole point of
  // freezing a non-monetary cost is that it is the historical one.
  const rate = await rateOn(
    tx,
    orgId,
    currency,
    org.functionalCurrency,
    occurredAt.toISOString().slice(0, 10),
  );
  if (!rate.ok) return rate;

  const parsed = parseRate(rate.value);
  if (typeof parsed !== 'bigint') {
    return err({ code: 'invalid_fx_rate', accountId: '', rate: rate.value });
  }

  return ok({
    amount: convert({
      amount: amount as MinorUnits,
      from: currency,
      to: org.functionalCurrency,
      rate: parsed,
    }),
    rate: rate.value,
  });
}

type LayerRow = typeof costLayers.$inferSelect;

async function openLayers(
  tx: Transactional,
  itemId: string,
  options: { lock: boolean },
): Promise<LayerRow[]> {
  const query = tx
    .select()
    .from(costLayers)
    .where(and(eq(costLayers.itemId, itemId), sql`${costLayers.remainingQuantityMinor} > 0`))
    .orderBy(costLayers.acquiredAt, costLayers.id);

  return options.lock ? query.for('update') : query;
}

async function summarise(
  tx: Transactional,
  orgId: string,
  itemId: string,
): Promise<ItemSummary | null> {
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  if (!item) return null;

  const org = await organisation(tx, orgId);
  const open = await openLayers(tx, itemId, { lock: false });
  const held = onHand(
    open.map((layer) => ({
      id: layer.id,
      remainingQuantity: layer.remainingQuantityMinor,
      remainingCost: layer.remainingCostMinor,
      remainingBaseCost: layer.remainingBaseCostMinor,
      acquiredAt: layer.acquiredAt,
    })),
  );

  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    quantityPrecision: item.quantityPrecision,
    costingMethod: methodFor(item, org),
    costingInherited: item.costingMethod === null,
    status: item.status,
    onHandMinor: String(held.quantity),
    // Always the functional-currency figure: it is what the inventory account
    // carries, and the only one that can be added up across lots bought in
    // different currencies.
    valueMinor: String(held.baseCost),
    value: toMoneyDto(held.baseCost as MinorUnits, org.functionalCurrency),
    currency: org.functionalCurrency,
    openLayers: open.length,
    inventoryAccountId: item.inventoryAccountId,
    cogsAccountId: item.cogsAccountId,
  };
}

async function describeMovement(
  tx: Transactional,
  orgId: string,
  movementId: string,
): Promise<MovementSummary | null> {
  const org = await organisation(tx, orgId);
  const [row] = await tx
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.id, movementId))
    .limit(1);
  if (!row) return null;

  const draws = await tx
    .select({
      layerId: layerConsumptions.layerId,
      quantityMinor: layerConsumptions.quantityMinor,
      baseCostMinor: layerConsumptions.baseCostMinor,
      layerReference: costLayers.reference,
      acquiredAt: costLayers.acquiredAt,
    })
    .from(layerConsumptions)
    .innerJoin(costLayers, eq(costLayers.id, layerConsumptions.layerId))
    .where(eq(layerConsumptions.movementId, movementId))
    .orderBy(costLayers.acquiredAt, costLayers.id);

  return {
    id: row.id,
    kind: row.kind,
    quantityMinor: String(row.quantityMinor),
    baseCostMinor: String(row.baseCostMinor),
    cost: toMoneyDto(row.baseCostMinor as MinorUnits, org.functionalCurrency),
    occurredAt: row.occurredAt,
    reference: row.reference,
    costingMethod: row.costingMethod,
    transactionId: row.transactionId,
    drawnFrom: draws.map((draw) => ({
      layerId: draw.layerId,
      layerReference: draw.layerReference,
      quantityMinor: String(draw.quantityMinor),
      baseCostMinor: String(draw.baseCostMinor),
      cost: toMoneyDto(draw.baseCostMinor as MinorUnits, org.functionalCurrency),
    })),
  };
}

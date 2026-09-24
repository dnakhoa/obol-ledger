import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import type { Unit } from '@/lib/quantity';
import { ledgerMessages } from '@/lib/i18n';
import { afterDraws, allocate, type Allocation, type CostLayer } from '@/server/domain/costing';
import { marginOf, priceSale } from '@/server/domain/sale';
import type { TaxCalculation } from '@/server/domain/tax';
import type { LedgerError } from '@/server/domain/errors';
import {
  accounts,
  costLayers,
  inventoryItems,
  inventoryMovements,
  landedCostAllocations,
  landedCostCharges,
  layerConsumptions,
  sales,
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
  openLayers,
  organisation,
  recordDraws,
  toCostLayer,
  type ItemRow,
} from './inventory';
import { createJournalService } from './journal';
import { rateOn } from './rates';
import { calculateTax, recordTaxEntries } from './tax';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Selling stock: the invoice and the goods leaving, as one entry.
 *
 * A distributor's day is a stream of these, and until this module existed the
 * ledger saw each one as two unrelated facts — a receivable against revenue,
 * typed by hand, and a stock movement that posted the cost of goods sold. Both
 * balanced, and the margin on the invoice existed nowhere.
 *
 * One entry now carries all of it:
 *
 * ```
 * Dr  Receivable (customer)   gross, in the invoice currency
 *   Cr  Revenue                 net, in the books' currency
 *   Cr  Output tax              when a tax code applies
 * Dr  Cost of goods sold      from the lots, by each item's method
 *   Cr  Inventory
 * ```
 *
 * and a `sales` row says which movements were its lines and what each was sold
 * for. Margin by invoice, product and customer is then a GROUP BY over facts
 * the ledger already holds. See `docs/adr/0018-sales-and-margin.md`.
 */

export type SaleLineInput = {
  readonly itemId: string;
  /** Scaled by the item's precision. */
  readonly quantity: bigint;
  /** The line's net price in total — not the unit price — in the invoice currency. */
  readonly amount: bigint;
  /** Required when the item is costed by specific identification. */
  readonly layerId?: string | undefined;
};

export type SellInput = {
  /** The invoice number. Unique: a customer pays against it. */
  readonly reference: string;
  /** The customer's receivable, or a bank account for a cash sale. */
  readonly customerAccountId: string;
  readonly revenueAccountId: string;
  /** What the invoice is in. An exporter invoices in the buyer's currency. */
  readonly currency: CurrencyCode;
  readonly taxCodeId?: string | undefined;
  readonly occurredAt?: Date | undefined;
  /** `YYYY-MM-DD`. When the customer agreed to pay; absent means on receipt. */
  readonly dueOn?: string | undefined;
  readonly description?: string | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly lines: readonly SaleLineInput[];
  readonly actor?:
    | { readonly userId?: string | undefined; readonly via: 'ui' | 'api' | 'system' | 'import' }
    | undefined;
};

export type SaleLine = {
  readonly movementId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly unit: Unit;
  readonly quantityPrecision: number;
  readonly quantityMinor: string;
  readonly revenue: MoneyDto;
  readonly cost: MoneyDto;
  readonly margin: MoneyDto;
  readonly marginBasisPoints: number | null;
  /** The lots it shipped from, oldest first. */
  readonly drawnFrom: readonly {
    readonly layerReference: string | null;
    readonly quantityMinor: string;
  }[];
};

export type SaleSummary = {
  readonly id: string;
  readonly reference: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly occurredAt: Date;
  readonly dueOn: string | null;
  readonly currency: CurrencyCode;
  /** As invoiced, in the invoice currency. */
  readonly net: MoneyDto;
  readonly tax: MoneyDto;
  readonly gross: MoneyDto;
  /** In the books' own currency. */
  readonly revenue: MoneyDto;
  readonly cost: MoneyDto;
  readonly margin: MoneyDto;
  readonly marginBasisPoints: number | null;
  readonly transactionId: string;
  readonly lines: readonly SaleLine[];
};

export type SaleResult = {
  readonly sale: SaleSummary;
  readonly entry: TransactionDto;
};

export type MarginRow = {
  readonly revenue: MoneyDto;
  readonly cost: MoneyDto;
  readonly margin: MoneyDto;
  readonly marginBasisPoints: number | null;
};

export type ItemMargin = MarginRow & {
  readonly itemId: string;
  readonly sku: string;
  readonly name: string;
  readonly unit: Unit;
  readonly quantityPrecision: number;
  readonly quantitySoldMinor: string;
  /**
   * Freight and duty that arrived after the goods were sold, and so went
   * straight to cost of sales (see ADR 15). Attributable to the product,
   * not to any one invoice, which is why it appears here and not per sale.
   */
  readonly lateCharges: MoneyDto;
};

export type CustomerMargin = MarginRow & {
  readonly accountId: string;
  readonly name: string;
  readonly code: string | null;
  readonly invoices: number;
};

export type MarginReport = {
  readonly from: Date;
  /** Exclusive. */
  readonly to: Date;
  readonly currency: CurrencyCode;
  readonly byItem: readonly ItemMargin[];
  readonly byCustomer: readonly CustomerMargin[];
  readonly total: MarginRow & { readonly lateCharges: MoneyDto; readonly invoices: number };
};

export function createSalesService(database: Database, orgId: string) {
  return {
    async sell(input: SellInput): Promise<Result<SaleResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        if (input.lines.length === 0) return err({ code: 'sale_has_no_lines' });

        const [taken] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.reference, input.reference))
          .limit(1);
        if (taken) return err({ code: 'sale_reference_taken', reference: input.reference });

        const org = await organisation(tx, orgId);
        const functional = org.functionalCurrency;
        const occurredAt = input.occurredAt ?? new Date();
        const invoicedOn = occurredAt.toISOString().slice(0, 10);

        if (input.dueOn !== undefined && input.dueOn < invoicedOn) {
          return err({ code: 'due_before_invoice', dueOn: input.dueOn, invoicedOn });
        }

        const customer = await customerAccount(tx, input.customerAccountId);
        if (!customer.ok) return customer;

        const revenue = await revenueAccount(tx, input.revenueAccountId, functional);
        if (!revenue.ok) return revenue;

        for (const [index, line] of input.lines.entries()) {
          if (line.amount < 0n) return err({ code: 'zero_amount_posting', index });
        }

        // One rate for the whole invoice, the one in force on its date. The
        // receivable is retranslated at month end and settled at whatever the
        // bank gives; both start from this.
        const rate = await dayRate(tx, orgId, input.currency, functional, invoicedOn);
        if (!rate.ok) return rate;
        const toBase = (amount: bigint): bigint =>
          input.currency === functional
            ? amount
            : convert({
                amount: amount as MinorUnits,
                from: input.currency,
                to: functional,
                rate: rate.value.scaled,
              });

        // ---- Which lots each line ships from ------------------------------
        //
        // Allocated in memory, line by line, with each line seeing what the
        // ones before it took: two lines of the same paver must not both
        // start from the oldest container. Written once, after the entry.
        const items = new Map<string, ItemRow>();
        const lots = new Map<string, readonly CostLayer[]>();
        const references = new Map<string, string | null>();
        const allocations: Allocation[] = [];

        for (const line of input.lines) {
          let item = items.get(line.itemId);
          if (!item) {
            const loaded = await load(tx, line.itemId);
            if (!loaded.ok) return loaded;
            if (loaded.value.status === 'archived') {
              return err({ code: 'item_archived', itemId: line.itemId });
            }
            item = loaded.value;
            items.set(item.id, item);
            // FOR UPDATE: see `drawDown` in inventory.ts. A concurrent sale of
            // the last container waits here and then sees this one's result.
            const rows = await openLayers(tx, item.id, { lock: true });
            for (const row of rows) references.set(row.id, row.reference);
            lots.set(item.id, rows.map(toCostLayer));
          }

          const method = methodFor(item, org);
          if (method === 'specific' && !line.layerId) {
            return err({ code: 'cost_layer_required', itemId: item.id });
          }
          const allocation = allocate(lots.get(item.id) ?? [], line.quantity, method, line.layerId);
          if (!allocation.ok) return err(costingRefusal(allocation.error, item));

          allocations.push(allocation.value);
          lots.set(item.id, afterDraws(lots.get(item.id) ?? [], allocation.value.draws));
        }

        // ---- What the invoice is worth ------------------------------------
        const net = input.lines.reduce((sum, line) => sum + line.amount, 0n);
        if (net <= 0n) return err({ code: 'zero_amount_posting', index: 0 });

        let taxed: {
          calculation: TaxCalculation;
          code: Parameters<typeof recordTaxEntries>[2]['taxCode'];
        } | null = null;
        if (input.taxCodeId) {
          const calculated = await calculateTax(tx, input.taxCodeId, 'sale', net);
          if (!calculated.ok) return calculated;
          taxed = calculated.value;
        }
        const calculation: TaxCalculation = taxed?.calculation ?? {
          net,
          tax: 0n,
          gross: net,
          legs: [],
        };

        const priced = priceSale(
          input.lines.map((line) => line.amount),
          calculation,
          toBase,
        );
        const baseCost = allocations.reduce((sum, a) => sum + a.baseCost, 0n);

        const receivable = await counterpartyLeg(
          tx,
          input.customerAccountId,
          { amount: calculation.gross, currency: input.currency },
          { amount: priced.receivableBase, rate: rate.value.quoted, currency: functional },
          1n,
        );
        if (!receivable.ok) return receivable;

        // ---- The entry -----------------------------------------------------
        const saleId = newId('sale');
        const movementIds = input.lines.map(() => newId('inventoryMovement'));
        const books = ledgerMessages(org.locale);

        const costLegs: [string, bigint][] = [];
        for (const [index, line] of input.lines.entries()) {
          const item = items.get(line.itemId);
          const allocation = allocations[index];
          if (!item || !allocation) continue;
          costLegs.push([item.cogsAccountId, allocation.baseCost]);
          costLegs.push([item.inventoryAccountId, -allocation.baseCost]);
        }

        const entry = await createJournalService(tx, orgId).postEntry({
          description:
            input.description ?? books.saleInvoiced(input.reference, customer.value.name),
          currency: functional,
          occurredAt,
          metadata: {
            ...(input.metadata ?? {}),
            invoice: input.reference,
            sale: saleId,
            ...(input.dueOn ? { dueDate: input.dueOn } : {}),
          },
          ...(input.actor ? { actor: input.actor } : {}),
          postings: [
            receivable.value,
            ...legs([
              [input.revenueAccountId, -priced.baseNet],
              ...priced.taxLegs.map((leg) => [leg.accountId, leg.amount] as const),
              ...costLegs,
            ]),
          ],
        });
        if (!entry.ok) return entry;

        await tx.insert(sales).values({
          id: saleId,
          orgId,
          reference: input.reference,
          customerAccountId: input.customerAccountId,
          revenueAccountId: input.revenueAccountId,
          taxCodeId: input.taxCodeId ?? null,
          currency: input.currency,
          fxRate: rate.value.quoted,
          netMinor: calculation.net,
          taxMinor: calculation.tax,
          grossMinor: calculation.gross,
          baseNetMinor: priced.baseNet,
          baseTaxMinor: priced.baseTax,
          baseCostMinor: baseCost,
          occurredAt,
          dueOn: input.dueOn ?? null,
          transactionId: entry.value.transaction.id,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        for (const [index, line] of input.lines.entries()) {
          const item = items.get(line.itemId);
          const allocation = allocations[index];
          const movementId = movementIds[index];
          if (!item || !allocation || !movementId) continue;

          await tx.insert(inventoryMovements).values({
            id: movementId,
            orgId,
            itemId: item.id,
            kind: 'issue',
            quantityMinor: allocation.quantity,
            costMinor: allocation.cost,
            baseCostMinor: allocation.baseCost,
            occurredAt,
            transactionId: entry.value.transaction.id,
            costingMethod: methodFor(item, org),
            reference: input.reference,
            saleId,
            saleLine: index + 1,
            revenueBaseMinor: priced.lineBases[index] ?? 0n,
          });
          await recordDraws(tx, orgId, movementId, allocation.draws);
        }

        if (taxed) {
          await recordTaxEntries(tx, orgId, {
            transactionId: entry.value.transaction.id,
            taxCode: taxed.code,
            supply: 'sale',
            net: priced.baseNet,
            tax: priced.baseTax,
            occurredAt,
          });
        }

        const summary = await describeSale(tx, saleId, functional);
        return summary
          ? ok({ sale: summary, entry: entry.value.transaction })
          : err({ code: 'sale_not_found', saleId });
      });
    },

    async get(saleId: string): Promise<SaleSummary | null> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        return describeSale(tx, saleId, org.functionalCurrency);
      });
    },

    /** Most recent first. */
    async list(limit = 50): Promise<readonly SaleSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const rows = await tx
          .select({ id: sales.id })
          .from(sales)
          .orderBy(desc(sales.occurredAt), desc(sales.id))
          .limit(limit);
        const out: SaleSummary[] = [];
        for (const row of rows) {
          const sale = await describeSale(tx, row.id, org.functionalCurrency);
          if (sale) out.push(sale);
        }
        return out;
      });
    },

    /**
     * What was made, by product and by customer, over `[from, to)`.
     *
     * Everything is in the books' own currency: revenue at the rate on each
     * invoice's day and cost at the rate each lot arrived at, which are the
     * only two figures that can be added across invoices in different
     * currencies and lots bought in different ones.
     */
    async margins(from: Date, to: Date): Promise<MarginReport> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const currency = org.functionalCurrency;
        const money = (value: bigint) => toMoneyDto(value as MinorUnits, currency);
        const row = (revenue: bigint, cost: bigint): MarginRow => {
          const m = marginOf(revenue, cost);
          return {
            revenue: money(revenue),
            cost: money(cost),
            margin: money(m.margin),
            marginBasisPoints: m.basisPoints,
          };
        };

        const lines = await tx
          .select({
            itemId: inventoryMovements.itemId,
            quantity: sql<string>`sum(${inventoryMovements.quantityMinor})::text`,
            revenue: sql<string>`sum(${inventoryMovements.revenueBaseMinor})::text`,
            cost: sql<string>`sum(${inventoryMovements.baseCostMinor})::text`,
          })
          .from(inventoryMovements)
          .where(
            and(
              isNotNull(inventoryMovements.saleId),
              gte(inventoryMovements.occurredAt, from),
              lt(inventoryMovements.occurredAt, to),
            ),
          )
          .groupBy(inventoryMovements.itemId);

        // Freight and duty that reached cost of sales because the goods had
        // already gone. Dated by the charge's own entry: it is a cost of the
        // period it became known in, which is where ADR 15 posts it.
        const late = await tx
          .select({
            itemId: costLayers.itemId,
            amount: sql<string>`sum(${landedCostAllocations.toCogsMinor})::text`,
          })
          .from(landedCostAllocations)
          .innerJoin(landedCostCharges, eq(landedCostCharges.id, landedCostAllocations.chargeId))
          .innerJoin(transactions, eq(transactions.id, landedCostCharges.transactionId))
          .innerJoin(costLayers, eq(costLayers.id, landedCostAllocations.layerId))
          .where(
            and(
              gte(transactions.occurredAt, from),
              lt(transactions.occurredAt, to),
              sql`${landedCostAllocations.toCogsMinor} <> 0`,
            ),
          )
          .groupBy(costLayers.itemId);

        const itemIds = [...new Set([...lines, ...late].map((r) => r.itemId))];
        const itemRows = itemIds.length
          ? await tx.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds))
          : [];
        const byId = new Map(itemRows.map((item) => [item.id, item]));
        const lateBy = new Map(late.map((r) => [r.itemId, BigInt(r.amount)]));
        const soldBy = new Map(lines.map((r) => [r.itemId, r]));

        const byItem: ItemMargin[] = itemIds
          .flatMap((itemId) => {
            const item = byId.get(itemId);
            if (!item) return [];
            const sold = soldBy.get(itemId);
            const revenue = BigInt(sold?.revenue ?? '0');
            const lateCharges = lateBy.get(itemId) ?? 0n;
            const cost = BigInt(sold?.cost ?? '0') + lateCharges;
            return [
              {
                itemId,
                sku: item.sku,
                name: item.name,
                unit: item.unit,
                quantityPrecision: item.quantityPrecision,
                quantitySoldMinor: sold?.quantity ?? '0',
                lateCharges: money(lateCharges),
                ...row(revenue, cost),
              },
            ];
          })
          // Largest contribution first: the product that pays the rent leads.
          .sort((a, b) => compareMinor(b.margin.minorUnits, a.margin.minorUnits));

        const customers = await tx
          .select({
            accountId: sales.customerAccountId,
            name: accounts.name,
            code: accounts.code,
            invoices: sql<number>`count(*)::int`,
            revenue: sql<string>`sum(${sales.baseNetMinor})::text`,
            cost: sql<string>`sum(${sales.baseCostMinor})::text`,
          })
          .from(sales)
          .innerJoin(accounts, eq(accounts.id, sales.customerAccountId))
          .where(and(gte(sales.occurredAt, from), lt(sales.occurredAt, to)))
          .groupBy(sales.customerAccountId, accounts.name, accounts.code);

        const byCustomer: CustomerMargin[] = customers
          .map((c) => ({
            accountId: c.accountId,
            name: c.name,
            code: c.code,
            invoices: c.invoices,
            ...row(BigInt(c.revenue), BigInt(c.cost)),
          }))
          .sort((a, b) => compareMinor(b.margin.minorUnits, a.margin.minorUnits));

        const totalRevenue = byItem.reduce((sum, i) => sum + BigInt(i.revenue.minorUnits), 0n);
        const totalCost = byItem.reduce((sum, i) => sum + BigInt(i.cost.minorUnits), 0n);
        const totalLate = byItem.reduce((sum, i) => sum + BigInt(i.lateCharges.minorUnits), 0n);

        return {
          from,
          to,
          currency,
          byItem,
          byCustomer,
          total: {
            ...row(totalRevenue, totalCost),
            lateCharges: money(totalLate),
            invoices: byCustomer.reduce((sum, c) => sum + c.invoices, 0),
          },
        };
      });
    },
  };
}

export type SalesService = ReturnType<typeof createSalesService>;

function compareMinor(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/** An asset: a receivable on terms, or the bank for a cash sale. In any currency. */
async function customerAccount(
  tx: Transactional,
  accountId: string,
): Promise<Result<{ name: string }, LedgerError>> {
  const [row] = await tx
    .select({ name: accounts.name, type: accounts.type, status: accounts.status })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return err({ code: 'account_not_found', accountId });
  if (row.status === 'closed') return err({ code: 'account_closed', accountId });
  if (row.type !== 'asset') {
    return err({ code: 'account_wrong_type', accountId, expected: 'asset', actual: row.type });
  }
  return ok({ name: row.name });
}

/**
 * Revenue is recognised in the books' own currency.
 *
 * The invoice may be in dollars, but the income statement is in dong and the
 * revenue leg is its dong value on the day — which is the IAS 21 answer, and
 * the only one under which later rate movements land in FX gain and loss
 * rather than quietly rewriting what was sold.
 */
async function revenueAccount(
  tx: Transactional,
  accountId: string,
  functional: CurrencyCode,
): Promise<Result<true, LedgerError>> {
  const [row] = await tx
    .select({ type: accounts.type, status: accounts.status, currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!row) return err({ code: 'account_not_found', accountId });
  if (row.status === 'closed') return err({ code: 'account_closed', accountId });
  if (row.type !== 'revenue') {
    return err({ code: 'account_wrong_type', accountId, expected: 'revenue', actual: row.type });
  }
  if (row.currency !== functional) {
    return err({
      code: 'currency_mismatch',
      expected: row.currency as CurrencyCode,
      received: functional,
      accountId,
    });
  }
  return ok(true);
}

/** The rate on the invoice date, both as quoted and as the scaled integer `convert` takes. */
async function dayRate(
  tx: Transactional,
  orgId: string,
  currency: CurrencyCode,
  functional: CurrencyCode,
  on: string,
): Promise<Result<{ quoted: string; scaled: bigint }, LedgerError>> {
  if (currency === functional) return ok({ quoted: '1', scaled: 10n ** 10n });
  const rate = await rateOn(tx, orgId, currency, functional, on);
  if (!rate.ok) return rate;
  const scaled = parseRate(rate.value);
  if (typeof scaled !== 'bigint') {
    return err({ code: 'invalid_fx_rate', accountId: '', rate: rate.value });
  }
  return ok({ quoted: rate.value, scaled });
}

async function describeSale(
  tx: Transactional,
  saleId: string,
  functional: CurrencyCode,
): Promise<SaleSummary | null> {
  const [row] = await tx
    .select({ sale: sales, customerName: accounts.name })
    .from(sales)
    .innerJoin(accounts, eq(accounts.id, sales.customerAccountId))
    .where(eq(sales.id, saleId))
    .limit(1);
  if (!row) return null;
  const { sale } = row;
  const currency = sale.currency as CurrencyCode;
  const base = (value: bigint) => toMoneyDto(value as MinorUnits, functional);
  const invoiced = (value: bigint) => toMoneyDto(value as MinorUnits, currency);

  const movements = await tx
    .select({ movement: inventoryMovements, item: inventoryItems })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .where(eq(inventoryMovements.saleId, saleId))
    .orderBy(asc(inventoryMovements.saleLine));

  const draws = movements.length
    ? await tx
        .select({
          movementId: layerConsumptions.movementId,
          quantity: layerConsumptions.quantityMinor,
          reference: costLayers.reference,
        })
        .from(layerConsumptions)
        .innerJoin(costLayers, eq(costLayers.id, layerConsumptions.layerId))
        .where(
          inArray(
            layerConsumptions.movementId,
            movements.map((m) => m.movement.id),
          ),
        )
        .orderBy(asc(costLayers.acquiredAt), asc(costLayers.id))
    : [];

  const total = marginOf(sale.baseNetMinor, sale.baseCostMinor);

  return {
    id: sale.id,
    reference: sale.reference,
    customerAccountId: sale.customerAccountId,
    customerName: row.customerName,
    occurredAt: sale.occurredAt,
    dueOn: sale.dueOn,
    currency,
    net: invoiced(sale.netMinor),
    tax: invoiced(sale.taxMinor),
    gross: invoiced(sale.grossMinor),
    revenue: base(sale.baseNetMinor),
    cost: base(sale.baseCostMinor),
    margin: base(total.margin),
    marginBasisPoints: total.basisPoints,
    transactionId: sale.transactionId,
    lines: movements.map(({ movement, item }): SaleLine => {
      const revenue = movement.revenueBaseMinor ?? 0n;
      const margin = marginOf(revenue, movement.baseCostMinor);
      return {
        movementId: movement.id,
        itemId: item.id,
        sku: item.sku,
        itemName: item.name,
        unit: item.unit,
        quantityPrecision: item.quantityPrecision,
        quantityMinor: String(movement.quantityMinor),
        revenue: base(revenue),
        cost: base(movement.baseCostMinor),
        margin: base(margin.margin),
        marginBasisPoints: margin.basisPoints,
        drawnFrom: draws
          .filter((d) => d.movementId === movement.id)
          .map((d) => ({ layerReference: d.reference, quantityMinor: String(d.quantity) })),
      };
    }),
  };
}

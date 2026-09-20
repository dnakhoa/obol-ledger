import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { ledgerMessages, type Locale } from '@/lib/i18n';
import {
  allocateCharge,
  type AllocationBasis,
  type ChargeableLayer,
} from '@/server/domain/landed-cost';
import type { LedgerError } from '@/server/domain/errors';
import {
  costLayers,
  inventoryItems,
  landedCostAllocations,
  landedCostCharges,
  organizations,
  shipments,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createJournalService } from './journal';
import { rateOn } from './rates';
import type { MoneyDto, TransactionDto } from './dto';
import { toMoneyDto } from './serialize';

/**
 * Freight, duty and the broker's fee, put where they belong.
 *
 * The lots already exist — migration 0017 made a delivery a quantity at a
 * price. What was missing is everything else on the customs declaration. This
 * takes a charge, spreads it across the lots the shipment brought in, and
 * raises what those lots are carried at.
 *
 * ## The entry
 *
 * A capitalising charge posts, in one entry:
 *
 *     Dr  Inventory      the part landing on stock still held
 *     Dr  Cost of sales  the part attributable to stock already sold
 *       Cr  Payable / bank                                    the whole charge
 *
 * The second debit is not a rounding of the first. A freight invoice routinely
 * turns up six weeks after the container, by which time some of it has
 * shipped. That cost cannot be added to a lot nobody has, and the cost of
 * goods sold it belongs to was posted weeks ago and is append-only — so it
 * goes to cost of sales now, in the period the charge became known. That is
 * both the only option and the right answer.
 *
 * ## What it does not touch
 *
 * `cost_layers.cost_minor` — what was paid to the supplier, in the supplier's
 * currency. That is a fact about one invoice and stays one. Ocean freight is
 * billed in dollars against books kept in dong, and the two cannot be added.
 * The carrying amount that accumulates is the functional-currency one, which
 * is also the only one the ledger asserts anything about.
 */

export type RecordShipmentInput = {
  readonly reference: string;
  readonly arrivedAt?: Date | undefined;
  readonly notes?: string | undefined;
};

export type AddChargeInput = {
  readonly shipmentId: string;
  readonly kind: 'freight' | 'duty' | 'insurance' | 'handling' | 'tax' | 'other';
  readonly description: string;
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  readonly basis: AllocationBasis;
  /** What is credited: the forwarder you owe, or the bank that paid customs. */
  readonly creditAccountId: string;
  /**
   * False for recoverable import VAT, which is reclaimed and so never was a
   * cost. Requires `debitAccountId` — the input-tax asset it goes to instead.
   */
  readonly capitalise?: boolean | undefined;
  readonly debitAccountId?: string | undefined;
  readonly occurredAt?: Date | undefined;
};

export type ChargeLine = {
  readonly layerId: string;
  readonly layerReference: string | null;
  readonly itemName: string;
  readonly amount: MoneyDto;
  readonly toInventory: MoneyDto;
  readonly toCogs: MoneyDto;
};

export type ChargePreview = {
  readonly basis: AllocationBasis;
  readonly amount: MoneyDto;
  readonly toInventory: MoneyDto;
  readonly toCogs: MoneyDto;
  readonly lines: readonly ChargeLine[];
};

export type ChargeResult = {
  readonly preview: ChargePreview;
  readonly entry: TransactionDto;
};

export type ShipmentSummary = {
  readonly id: string;
  readonly reference: string;
  readonly arrivedAt: Date;
  readonly notes: string | null;
  readonly layerCount: number;
  /** What the supplier invoices came to, in the books' own currency. */
  readonly goods: MoneyDto;
  /** What has been added on top: freight, duty, handling. */
  readonly charges: MoneyDto;
  /** Goods plus charges — what the shipment actually cost to land. */
  readonly landed: MoneyDto;
  /** Landed over goods, in basis points, so "21.4%" needs no float. */
  readonly upliftBasisPoints: number;
};

export function createLandedCostService(database: Database, orgId: string) {
  return {
    /** Opens a shipment, which lots and charges then attach to. */
    async record(input: RecordShipmentInput): Promise<Result<{ id: string }, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [existing] = await tx
          .select({ id: shipments.id })
          .from(shipments)
          .where(eq(shipments.reference, input.reference))
          .limit(1);
        if (existing) return err({ code: 'shipment_reference_taken', reference: input.reference });

        const id = newId('shipment');
        await tx.insert(shipments).values({
          id,
          orgId,
          reference: input.reference,
          arrivedAt: input.arrivedAt ?? new Date(),
          notes: input.notes ?? null,
        });
        return ok({ id });
      });
    },

    /**
     * What a charge would do, without doing it.
     *
     * The same computation the real thing runs, so a clean preview means a
     * clean posting — and so somebody can see, before they commit, that the
     * freight is about to add 21% to what the stone is carried at.
     */
    async preview(
      input: Omit<AddChargeInput, 'creditAccountId'>,
    ): Promise<Result<ChargePreview, LedgerError>> {
      return withTenant(database, orgId, (tx) => computePreview(tx, orgId, input));
    },

    /** Posts the charge and raises what the lots are carried at. */
    async addCharge(input: AddChargeInput): Promise<Result<ChargeResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const occurredAt = input.occurredAt ?? new Date();
        const capitalise = input.capitalise ?? true;

        const base = await inFunctional(tx, orgId, input.amount, input.currency, org, occurredAt);
        if (!base.ok) return base;

        // A charge that is not part of the cost of the goods is an ordinary
        // two-line entry against its own account, recorded here so the
        // shipment shows the whole customs declaration rather than most of it.
        if (!capitalise) {
          if (!input.debitAccountId) return err({ code: 'debit_account_required' });
          return postNonCapitalising(tx, orgId, input, base.value, occurredAt, org.locale);
        }

        const preview = await computePreview(tx, orgId, input);
        if (!preview.ok) return preview;

        const layers = await shipmentLayers(tx, input.shipmentId, { lock: true });
        const byLayer = new Map(layers.map((layer) => [layer.id, layer]));

        const chargeId = newId('landedCharge');

        // Grouped by account, because a shipment can carry two items whose
        // stock sits in different accounts, and one entry may not post two
        // legs to the same account.
        const inventoryLegs = new Map<string, bigint>();
        const cogsLegs = new Map<string, bigint>();

        for (const line of preview.value.lines) {
          const layer = byLayer.get(line.layerId);
          if (!layer) continue;
          const toInventory = BigInt(line.toInventory.minorUnits);
          const toCogs = BigInt(line.toCogs.minorUnits);

          if (toInventory !== 0n) {
            inventoryLegs.set(
              layer.inventoryAccountId,
              (inventoryLegs.get(layer.inventoryAccountId) ?? 0n) + toInventory,
            );
          }
          if (toCogs !== 0n) {
            cogsLegs.set(layer.cogsAccountId, (cogsLegs.get(layer.cogsAccountId) ?? 0n) + toCogs);
          }
        }

        const total = base.value.amount;
        const entry = await createJournalService(tx, orgId).postEntry({
          description: ledgerMessages(org.locale).landedCost(input.description),
          currency: org.functionalCurrency,
          occurredAt,
          metadata: { shipment: input.shipmentId, landedCostCharge: chargeId },
          postings: [
            ...[...inventoryLegs].map(([accountId, amount]) => ({
              accountId,
              amount: amount as MinorUnits,
              baseAmount: amount as MinorUnits,
              fxRate: '1',
            })),
            ...[...cogsLegs].map(([accountId, amount]) => ({
              accountId,
              amount: amount as MinorUnits,
              baseAmount: amount as MinorUnits,
              fxRate: '1',
            })),
            {
              accountId: input.creditAccountId,
              amount: -total as MinorUnits,
              baseAmount: -total as MinorUnits,
              fxRate: '1',
            },
          ],
        });
        if (!entry.ok) return entry;

        await tx.insert(landedCostCharges).values({
          id: chargeId,
          orgId,
          shipmentId: input.shipmentId,
          kind: input.kind,
          description: input.description,
          amountMinor: input.amount,
          currency: input.currency,
          fxRate: base.value.rate,
          baseAmountMinor: base.value.amount,
          basis: input.basis,
          capitalise: true,
          toInventoryMinor: BigInt(preview.value.toInventory.minorUnits),
          toCogsMinor: BigInt(preview.value.toCogs.minorUnits),
          transactionId: entry.value.transaction.id,
        });

        for (const line of preview.value.lines) {
          const toInventory = BigInt(line.toInventory.minorUnits);
          const toCogs = BigInt(line.toCogs.minorUnits);

          await tx.insert(landedCostAllocations).values({
            id: newId('landedAllocation'),
            orgId,
            chargeId,
            layerId: line.layerId,
            amountMinor: BigInt(line.amount.minorUnits),
            toInventoryMinor: toInventory,
            toCogsMinor: toCogs,
          });

          // The lot's carrying amount rises by the whole share; what is left
          // of it rises only by the part that landed on stock still held. The
          // CHECK from 0017 refuses the result if those two come apart.
          await tx
            .update(costLayers)
            .set({
              baseCostMinor: sql`${costLayers.baseCostMinor} + ${BigInt(line.amount.minorUnits)}`,
              remainingBaseCostMinor: sql`${costLayers.remainingBaseCostMinor} + ${toInventory}`,
            })
            .where(eq(costLayers.id, line.layerId));
        }

        return ok({ preview: preview.value, entry: entry.value.transaction });
      });
    },

    async shipments(limit = 50): Promise<readonly ShipmentSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(shipments)
          .orderBy(sql`${shipments.arrivedAt} desc`)
          .limit(limit);

        const org = await organisation(tx, orgId);
        const summaries: ShipmentSummary[] = [];

        for (const row of rows) {
          const layers = await shipmentLayers(tx, row.id, { lock: false });
          const [charged] = await tx
            .select({
              total: sql<string>`coalesce(sum(${landedCostCharges.baseAmountMinor}), 0)::text`,
            })
            .from(landedCostCharges)
            .where(
              and(eq(landedCostCharges.shipmentId, row.id), eq(landedCostCharges.capitalise, true)),
            );

          const charges = BigInt(charged?.total ?? '0');
          const landed = layers.reduce((sum, layer) => sum + layer.baseCostMinor, 0n);
          const goods = landed - charges;

          summaries.push({
            id: row.id,
            reference: row.reference,
            arrivedAt: row.arrivedAt,
            notes: row.notes,
            layerCount: layers.length,
            goods: toMoneyDto(goods as MinorUnits, org.functionalCurrency),
            charges: toMoneyDto(charges as MinorUnits, org.functionalCurrency),
            landed: toMoneyDto(landed as MinorUnits, org.functionalCurrency),
            // Basis points rather than a float: "21.43%" is a presentation
            // concern and a percentage of an integer should not become one.
            upliftBasisPoints: goods > 0n ? Number((charges * 10_000n) / goods) : 0,
          });
        }

        return summaries;
      });
    },
  };
}

export type LandedCostService = ReturnType<typeof createLandedCostService>;

type OrgRow = { functionalCurrency: CurrencyCode; locale: Locale };

async function organisation(tx: Transactional, orgId: string): Promise<OrgRow> {
  const [row] = await tx
    .select({ currency: organizations.functionalCurrency, locale: organizations.locale })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return {
    functionalCurrency: (row?.currency ?? 'USD') as CurrencyCode,
    locale: row?.locale ?? 'en',
  };
}

type ShipmentLayer = {
  id: string;
  reference: string | null;
  quantityMinor: bigint;
  remainingQuantityMinor: bigint;
  baseCostMinor: bigint;
  weightGrams: bigint | null;
  unit: string;
  itemName: string;
  inventoryAccountId: string;
  cogsAccountId: string;
};

async function shipmentLayers(
  tx: Transactional,
  shipmentId: string,
  options: { lock: boolean },
): Promise<ShipmentLayer[]> {
  const query = tx
    .select({
      id: costLayers.id,
      reference: costLayers.reference,
      quantityMinor: costLayers.quantityMinor,
      remainingQuantityMinor: costLayers.remainingQuantityMinor,
      baseCostMinor: costLayers.baseCostMinor,
      weightGrams: costLayers.weightGrams,
      unit: inventoryItems.unit,
      itemName: inventoryItems.name,
      inventoryAccountId: inventoryItems.inventoryAccountId,
      cogsAccountId: inventoryItems.cogsAccountId,
    })
    .from(costLayers)
    .innerJoin(inventoryItems, eq(inventoryItems.id, costLayers.itemId))
    .where(eq(costLayers.shipmentId, shipmentId))
    .orderBy(costLayers.acquiredAt, costLayers.id);

  // `FOR UPDATE OF` the lots only: the join brings in items, and locking those
  // would serialise every shipment that touches the same product.
  return options.lock ? query.for('update', { of: costLayers }) : query;
}

async function computePreview(
  tx: Transactional,
  orgId: string,
  input: Omit<AddChargeInput, 'creditAccountId'>,
): Promise<Result<ChargePreview, LedgerError>> {
  const org = await organisation(tx, orgId);
  const occurredAt = input.occurredAt ?? new Date();

  const base = await inFunctional(tx, orgId, input.amount, input.currency, org, occurredAt);
  if (!base.ok) return base;

  const layers = await shipmentLayers(tx, input.shipmentId, { lock: false });

  const allocation = allocateCharge(
    layers.map((layer): ChargeableLayer => ({
      id: layer.id,
      quantity: layer.quantityMinor,
      remainingQuantity: layer.remainingQuantityMinor,
      baseCost: layer.baseCostMinor,
      weight: layer.weightGrams,
      unit: layer.unit,
    })),
    base.value.amount,
    input.basis,
  );

  if (!allocation.ok) {
    switch (allocation.error.code) {
      case 'no_layers':
        return err({ code: 'shipment_has_no_stock', shipmentId: input.shipmentId });
      case 'mixed_units':
        return err({ code: 'mixed_units', units: allocation.error.units });
      case 'weight_missing':
        return err({ code: 'weight_missing', layerIds: allocation.error.layerIds });
      case 'nothing_to_allocate':
        return err({ code: 'zero_amount_posting', index: 0 });
    }
  }

  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const money = (value: bigint) => toMoneyDto(value as MinorUnits, org.functionalCurrency);

  return ok({
    basis: input.basis,
    amount: money(base.value.amount),
    toInventory: money(allocation.value.toInventory),
    toCogs: money(allocation.value.toCogs),
    lines: allocation.value.lines.map((line): ChargeLine => {
      const layer = byId.get(line.layerId);
      return {
        layerId: line.layerId,
        layerReference: layer?.reference ?? null,
        itemName: layer?.itemName ?? '',
        amount: money(line.amount),
        toInventory: money(line.toInventory),
        toCogs: money(line.toCogs),
      };
    }),
  });
}

async function postNonCapitalising(
  tx: Transactional,
  orgId: string,
  input: AddChargeInput,
  base: { amount: bigint; rate: string },
  occurredAt: Date,
  locale: Locale,
): Promise<Result<ChargeResult, LedgerError>> {
  const org = await organisation(tx, orgId);
  const chargeId = newId('landedCharge');

  const entry = await createJournalService(tx, orgId).postEntry({
    description: ledgerMessages(locale).landedCost(input.description),
    currency: org.functionalCurrency,
    occurredAt,
    metadata: { shipment: input.shipmentId, landedCostCharge: chargeId },
    postings: [
      {
        accountId: input.debitAccountId ?? '',
        amount: base.amount as MinorUnits,
        baseAmount: base.amount as MinorUnits,
        fxRate: '1',
      },
      {
        accountId: input.creditAccountId,
        amount: -base.amount as MinorUnits,
        baseAmount: -base.amount as MinorUnits,
        fxRate: '1',
      },
    ],
  });
  if (!entry.ok) return entry;

  await tx.insert(landedCostCharges).values({
    id: chargeId,
    orgId,
    shipmentId: input.shipmentId,
    kind: input.kind,
    description: input.description,
    amountMinor: input.amount,
    currency: input.currency,
    fxRate: base.rate,
    baseAmountMinor: base.amount,
    basis: input.basis,
    capitalise: false,
    debitAccountId: input.debitAccountId ?? null,
    transactionId: entry.value.transaction.id,
  });

  const zero = toMoneyDto(0n as MinorUnits, org.functionalCurrency);
  return ok({
    preview: {
      basis: input.basis,
      amount: toMoneyDto(base.amount as MinorUnits, org.functionalCurrency),
      toInventory: zero,
      toCogs: zero,
      lines: [],
    },
    entry: entry.value.transaction,
  });
}

/** What a charge billed abroad came to in the books' own currency, on its day. */
async function inFunctional(
  tx: Transactional,
  orgId: string,
  amount: bigint,
  currency: CurrencyCode,
  org: OrgRow,
  occurredAt: Date,
): Promise<Result<{ amount: bigint; rate: string }, LedgerError>> {
  if (currency === org.functionalCurrency) return ok({ amount, rate: '1' });

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

import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { landedCostCharges } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * What the stone actually cost to get here.
 *
 * IAS 2 puts the cost of purchase at the price plus import duties and
 * transport. Booking freight as an expense understates inventory and makes
 * every subsequent cost of goods sold wrong by the same margin — which on a
 * container of stone is a fifth of the invoice, not a rounding.
 */
describe('landed cost', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let payable: { id: string };
  let vatInput: { id: string };
  let item: { id: string };
  let shipmentId: string;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);

    stock = await openAccount(db, db.$orgId, { name: 'Inventory', type: 'asset' });
    cogs = await openAccount(db, db.$orgId, { name: 'Cost of Goods Sold', type: 'expense' });
    payable = await openAccount(db, db.$orgId, {
      name: 'Supplier Payable',
      type: 'liability',
      overdraftAllowed: true,
    });
    vatInput = await openAccount(db, db.$orgId, { name: 'Input VAT', type: 'asset' });

    const created = await services.inventory.createItem({
      sku: 'GRN-600',
      name: 'Granite paver 600×600',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!created.ok) throw new Error(created.error.code);
    item = created.value;

    const shipment = await services.landedCost.record({
      reference: 'CONT-4417',
      arrivedAt: on(10),
    });
    if (!shipment.ok) throw new Error(shipment.error.code);
    shipmentId = shipment.value.id;
  });

  /** Two lots on one bill of lading, one worth three times the other. */
  async function twoLots() {
    for (const [quantity, cost, reference] of [
      [600_00n, 30_000_00n, 'LOT-A'],
      [400_00n, 10_000_00n, 'LOT-B'],
    ] as const) {
      const received = await services.inventory.receive({
        itemId: item.id,
        quantity,
        cost,
        currency: 'USD',
        creditAccountId: payable.id,
        occurredAt: on(10),
        reference,
        shipmentId,
      });
      if (!received.ok) throw new Error(received.error.code);
    }
  }

  describe('a freight invoice on a shipment nothing has left yet', () => {
    it('capitalises the whole charge into the lots it covers', async () => {
      await twoLots();

      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Ocean freight, Quy Nhơn to Brisbane',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(12),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Spread by value: three quarters onto the lot worth three times more.
      expect(
        result.value.preview.lines.map((l) => [l.layerReference, l.amount.minorUnits]),
      ).toEqual([
        ['LOT-A', '300000'],
        ['LOT-B', '100000'],
      ]);
      expect(result.value.preview.toCogs.minorUnits).toBe('0');

      // The stock is now carried at what it cost to land, not what the
      // supplier invoiced.
      const ledger = await services.accounts.list();
      expect(ledger.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('4400000');
      expect(ledger.find((a) => a.id === cogs.id)?.balance.minorUnits).toBe('0');

      // And the inventory account still reconciles to the lots behind it.
      const summary = await services.inventory.item(item.id);
      expect(summary?.valueMinor).toBe('4400000');
    });

    it('costs a later shipment at the landed price, not the invoice price', async () => {
      await twoLots();
      await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Ocean freight',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(12),
      });

      // Ship the whole of the first lot. Without landed cost this would cost
      // 30,000; the freight that got it here makes it 33,000.
      const issued = await services.inventory.issue({ itemId: item.id, quantity: 600_00n });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      expect(issued.value.movement.baseCostMinor).toBe('3300000');
    });
  });

  describe('a freight invoice that arrives after some of the stock has sold', () => {
    it('expenses the sold portion instead of adding it to a lot that has gone', async () => {
      await twoLots();

      // Three quarters of LOT-A ships before the freight invoice turns up.
      const issued = await services.inventory.issue({ itemId: item.id, quantity: 450_00n });
      expect(issued.ok).toBe(true);

      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Ocean freight, invoiced late',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(28),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // LOT-A takes 3,000 of the freight and is three quarters gone, so 2,250
      // of that cannot be added to stock nobody has. LOT-B is untouched.
      expect(result.value.preview.toCogs.minorUnits).toBe('225000');
      expect(result.value.preview.toInventory.minorUnits).toBe('175000');

      // One entry, three legs: two debits and the credit for the whole charge.
      // `amount` is the presented figure with a separate direction, so the
      // balance is debits against credits rather than a signed sum.
      const legs = result.value.entry.postings;
      expect(legs).toHaveLength(3);

      const side = (direction: 'debit' | 'credit') =>
        legs
          .filter((leg) => leg.direction === direction)
          .reduce((sum, leg) => sum + BigInt(leg.amount.minorUnits), 0n);

      expect(side('debit')).toBe(4_000_00n);
      expect(side('credit')).toBe(4_000_00n);
    });
  });

  describe('recoverable import VAT', () => {
    it('is not capitalised, because it is reclaimed and so never was a cost', async () => {
      await twoLots();

      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'tax',
        description: 'Import VAT, reclaimable',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        capitalise: false,
        debitAccountId: vatInput.id,
        occurredAt: on(12),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // IAS 2 excludes taxes "subsequently recoverable by the entity". It is
      // an asset against the revenue authority, not part of the stone.
      const ledger = await services.accounts.list();
      expect(ledger.find((a) => a.id === vatInput.id)?.balance.minorUnits).toBe('400000');
      expect(ledger.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('4000000');
      expect(result.value.preview.toInventory.minorUnits).toBe('0');
    });

    it('insists on an account of its own rather than guessing', async () => {
      await twoLots();
      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'tax',
        description: 'Import VAT',
        amount: 100_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        capitalise: false,
      });
      expect(result).toEqual({ ok: false, error: { code: 'debit_account_required' } });
    });
  });

  describe('refusals', () => {
    it('refuses a charge on a shipment with nothing booked against it', async () => {
      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Freight',
        amount: 100_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
      });
      expect(result).toEqual({
        ok: false,
        error: { code: 'shipment_has_no_stock', shipmentId },
      });
    });

    it('refuses a duplicate shipment reference', async () => {
      const again = await services.landedCost.record({ reference: 'CONT-4417' });
      expect(again).toEqual({
        ok: false,
        error: { code: 'shipment_reference_taken', reference: 'CONT-4417' },
      });
    });

    it('refuses to spread by weight when a lot has none recorded', async () => {
      await twoLots();
      const result = await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Freight by weight',
        amount: 100_00n,
        currency: 'USD',
        basis: 'weight',
        creditAccountId: payable.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('weight_missing');
    });
  });

  describe('the shipment view', () => {
    it('says what the goods cost and what it took to land them', async () => {
      await twoLots();
      await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Ocean freight',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(12),
      });

      const [shipment] = await services.landedCost.shipments();
      expect(shipment).toBeDefined();
      if (!shipment) return;

      expect(shipment.goods.minorUnits).toBe('4000000');
      expect(shipment.charges.minorUnits).toBe('400000');
      expect(shipment.landed.minorUnits).toBe('4400000');
      // 10% on top of the invoice, in basis points so no float is involved.
      expect(shipment.upliftBasisPoints).toBe(1000);
    });
  });

  describe('the database has the last word', () => {
    it('refuses a capitalising charge whose halves do not add up to it', async () => {
      await twoLots();
      await services.landedCost.addCharge({
        shipmentId,
        kind: 'freight',
        description: 'Ocean freight',
        amount: 4_000_00n,
        currency: 'USD',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(12),
      });

      // The service reaches this state by construction — both apportionments
      // are exact. This is the independent check, because the arithmetic is
      // not the only thing that can write here.
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.insert(landedCostCharges).values({
            id: 'chrg_broken',
            orgId: db.$orgId,
            shipmentId,
            kind: 'freight',
            description: 'Does not reconcile',
            amountMinor: 100_00n,
            currency: 'USD',
            baseAmountMinor: 100_00n,
            basis: 'value',
            capitalise: true,
            toInventoryMinor: 60_00n,
            toCogsMinor: 30_00n,
            transactionId: 'txn_nope',
          }),
        ),
        /landed_cost_charges_reconciles_check|landed_cost_charges_transaction_fk/u,
      );
    });
  });
});

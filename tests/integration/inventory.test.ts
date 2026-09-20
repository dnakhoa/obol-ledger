import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { costLayers, organizations } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Inventory costing against a real database.
 *
 * The arithmetic is proved in `tests/unit/costing.test.ts`, where it can be
 * checked by hand. What is proved here is everything the arithmetic cannot say
 * on its own: that the cost of goods sold goes through the ordinary journal and
 * therefore balances, that a shipment larger than the yard is refused with
 * nothing written, that the lots a shipment drew from are still knowable
 * afterwards, and that Postgres itself refuses an exhausted lot with money
 * still in it.
 */
describe('inventory costing', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let payable: { id: string };
  let capital: { id: string };

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
    capital = await openAccount(db, db.$orgId, {
      name: 'Owner Capital',
      type: 'equity',
      overdraftAllowed: true,
    });
  });

  async function openItem(
    overrides: Partial<Parameters<typeof services.inventory.createItem>[0]> = {},
  ) {
    const result = await services.inventory.createItem({
      sku: 'GRN-600',
      name: 'Granite paver 600×600',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
      ...overrides,
    });
    if (!result.ok) throw new Error(`could not open item: ${result.error.code}`);
    return result.value;
  }

  /** Three containers at rising prices, the shape every importer has. */
  async function threeContainers(itemId: string) {
    for (const [day, quantity, cost, reference] of [
      [10, 1000_00n, 40_000_00n, 'CONT-4417'],
      [14, 800_00n, 36_000_00n, 'CONT-4482'],
      [22, 1200_00n, 57_600_00n, 'CONT-4510'],
    ] as const) {
      const received = await services.inventory.receive({
        itemId,
        quantity,
        cost,
        currency: 'USD',
        creditAccountId: payable.id,
        occurredAt: on(day),
        reference,
      });
      if (!received.ok) throw new Error(`receipt failed: ${received.error.code}`);
    }
  }

  describe('receiving stock', () => {
    it('posts the purchase and opens the lot together', async () => {
      const item = await openItem();
      const result = await services.inventory.receive({
        itemId: item.id,
        quantity: 1000_00n,
        cost: 40_000_00n,
        currency: 'USD',
        creditAccountId: payable.id,
        occurredAt: on(10),
        reference: 'CONT-4417',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // One ledger entry, balanced like any other.
      expect(result.value.entry.postings).toHaveLength(2);
      expect(result.value.movement.kind).toBe('receipt');

      const summary = await services.inventory.item(item.id);
      expect(summary?.onHandMinor).toBe('100000');
      expect(summary?.valueMinor).toBe('4000000');

      // And the inventory account agrees with the stock records, which is the
      // whole reason the two are written in one transaction.
      const accounts = await services.accounts.list();
      expect(accounts.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('4000000');
    });

    it('refuses to open an item whose stock account is not an asset', async () => {
      const result = await services.inventory.createItem({
        sku: 'BAD',
        name: 'Wrong account',
        unit: 'piece',
        inventoryAccountId: capital.id,
        cogsAccountId: cogs.id,
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: 'account_wrong_type',
          accountId: capital.id,
          expected: 'asset',
          actual: 'equity',
        },
      });
    });

    it('refuses a duplicate item code, because movements name what moved by it', async () => {
      await openItem();
      const again = await services.inventory.createItem({
        sku: 'GRN-600',
        name: 'Something else entirely',
        unit: 'piece',
        inventoryAccountId: stock.id,
        cogsAccountId: cogs.id,
      });
      expect(again).toEqual({ ok: false, error: { code: 'sku_taken', sku: 'GRN-600' } });
    });
  });

  describe('shipping stock', () => {
    it('costs a shipment from the oldest containers and posts it to the ledger', async () => {
      const item = await openItem();
      await threeContainers(item.id);

      const result = await services.inventory.issue({
        itemId: item.id,
        quantity: 1500_00n,
        occurredAt: on(25),
        reference: 'SO-9004',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 1000 at 40.00 plus 500 at 45.00.
      expect(result.value.movement.baseCostMinor).toBe('6250000');

      // Which containers it came from — the question the spreadsheet existed
      // to answer, now a row in a table.
      expect(
        result.value.movement.drawnFrom.map((d) => [d.layerReference, d.quantityMinor]),
      ).toEqual([
        ['CONT-4417', '100000'],
        ['CONT-4482', '50000'],
      ]);

      const accounts = await services.accounts.list();
      expect(accounts.find((a) => a.id === cogs.id)?.balance.minorUnits).toBe('6250000');
      // 133,600 bought, 62,500 shipped.
      expect(accounts.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('7110000');
    });

    it('refuses a shipment bigger than the yard, and writes nothing', async () => {
      const item = await openItem();
      await threeContainers(item.id);

      const result = await services.inventory.issue({
        itemId: item.id,
        quantity: 5000_00n,
        occurredAt: on(25),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({
        code: 'insufficient_stock',
        requested: '500000',
        available: '300000',
        unit: 'm2',
      });

      // Nothing moved. A spreadsheet would have costed this against a negative
      // balance and produced a number indistinguishable from a correct one.
      const accounts = await services.accounts.list();
      expect(accounts.find((a) => a.id === cogs.id)?.balance.minorUnits).toBe('0');
      const movements = await services.inventory.movements(item.id);
      expect(movements.filter((m) => m.kind === 'issue')).toHaveLength(0);
    });

    it('empties a container exactly, leaving no money behind it', async () => {
      const item = await openItem({ sku: 'ODD', quantityPrecision: 0, unit: 'piece' });
      // 7 pieces for 100.01 — a unit cost that is not a number of cents.
      const received = await services.inventory.receive({
        itemId: item.id,
        quantity: 7n,
        cost: 100_01n,
        currency: 'USD',
        creditAccountId: payable.id,
        occurredAt: on(2),
      });
      expect(received.ok).toBe(true);

      for (const take of [2n, 3n, 1n, 1n]) {
        const issued = await services.inventory.issue({ itemId: item.id, quantity: take });
        expect(issued.ok).toBe(true);
      }

      const summary = await services.inventory.item(item.id);
      expect(summary?.onHandMinor).toBe('0');
      expect(summary?.valueMinor).toBe('0');

      // And the account is flat, so the two agree with each other as well as
      // with zero.
      const accounts = await services.accounts.list();
      expect(accounts.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('0');
      expect(accounts.find((a) => a.id === cogs.id)?.balance.minorUnits).toBe('10001');
    });
  });

  describe('specific identification', () => {
    it('ships the named block rather than the oldest one', async () => {
      const item = await openItem({ sku: 'BLOCK', unit: 'block', costingMethod: 'specific' });
      await threeContainers(item.id);

      const lots = await services.inventory.layers(item.id);
      const newest = lots.at(-1);
      expect(newest?.reference).toBe('CONT-4510');

      const result = await services.inventory.issue({
        itemId: item.id,
        quantity: 600_00n,
        layerId: newest?.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.movement.drawnFrom[0]?.layerReference).toBe('CONT-4510');
      // 600 out of a 1200-unit lot that cost 57,600.
      expect(result.value.movement.baseCostMinor).toBe('2880000');
    });

    it('insists the lot be named, because the units are not interchangeable', async () => {
      const item = await openItem({ sku: 'BLOCK', unit: 'block', costingMethod: 'specific' });
      await threeContainers(item.id);

      const result = await services.inventory.issue({ itemId: item.id, quantity: 100_00n });
      expect(result).toEqual({
        ok: false,
        error: { code: 'cost_layer_required', itemId: item.id },
      });
    });
  });

  describe('a foreign purchase is frozen at the rate it arrived at', () => {
    it('carries the dong cost forward however the rate moves afterwards', async () => {
      await db
        .update(organizations)
        .set({ functionalCurrency: 'VND' })
        .where(eq(organizations.id, db.$orgId));

      const vndStock = await openAccount(db, db.$orgId, {
        name: 'Kho hàng',
        type: 'asset',
        currency: 'VND',
      });
      const vndCogs = await openAccount(db, db.$orgId, {
        name: 'Giá vốn hàng bán',
        type: 'expense',
        currency: 'VND',
      });
      const vndPayable = await openAccount(db, db.$orgId, {
        name: 'Phải trả người bán',
        type: 'liability',
        currency: 'VND',
        overdraftAllowed: true,
      });

      await services.rates.record({ base: 'USD', quote: 'VND', rate: '25400', asOf: '2026-01-05' });
      await services.rates.record({ base: 'USD', quote: 'VND', rate: '26100', asOf: '2026-01-20' });

      const created = await services.inventory.createItem({
        sku: 'IMP-1',
        name: 'Imported abrasive',
        unit: 'tonne',
        inventoryAccountId: vndStock.id,
        cogsAccountId: vndCogs.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 10 tonnes for 40,000 USD on the 10th, when the rate was 25,400.
      const received = await services.inventory.receive({
        itemId: created.value.id,
        quantity: 10_000n,
        cost: 40_000_00n,
        currency: 'USD',
        creditAccountId: vndPayable.id,
        occurredAt: on(10),
        reference: 'INV-771',
      });
      expect(received.ok).toBe(true);

      // Shipped on the 25th, after the rate moved to 26,100. The cost of goods
      // sold uses the January-10th rate, because inventory is non-monetary and
      // its carrying amount does not follow the rate. See ADR 12.
      const issued = await services.inventory.issue({
        itemId: created.value.id,
        quantity: 2_500n,
        occurredAt: on(25),
      });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      // A quarter of 40,000 × 25,400 = 254,000,000 dong, not 261,000,000.
      expect(issued.value.movement.baseCostMinor).toBe('254000000');
    });
  });

  describe('the database has the last word', () => {
    it('refuses an exhausted lot that still holds money', async () => {
      const item = await openItem();
      await threeContainers(item.id);
      const [lot] = await services.inventory.layers(item.id);
      expect(lot).toBeDefined();
      if (!lot) return;

      // The service reaches the correct state by construction — the last draw
      // from a lot takes the whole remainder. This is the independent check,
      // because "by construction" is a claim about code and the code is not
      // the only thing that can write here.
      // Through withTenant: row-level security applies to this connection, so
      // an update with no tenant set matches nothing and quietly succeeds —
      // which would make this test pass for the wrong reason.
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx
            .update(costLayers)
            .set({ remainingQuantityMinor: 0n })
            .where(eq(costLayers.id, lot.id)),
        ),
        /cost_layers_empty_is_worthless_check/u,
      );
    });

    it('refuses a lot drawn below zero', async () => {
      const item = await openItem();
      await threeContainers(item.id);
      const [lot] = await services.inventory.layers(item.id);
      if (!lot) return;

      // Emptied of money first, so only one constraint has anything to say:
      // driving the quantity negative while the cost is still there trips the
      // other check as well, and which of the two Postgres reports is not
      // something a test should depend on.
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx
            .update(costLayers)
            .set({
              remainingQuantityMinor: -1n,
              remainingCostMinor: 0n,
              remainingBaseCostMinor: 0n,
            })
            .where(eq(costLayers.id, lot.id)),
        ),
        /cost_layers_remainder_check/u,
      );
    });

    it('refuses LIFO on a chart where it is illegal', async () => {
      // Vietnamese accounting does not include LIFO, and IFRS prohibits it.
      await expectDatabaseError(
        db
          .update(organizations)
          .set({ costingMethod: 'lifo' })
          .where(eq(organizations.id, db.$orgId)),
        /organizations_lifo_is_us_only_check/u,
      );
    });

    it('allows LIFO once the tenant is on the US chart', async () => {
      await db
        .update(organizations)
        .set({ chartTemplate: 'us_gaap', costingMethod: 'lifo' })
        .where(eq(organizations.id, db.$orgId));

      const item = await openItem();
      await threeContainers(item.id);

      const result = await services.inventory.issue({ itemId: item.id, quantity: 1500_00n });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The newest containers first: 1200 at 48.00 plus 300 at 45.00. FIFO
      // costed the same shipment at 62,500 — $8,600 of profit between the two
      // answers, which is why one of them is not available everywhere.
      expect(result.value.movement.baseCostMinor).toBe('7110000');
      expect(result.value.movement.drawnFrom.map((d) => d.layerReference)).toEqual([
        'CONT-4482',
        'CONT-4510',
      ]);
    });
  });
});

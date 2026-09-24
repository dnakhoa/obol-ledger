import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { inventoryMovements } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Stock that leaves without being sold.
 *
 * A pallet broken on the forklift, a carton past its date, a stocktake that
 * finds fewer square metres than the lots claim. Each leaves at cost, drawn
 * from the lots by the item's own method, into an expense the business chose —
 * and each records why, because shrinkage hiding in cost of sales is shrinkage
 * nobody can see growing.
 */
describe('write-offs', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let shrinkage: { id: string };
  let payable: { id: string };
  let itemId: string;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));
  const balanceOf = async (id: string) =>
    (await services.accounts.list()).find((a) => a.id === id)?.balance.minorUnits;

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    stock = await openAccount(db, db.$orgId, { name: 'Inventory', type: 'asset' });
    cogs = await openAccount(db, db.$orgId, { name: 'Cost of Goods Sold', type: 'expense' });
    shrinkage = await openAccount(db, db.$orgId, { name: 'Stock losses', type: 'expense' });
    payable = await openAccount(db, db.$orgId, {
      name: 'Supplier Payable',
      type: 'liability',
      overdraftAllowed: true,
    });
    const item = await services.inventory.createItem({
      sku: 'PAV-400',
      name: 'Paver 400×400',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!item.ok) throw new Error(item.error.code);
    itemId = item.value.id;

    for (const [quantity, cost, reference, day] of [
      [100_00n, 2_000_00n, 'CONT-A', 2],
      [100_00n, 3_000_00n, 'CONT-B', 3],
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
      if (!received.ok) throw new Error(received.error.code);
    }
  });

  it('writes stock off at cost, from the lots, into the chosen expense', async () => {
    const result = await services.inventory.writeOff({
      itemId,
      quantity: 150_00n,
      reason: 'count_shortfall',
      expenseAccountId: shrinkage.id,
      occurredAt: on(31),
      reference: 'KK-2026-01',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // FIFO: all of A at 20.00 and half of B at 30.00.
    expect(result.value.movement).toMatchObject({
      kind: 'writeoff',
      reason: 'count_shortfall',
      baseCostMinor: '350000',
    });
    expect(result.value.movement.drawnFrom.map((d) => d.layerReference)).toEqual([
      'CONT-A',
      'CONT-B',
    ]);

    // Into the expense the business chose — not cost of sales.
    expect(await balanceOf(shrinkage.id)).toBe('350000');
    expect(await balanceOf(cogs.id)).toBe('0');

    // And the stock records and the account still agree.
    const summary = await services.inventory.item(itemId);
    expect(summary?.onHandMinor).toBe('5000');
    expect(summary?.valueMinor).toBe('150000');
    expect(await balanceOf(stock.id)).toBe('150000');

    expect(result.value.entry.metadata).toMatchObject({ writeOffReason: 'count_shortfall' });
  });

  it('refuses to write off more than the lots hold', async () => {
    const result = await services.inventory.writeOff({
      itemId,
      quantity: 250_00n,
      reason: 'lost',
      expenseAccountId: shrinkage.id,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'insufficient_stock', requested: '25000', available: '20000' },
    });
    expect(await balanceOf(shrinkage.id)).toBe('0');
  });

  it('refuses to put a loss anywhere but an expense', async () => {
    const result = await services.inventory.writeOff({
      itemId,
      quantity: 1_00n,
      reason: 'damaged',
      expenseAccountId: payable.id,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'account_wrong_type', expected: 'expense', actual: 'liability' },
    });
  });

  it('is refused by the database without a reason, and a sale with one', async () => {
    const written = await services.inventory.writeOff({
      itemId,
      quantity: 1_00n,
      reason: 'damaged',
      expenseAccountId: shrinkage.id,
    });
    if (!written.ok) throw new Error(written.error.code);
    const [row] = await withTenant(db, db.$orgId, (tx) =>
      tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.id, written.value.movement.id)),
    );
    if (!row) throw new Error('no movement');

    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.insert(inventoryMovements).values({ ...row, id: 'move_forged_1', reason: null }),
      ),
      /inventory_movements_writeoff_reason_check/u,
    );
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.insert(inventoryMovements).values({ ...row, id: 'move_forged_2', kind: 'issue' }),
      ),
      /inventory_movements_writeoff_reason_check/u,
    );
  });
});

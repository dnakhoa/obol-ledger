import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLivePostgres, LIVE_DATABASE_URL, type LivePostgres } from '../helpers/live-postgres';
import { createAccountService } from '@/server/services/accounts';
import { createInventoryService } from '@/server/services/inventory';
import { createSalesService } from '@/server/services/sales';

/**
 * Two invoices for the last container, raised at the same moment.
 *
 * A sale reads the open lots, decides which it draws on, and writes the draw
 * down — read, then write. Two sales computed concurrently would both find the
 * container available and both ship it, and the second would fail on the
 * layer's CHECK only by luck of timing, or not at all if the draws were
 * partial. The service locks the open lots `FOR UPDATE` before allocating, so
 * the second waits, then sees the first one's result and is refused.
 *
 * Delete the `lock: true` in `sales.ts` and this goes red.
 */
const suite = LIVE_DATABASE_URL ? describe : describe.skip;

suite('concurrent sales of the same stock', () => {
  let live: LivePostgres;
  let itemId: string;
  let customerId: string;
  let revenueId: string;

  beforeAll(async () => {
    live = await createLivePostgres();
    const accounts = createAccountService(live.database, live.orgId);
    const open = (name: string, type: 'asset' | 'expense' | 'revenue' | 'liability') =>
      accounts.create({ name, type, currency: 'USD', overdraftAllowed: type !== 'asset' });

    const stock = await open('Inventory', 'asset');
    const cogs = await open('Cost of goods sold', 'expense');
    const payable = await open('Supplier', 'liability');
    const customer = await accounts.create({
      name: 'Customer',
      type: 'asset',
      currency: 'USD',
      openItems: true,
    });
    const revenue = await open('Sales', 'revenue');
    customerId = customer.id;
    revenueId = revenue.id;

    const inventory = createInventoryService(live.database, live.orgId);
    const item = await inventory.createItem({
      sku: 'PAV-400',
      name: 'Paver',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!item.ok) throw new Error(item.error.code);
    itemId = item.value.id;

    const received = await inventory.receive({
      itemId,
      quantity: 1000_00n,
      cost: 20_000_00n,
      currency: 'USD',
      creditAccountId: payable.id,
      reference: 'CONT-LAST',
    });
    if (!received.ok) throw new Error(received.error.code);
  }, 60_000);

  afterAll(async () => {
    await live?.close();
  });

  it('ships the container once, and refuses the second invoice', async () => {
    const sell = (reference: string) =>
      createSalesService(live.database, live.orgId).sell({
        reference,
        customerAccountId: customerId,
        revenueAccountId: revenueId,
        currency: 'USD',
        lines: [{ itemId, quantity: 700_00n, amount: 21_000_00n }],
      });

    const results = await Promise.all([sell('INV-A'), sell('INV-B'), sell('INV-C')]);
    const sold = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    expect(sold).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const result of refused) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'insufficient_stock', available: '30000' },
      });
    }

    const summary = await createInventoryService(live.database, live.orgId).item(itemId);
    expect(summary?.onHandMinor).toBe('30000');
    expect(summary?.valueMinor).toBe('600000');
  });
});

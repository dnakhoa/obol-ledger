import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { newId } from '@/lib/id';
import { transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * The entries the stock records wrote cannot be unwritten from the journal.
 *
 * A receipt posts to the inventory account *and* opens a lot, in one
 * transaction, and the whole value of the stock module is that the two agree.
 * The journal's reverse button negates the entry and nothing else: the account
 * goes back to zero while the lot still says 800 m² are in the yard, and from
 * then on every cost of goods sold drawn from that lot is posted against stock
 * the account no longer carries. Nothing would ever object, because the entry
 * and its reversal both balance.
 *
 * So the reversal is refused, by the service with an explanation and by the
 * database because the service is not the only thing that can write a row.
 */
describe('entries the stock records wrote', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let payable: { id: string };
  let itemId: string;

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
    const item = await services.inventory.createItem({
      sku: 'PAV-400',
      name: 'Paver 400×400',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!item.ok) throw new Error(item.error.code);
    itemId = item.value.id;
  });

  async function receipt() {
    const received = await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 20_000_00n,
      currency: 'USD',
      creditAccountId: payable.id,
      occurredAt: on(10),
      reference: 'CONT-4417',
    });
    if (!received.ok) throw new Error(received.error.code);
    return received.value;
  }

  it('refuses to reverse a receipt from the journal, and says why', async () => {
    const { entry } = await receipt();

    const reversed = await services.journal.reverseEntry({ transactionId: entry.id });
    expect(reversed).toEqual({
      ok: false,
      error: { code: 'entry_owned_by_stock', transactionId: entry.id, source: 'inventory' },
    });

    // The lot and the account still agree.
    const summary = await services.inventory.item(itemId);
    const account = (await services.accounts.list()).find((a) => a.id === stock.id);
    expect(summary?.valueMinor).toBe('2000000');
    expect(account?.balance.minorUnits).toBe('2000000');
  });

  it('refuses to reverse the cost of goods sold, which would un-sell nothing', async () => {
    await receipt();
    const issued = await services.inventory.issue({
      itemId,
      quantity: 100_00n,
      occurredAt: on(12),
    });
    if (!issued.ok) throw new Error(issued.error.code);

    const reversed = await services.journal.reverseEntry({ transactionId: issued.value.entry.id });
    expect(reversed.ok).toBe(false);
    if (reversed.ok) return;
    expect(reversed.error.code).toBe('entry_owned_by_stock');
  });

  it('refuses to reverse a landed-cost charge, which raised what the lots carry', async () => {
    const shipment = await services.landedCost.record({ reference: 'BL-1', arrivedAt: on(10) });
    if (!shipment.ok) throw new Error(shipment.error.code);
    await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 20_000_00n,
      currency: 'USD',
      creditAccountId: payable.id,
      occurredAt: on(10),
      shipmentId: shipment.value.id,
    });
    const charge = await services.landedCost.addCharge({
      shipmentId: shipment.value.id,
      kind: 'freight',
      description: 'Ocean freight',
      amount: 1_000_00n,
      currency: 'USD',
      basis: 'value',
      creditAccountId: payable.id,
      occurredAt: on(11),
    });
    if (!charge.ok) throw new Error(charge.error.code);

    const reversed = await services.journal.reverseEntry({
      transactionId: charge.value.entry.id,
    });
    expect(reversed).toEqual({
      ok: false,
      error: {
        code: 'entry_owned_by_stock',
        transactionId: charge.value.entry.id,
        source: 'landed_cost',
      },
    });
  });

  it('is refused by the database too, for the writer that is not the service', async () => {
    const { entry } = await receipt();

    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.insert(transactions).values({
          id: newId('transaction'),
          orgId: db.$orgId,
          description: 'Reversal typed in psql',
          currency: 'USD',
          occurredAt: on(11),
          reversesTransactionId: entry.id,
        }),
      ),
      /stock records/u,
    );
  });

  it('still lets an ordinary entry be reversed', async () => {
    const posted = await services.journal.postEntry({
      description: 'Sample tile for a showroom',
      currency: 'USD',
      occurredAt: on(3),
      postings: [
        { accountId: cogs.id, amount: 1_000n as never },
        { accountId: payable.id, amount: -1_000n as never },
      ],
    });
    if (!posted.ok) throw new Error(posted.error.code);
    const [row] = await withTenant(db, db.$orgId, (tx) =>
      tx.select().from(transactions).where(eq(transactions.id, posted.value.transaction.id)),
    );
    expect(row).toBeDefined();

    const reversed = await services.journal.reverseEntry({
      transactionId: posted.value.transaction.id,
    });
    expect(reversed.ok).toBe(true);
  });

  describe('reconciling the lots to the account', () => {
    it('agrees when every entry on the account came from the stock records', async () => {
      await receipt();
      const issued = await services.inventory.issue({
        itemId,
        quantity: 300_00n,
        occurredAt: on(12),
      });
      if (!issued.ok) throw new Error(issued.error.code);

      const report = await services.inventory.reconcile();
      expect(report.agrees).toBe(true);
      expect(report.accounts).toHaveLength(1);
      expect(report.accounts[0]).toMatchObject({
        accountId: stock.id,
        items: 1,
        ledger: { minorUnits: '1250000' },
        lots: { minorUnits: '1250000' },
        difference: { minorUnits: '0' },
        unexplained: [],
      });
    });

    it('names the hand-typed entry that pulled them apart', async () => {
      await receipt();
      // A year-end accrual typed straight onto the stock account. The ledger
      // balances; the lots have no idea it happened.
      const typed = await services.journal.postEntry({
        description: 'Accrued freight, estimate',
        currency: 'USD',
        occurredAt: on(31),
        postings: [
          { accountId: stock.id, amount: 45_000n as never },
          { accountId: payable.id, amount: -45_000n as never },
        ],
      });
      if (!typed.ok) throw new Error(typed.error.code);

      const report = await services.inventory.reconcile();
      expect(report.agrees).toBe(false);
      expect(report.accounts[0]).toMatchObject({
        ledger: { minorUnits: '2045000' },
        lots: { minorUnits: '2000000' },
        difference: { minorUnits: '45000' },
      });
      expect(report.accounts[0]?.unexplained).toEqual([
        expect.objectContaining({
          transactionId: typed.value.transaction.id,
          description: 'Accrued freight, estimate',
          amount: expect.objectContaining({ minorUnits: '45000' }),
        }),
      ]);
    });
  });
});

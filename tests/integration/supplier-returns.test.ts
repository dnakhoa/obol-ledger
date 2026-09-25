import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { accounts, organizations, postings, taxEntries } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Returns to a supplier: part of a delivery going back.
 *
 * A stone importer on a dong ledger buys pavers locally and from a quarry
 * abroad, lands freight on the foreign container, and sends some of each
 * back. What is proved is what a hand-typed entry gets wrong: the goods leave
 * the lot they came in, at what it carries them at; the supplier's account
 * comes down by its own price at the rate the delivery was bought at; the
 * freight nobody refunds lands in an expense rather than in stock that has
 * gone; input tax comes back out on the month's return; and nothing — through
 * the service or around it — refunds more than was paid.
 */
describe('supplier returns', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let freightLoss: { id: string };
  let payable: { id: string };
  let payableUsd: { id: string };
  let inputVat: { id: string };
  let vat10: string;
  let pavers: string;
  let localLot: string;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

  async function residual(): Promise<string | undefined> {
    return withTenant(db, db.$orgId, async (tx) => {
      const [row] = await tx
        .select({ residual: sql<string>`coalesce(sum(${accounts.baseBalanceMinor}), 0)::text` })
        .from(accounts);
      return row?.residual;
    });
  }

  async function legsOf(transactionId: string) {
    const rows = await withTenant(db, db.$orgId, (tx) =>
      tx
        .select({
          accountId: postings.accountId,
          amount: postings.amountMinor,
          base: postings.baseAmountMinor,
        })
        .from(postings)
        .where(eq(postings.transactionId, transactionId)),
    );
    return Object.fromEntries(rows.map((row) => [row.accountId, [row.amount, row.base]]));
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));
    services = servicesFor(db, db.$orgId);

    const vnd = { currency: 'VND' as const };
    stock = await openAccount(db, db.$orgId, { name: '156 Hàng hóa', type: 'asset', ...vnd });
    cogs = await openAccount(db, db.$orgId, { name: '632 Giá vốn', type: 'expense', ...vnd });
    freightLoss = await openAccount(db, db.$orgId, {
      name: '811 Chi phí khác',
      type: 'expense',
      ...vnd,
    });
    payable = await openAccount(db, db.$orgId, {
      name: '331 Đá Bình Định',
      type: 'liability',
      openItems: true,
      overdraftAllowed: true,
      ...vnd,
    });
    payableUsd = await openAccount(db, db.$orgId, {
      name: '331 Pietra Italia',
      type: 'liability',
      currency: 'USD',
      overdraftAllowed: true,
    });
    inputVat = await openAccount(db, db.$orgId, {
      name: '1331 Thuế GTGT được khấu trừ',
      type: 'asset',
      overdraftAllowed: true,
      ...vnd,
    });
    const outputVat = await openAccount(db, db.$orgId, {
      name: '33311 Thuế GTGT đầu ra',
      type: 'liability',
      overdraftAllowed: true,
      ...vnd,
    });

    await services.rates.record({ base: 'USD', quote: 'VND', rate: '25400', asOf: '2026-01-01' });

    const ten = await services.tax.create({
      name: 'GTGT 10%',
      rateBasisPoints: 1000,
      treatment: 'vat',
      inputAccountId: inputVat.id,
      outputAccountId: outputVat.id,
    });
    if (!ten.ok) throw new Error('tax code');
    vat10 = ten.value.id;

    const paver = await services.inventory.createItem({
      sku: 'PAV-400',
      name: 'Đá lát 400×400',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!paver.ok) throw new Error('item');
    pavers = paver.value.id;

    const received = await services.inventory.receive({
      itemId: pavers,
      quantity: 1000_00n,
      cost: 200_000_000n,
      currency: 'VND',
      creditAccountId: payable.id,
      occurredAt: on(2),
      reference: 'BD-0412',
      metadata: { invoice: 'BD-0412' },
    });
    if (!received.ok) throw new Error(received.error.code);
    const lots = await services.inventory.layers(pavers);
    localLot = lots[0]?.id ?? '';
  });

  it('takes the goods out of their lot and the refund off the supplier', async () => {
    const returned = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 100_00n,
      reference: 'RTV-001',
      reason: 'Cracked on arrival',
      occurredAt: on(5),
    });
    if (!returned.ok) throw new Error(returned.error.code);
    const { supplierReturn, entry } = returned.value;

    // Its own price, and nothing unrecovered: no freight ever landed here.
    expect(supplierReturn).toMatchObject({
      reference: 'RTV-001',
      counterpartyAccountId: payable.id,
      quantityMinor: '10000',
      refund: { minorUnits: '20000000', currency: 'VND' },
      carrying: { minorUnits: '20000000' },
      unrecovered: { minorUnits: '0' },
      expenseAccountId: null,
    });
    expect(await legsOf(entry.id)).toEqual({
      [payable.id]: [20_000_000n, 20_000_000n],
      [stock.id]: [-20_000_000n, -20_000_000n],
    });

    const [lot] = await services.inventory.layers(pavers);
    expect(lot).toMatchObject({ remainingQuantityMinor: '90000', remainingCostMinor: '180000000' });
    expect((await services.inventory.reconcile()).agrees).toBe(true);
    expect(await residual()).toBe('0');

    const [movement] = await services.inventory.movements(pavers, 1);
    expect(movement).toMatchObject({ kind: 'supplier_return', reference: 'RTV-001' });

    // Clears the supplier's own invoice for the delivery.
    const aged = await services.aging.report('liability', on(10));
    const items = aged.accounts.find((a) => a.accountId === payable.id)?.items ?? [];
    expect(items.map((item) => [item.reference, item.outstanding.minorUnits])).toEqual([
      ['BD-0412', '180000000'],
    ]);
  });

  it('reverses the input tax, on the month it went back', async () => {
    const returned = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 50_00n,
      reference: 'RTV-VAT',
      taxCodeId: vat10,
      occurredAt: on(20),
    });
    if (!returned.ok) throw new Error(returned.error.code);
    expect(returned.value.supplierReturn).toMatchObject({
      refund: { minorUnits: '10000000' },
      tax: { minorUnits: '1000000' },
      gross: { minorUnits: '11000000' },
    });
    expect(await legsOf(returned.value.entry.id)).toEqual({
      [payable.id]: [11_000_000n, 11_000_000n],
      [stock.id]: [-10_000_000n, -10_000_000n],
      [inputVat.id]: [-1_000_000n, -1_000_000n],
    });

    const rows = await withTenant(db, db.$orgId, (tx) =>
      tx
        .select({ supply: taxEntries.supply, base: taxEntries.baseMinor, tax: taxEntries.taxMinor })
        .from(taxEntries)
        .where(eq(taxEntries.transactionId, returned.value.entry.id)),
    );
    expect(rows).toEqual([{ supply: 'purchase', base: -10_000_000n, tax: -1_000_000n }]);
    expect(await residual()).toBe('0');
  });

  it('sends freight nobody refunds to an expense, at the rate the lot was bought at', async () => {
    const shipment = await services.landedCost.record({ reference: 'MSKU-1', arrivedAt: on(3) });
    if (!shipment.ok) throw new Error(shipment.error.code);
    const received = await services.inventory.receive({
      itemId: pavers,
      quantity: 1000_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableUsd.id,
      occurredAt: on(3),
      reference: 'MSKU-1',
      shipmentId: shipment.value.id,
    });
    if (!received.ok) throw new Error(received.error.code);
    const charged = await services.landedCost.addCharge({
      shipmentId: shipment.value.id,
      kind: 'freight',
      description: 'Ocean freight',
      amount: 50_800_000n,
      currency: 'VND',
      basis: 'value',
      creditAccountId: payable.id,
      occurredAt: on(4),
    });
    if (!charged.ok) throw new Error(charged.error.code);
    const foreignLot = (await services.inventory.layers(pavers)).find(
      (lot) => lot.reference === 'MSKU-1',
    );

    // The dollar has moved since; the return ignores it.
    await services.rates.record({ base: 'USD', quote: 'VND', rate: '26000', asOf: '2026-01-15' });

    const returned = await services.supplierReturns.returnToSupplier({
      layerId: foreignLot?.id ?? '',
      quantity: 100_00n,
      reference: 'RTV-USD',
      expenseAccountId: freightLoss.id,
      occurredAt: on(20),
    });
    if (!returned.ok) throw new Error(returned.error.code);

    // 4,000 dollars at 25,400 back from the supplier; a tenth of the
    // 1,066,800,000 the lot carried; the 5,080,000 of freight in between.
    expect(returned.value.supplierReturn).toMatchObject({
      counterpartyAccountId: payableUsd.id,
      refund: { minorUnits: '400000', currency: 'USD' },
      carrying: { minorUnits: '106680000', currency: 'VND' },
      unrecovered: { minorUnits: '5080000' },
      expenseAccountId: freightLoss.id,
    });
    expect(await legsOf(returned.value.entry.id)).toEqual({
      [payableUsd.id]: [400_000n, 101_600_000n],
      [freightLoss.id]: [5_080_000n, 5_080_000n],
      [stock.id]: [-106_680_000n, -106_680_000n],
    });
    expect((await services.inventory.reconcile()).agrees).toBe(true);
    expect(await residual()).toBe('0');
  });

  it('empties a lot in instalments to exactly nothing', async () => {
    const odd = await services.inventory.receive({
      itemId: pavers,
      quantity: 3n,
      cost: 1_000_001n,
      currency: 'VND',
      creditAccountId: payable.id,
      occurredAt: on(6),
      reference: 'ODD',
    });
    if (!odd.ok) throw new Error(odd.error.code);
    const lot = (await services.inventory.layers(pavers)).find((l) => l.reference === 'ODD');

    let refunded = 0n;
    for (const n of [1, 2, 3]) {
      const returned = await services.supplierReturns.returnToSupplier({
        layerId: lot?.id ?? '',
        quantity: 1n,
        reference: `RTV-ODD-${n}`,
        occurredAt: on(7),
      });
      if (!returned.ok) throw new Error(returned.error.code);
      expect(returned.value.supplierReturn.unrecovered.minorUnits).toBe('0');
      refunded += BigInt(returned.value.supplierReturn.refund.minorUnits);
    }
    expect(refunded).toBe(1_000_001n);
    expect((await services.inventory.layers(pavers)).some((l) => l.reference === 'ODD')).toBe(
      false,
    );
    expect((await services.inventory.reconcile()).agrees).toBe(true);
  });

  it('refuses what cannot be true, and says what can', async () => {
    const tooMany = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 1001_00n,
      reference: 'RTV-X1',
      occurredAt: on(5),
    });
    expect(tooMany).toMatchObject({
      ok: false,
      error: { code: 'supplier_return_exceeds_lot', remaining: '100000', requested: '100100' },
    });

    const tooMuch = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 1_00n,
      refund: 200_000_001n,
      reference: 'RTV-X2',
      occurredAt: on(5),
    });
    expect(tooMuch).toMatchObject({
      ok: false,
      error: { code: 'supplier_refund_exceeds_lot', remaining: '200000000', currency: 'VND' },
    });

    const early = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 1_00n,
      reference: 'RTV-X3',
      occurredAt: on(1),
    });
    expect(early).toMatchObject({ ok: false, error: { code: 'supplier_return_before_receipt' } });

    const first = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 1_00n,
      reference: 'RTV-X4',
      occurredAt: on(5),
    });
    expect(first.ok).toBe(true);
    const again = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 1_00n,
      reference: 'RTV-X4',
      occurredAt: on(5),
    });
    expect(again).toMatchObject({
      ok: false,
      error: { code: 'supplier_return_reference_taken' },
    });

    // A partial refund leaves the rest in the named expense.
    const restocking = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 10_00n,
      refund: 1_500_000n,
      expenseAccountId: freightLoss.id,
      reference: 'RTV-X5',
      occurredAt: on(5),
    });
    expect(restocking).toMatchObject({
      ok: true,
      value: { supplierReturn: { unrecovered: { minorUnits: '500000' } } },
    });
    expect(await residual()).toBe('0');
  });

  it('is refused by the database when a writer goes around the service', async () => {
    const returned = await services.supplierReturns.returnToSupplier({
      layerId: localLot,
      quantity: 10_00n,
      reference: 'RTV-DB',
      occurredAt: on(5),
    });
    if (!returned.ok) throw new Error(returned.error.code);
    const { supplierReturn, entry } = returned.value;
    // A second return, forged in SQL, refunding more than the delivery cost.
    await expectDatabaseError(
      withTenant(db, db.$orgId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO inventory_movements
            (id, org_id, item_id, kind, quantity_minor, cost_minor, base_cost_minor,
             occurred_at, transaction_id, costing_method)
          VALUES ('move_forged_issue', ${db.$orgId}, ${pavers}, 'issue', 1, 0, 0, now(),
                  ${entry.id}, 'fifo')
        `);
        await tx.execute(sql`
          INSERT INTO supplier_returns
            (id, org_id, reference, item_id, layer_id, movement_id, counterparty_account_id,
             currency, fx_rate, quantity_minor, refund_minor, refund_base_minor,
             carrying_base_minor, unrecovered_base_minor, occurred_at, transaction_id)
          VALUES ('sret_forged', ${db.$orgId}, 'RTV-FORGED', ${pavers}, ${localLot},
                  'move_forged_issue', ${payable.id}, 'VND', 1, 1, 200000000, 0, 0, 0, now(),
                  ${entry.id})
        `);
      }),
      /a refund cannot exceed what was paid/,
    );

    // Goods leaving for a supplier with no return saying so.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO inventory_movements
            (id, org_id, item_id, kind, quantity_minor, cost_minor, base_cost_minor,
             occurred_at, transaction_id, costing_method)
          VALUES ('move_forged', ${db.$orgId}, ${pavers}, 'supplier_return', 1, 0, 0, now(),
                  ${entry.id}, 'fifo')
        `),
      ),
      /no return recorded/,
    );

    // History stays history.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(
          sql`UPDATE supplier_returns SET refund_minor = 1 WHERE id = ${supplierReturn.id}`,
        ),
      ),
      /append-only/,
    );

    const reversed = await services.journal.reverseEntry({ transactionId: entry.id });
    expect(reversed).toMatchObject({
      ok: false,
      error: { code: 'entry_owned_by_stock', source: 'inventory' },
    });
  });
});

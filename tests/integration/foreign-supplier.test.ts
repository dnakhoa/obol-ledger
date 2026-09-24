import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { organizations } from '@/server/db/schema';

/**
 * Buying stock from a supplier who invoices in dollars, on a ledger kept in dong.
 *
 * This is the importer's ordinary day, and the one the README opens its FX
 * section with: a 40,000 USD invoice booked at 25,400 and paid three weeks later
 * at 25,700. The payable has to hold *forty thousand dollars* — not a billion
 * dong written into a dollar account — or the settlement, the revaluation and
 * the aged payables are all computed from a number nobody owes.
 *
 * Until this suite existed, `receive` and the landed-cost charges wrote the
 * functional amount into whatever account they were given. A dong payable
 * masked it; a dollar one recorded 10,160,000.00 USD owed on a 40,000 USD
 * invoice, and the ledger balanced, because the functional total did.
 */
describe('a foreign supplier on a dong ledger', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let payableUsd: { id: string };
  let payableEur: { id: string };
  let payableVnd: { id: string };
  let bankUsd: { id: string };
  let fxLoss: { id: string };
  let itemId: string;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

  beforeEach(async () => {
    db = await createTestDatabase();
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));
    services = servicesFor(db, db.$orgId);

    stock = await openAccount(db, db.$orgId, { name: 'Hàng hóa', type: 'asset', currency: 'VND' });
    cogs = await openAccount(db, db.$orgId, {
      name: 'Giá vốn hàng bán',
      type: 'expense',
      currency: 'VND',
    });
    payableUsd = await openAccount(db, db.$orgId, {
      name: 'Phải trả người bán (USD)',
      type: 'liability',
      currency: 'USD',
      overdraftAllowed: true,
    });
    payableEur = await openAccount(db, db.$orgId, {
      name: 'Phải trả người bán (EUR)',
      type: 'liability',
      currency: 'EUR',
      overdraftAllowed: true,
    });
    payableVnd = await openAccount(db, db.$orgId, {
      name: 'Phải trả người bán',
      type: 'liability',
      currency: 'VND',
      overdraftAllowed: true,
    });
    bankUsd = await openAccount(db, db.$orgId, {
      name: 'Vietcombank USD',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    fxLoss = await openAccount(db, db.$orgId, {
      name: 'Chênh lệch tỷ giá',
      type: 'expense',
      currency: 'VND',
      overdraftAllowed: true,
      role: 'fx_gain_loss',
    });

    for (const [asOf, rate] of [
      ['2026-01-10', '25400'],
      ['2026-01-31', '25700'],
    ] as const) {
      const recorded = await services.rates.record({ base: 'USD', quote: 'VND', rate, asOf });
      if (!recorded.ok) throw new Error(recorded.error.code);
    }

    const item = await services.inventory.createItem({
      sku: 'MRB-CAR',
      name: 'Marble Carrara',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!item.ok) throw new Error(item.error.code);
    itemId = item.value.id;
  });

  const balanceOf = async (id: string) => {
    const account = (await services.accounts.list()).find((a) => a.id === id);
    return account?.balance.minorUnits;
  };

  it('owes the supplier forty thousand dollars, not a billion dong written as dollars', async () => {
    const received = await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableUsd.id,
      occurredAt: on(10),
      reference: 'CONT-IT-2207',
    });
    expect(received.ok).toBe(true);
    if (!received.ok) return;

    // The payable is in dollars and holds the invoice. (Balances read
    // normal-side positive, so a liability owed is a positive figure.)
    expect(await balanceOf(payableUsd.id)).toBe('4000000');
    // The stock is in dong, at the rate on the day it arrived.
    expect(await balanceOf(stock.id)).toBe('1016000000');

    // And the leg says what it was worth, so revaluation and settlement start
    // from the rate the invoice was booked at.
    const leg = received.value.entry.postings.find((p) => p.accountId === payableUsd.id);
    expect(leg?.direction).toBe('credit');
    expect(leg?.amount).toMatchObject({ amount: '40000.00', currency: 'USD' });
    expect(leg?.baseAmount).toMatchObject({ minorUnits: '1016000000', currency: 'VND' });
    // At the rate a person would quote. The journal used to derive 254 here,
    // dividing minor units by minor units.
    expect(leg?.fxRate).toBe('25400');
  });

  it('books the exchange loss when the invoice is paid at a worse rate', async () => {
    await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableUsd.id,
      occurredAt: on(10),
    });

    // Paid three weeks later at 25,700: the dollars cancel exactly, the dong
    // differ by twelve million, and that difference is the importer's loss.
    const paid = await services.journal.postEntry({
      description: 'Thanh toán CONT-IT-2207',
      currency: 'VND',
      occurredAt: on(31),
      fxAdjustment: true,
      postings: [
        {
          accountId: payableUsd.id,
          amount: 4_000_000n as never,
          baseAmount: 1_016_000_000n as never,
        },
        {
          accountId: bankUsd.id,
          amount: -4_000_000n as never,
          baseAmount: -1_028_000_000n as never,
        },
      ],
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;

    // Each leg records the rate its two amounts imply, as a person quotes it.
    const rates = Object.fromEntries(
      paid.value.transaction.postings.map((p) => [p.accountId, p.fxRate]),
    );
    expect(rates[payableUsd.id]).toBe('25400');
    expect(rates[bankUsd.id]).toBe('25700');

    expect(await balanceOf(payableUsd.id)).toBe('0');
    expect(await balanceOf(fxLoss.id)).toBe('12000000');
  });

  it('still accepts a dong payable, converting at the rate on the day', async () => {
    const received = await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableVnd.id,
      occurredAt: on(10),
    });
    expect(received.ok).toBe(true);
    expect(await balanceOf(payableVnd.id)).toBe('1016000000');
  });

  it('refuses a payable in a third currency rather than guess a cross rate', async () => {
    const received = await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableEur.id,
      occurredAt: on(10),
    });
    expect(received).toEqual({
      ok: false,
      error: {
        code: 'currency_mismatch',
        expected: 'EUR',
        received: 'USD',
        accountId: payableEur.id,
      },
    });
    // Nothing was written: no lot, no entry.
    const summary = await services.inventory.item(itemId);
    expect(summary?.onHandMinor).toBe('0');
  });

  it('bills dollar freight to the dollar payable, and capitalises its dong value', async () => {
    const shipment = await services.landedCost.record({
      reference: 'CONT-IT-2207',
      arrivedAt: on(10),
    });
    if (!shipment.ok) throw new Error(shipment.error.code);

    await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableUsd.id,
      occurredAt: on(10),
      shipmentId: shipment.value.id,
    });

    const charged = await services.landedCost.addCharge({
      shipmentId: shipment.value.id,
      kind: 'freight',
      description: 'Ocean freight, Genoa to Cát Lái',
      amount: 2_000_00n,
      currency: 'USD',
      basis: 'value',
      creditAccountId: payableUsd.id,
      occurredAt: on(10),
    });
    expect(charged.ok).toBe(true);

    expect(await balanceOf(payableUsd.id)).toBe('4200000');
    expect(await balanceOf(stock.id)).toBe(String(1_016_000_000 + 50_800_000));
  });

  it('bills recoverable import VAT in dong without touching the stock', async () => {
    const vatInput = await openAccount(db, db.$orgId, {
      name: 'Thuế GTGT được khấu trừ',
      type: 'asset',
      currency: 'VND',
    });
    const shipment = await services.landedCost.record({ reference: 'TK-1029', arrivedAt: on(10) });
    if (!shipment.ok) throw new Error(shipment.error.code);
    await services.inventory.receive({
      itemId,
      quantity: 800_00n,
      cost: 40_000_00n,
      currency: 'USD',
      creditAccountId: payableUsd.id,
      occurredAt: on(10),
      shipmentId: shipment.value.id,
    });

    // Import VAT assessed in dollars on the declaration and paid to customs
    // from the dollar account.
    const charged = await services.landedCost.addCharge({
      shipmentId: shipment.value.id,
      kind: 'tax',
      description: 'Import VAT',
      amount: 4_000_00n,
      currency: 'USD',
      basis: 'value',
      capitalise: false,
      debitAccountId: vatInput.id,
      creditAccountId: bankUsd.id,
      occurredAt: on(10),
    });
    expect(charged.ok).toBe(true);
    expect(await balanceOf(bankUsd.id)).toBe('-400000');
    expect(await balanceOf(vatInput.id)).toBe('101600000');
    expect(await balanceOf(stock.id)).toBe('1016000000');
  });
});

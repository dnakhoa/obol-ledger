import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { organizations, taxEntries } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { SaleSummary } from '@/server/services/sales';

/**
 * Credit notes: taking back part of a sale.
 *
 * A stone distributor on a dong ledger sells 1,500 m² of pavers drawn from
 * two containers bought at two prices, and some of it comes back. What is
 * proved here is what a hand-typed correcting entry gets wrong: the goods go
 * back into the lots they left from and at the cost they left at, the output
 * tax comes back on the month's return, the credit clears its own invoice
 * rather than the oldest one, a sale credited in instalments ends at exactly
 * zero, and nothing — through the service or around it — can take back more
 * than was sold.
 */
describe('credit notes', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let revenue: { id: string };
  let deductions: { id: string };
  let customer: { id: string };
  let buyerUsd: { id: string };
  let outputVat: { id: string };
  let vat10: string;
  let pavers: string;
  let sale: SaleSummary;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

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
    revenue = await openAccount(db, db.$orgId, {
      name: '511 Doanh thu',
      type: 'revenue',
      overdraftAllowed: true,
      ...vnd,
    });
    deductions = await openAccount(db, db.$orgId, {
      name: '5212 Hàng bán bị trả lại',
      type: 'revenue',
      overdraftAllowed: true,
      ...vnd,
    });
    customer = await openAccount(db, db.$orgId, {
      name: '131 Công ty Xây dựng Hòa Bình',
      type: 'asset',
      openItems: true,
      overdraftAllowed: true,
      ...vnd,
    });
    buyerUsd = await openAccount(db, db.$orgId, {
      name: '131 Southern Landscape Supplies',
      type: 'asset',
      currency: 'USD',
      openItems: true,
      overdraftAllowed: true,
    });
    const payable = await openAccount(db, db.$orgId, {
      name: '331 Phải trả người bán',
      type: 'liability',
      overdraftAllowed: true,
      ...vnd,
    });
    outputVat = await openAccount(db, db.$orgId, {
      name: '33311 Thuế GTGT đầu ra',
      type: 'liability',
      overdraftAllowed: true,
      ...vnd,
    });
    const inputVat = await openAccount(db, db.$orgId, {
      name: '1331 Thuế GTGT được khấu trừ',
      type: 'asset',
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

    for (const [cost, reference, day] of [
      [200_000_000n, 'CONT-A', 2],
      [250_000_000n, 'CONT-B', 3],
    ] as const) {
      const received = await services.inventory.receive({
        itemId: pavers,
        quantity: 1000_00n,
        cost,
        currency: 'VND',
        creditAccountId: payable.id,
        occurredAt: on(day),
        reference,
      });
      if (!received.ok) throw new Error(received.error.code);
    }

    // 1,500 m²: all of CONT-A at 200k and 500 of CONT-B at 250k.
    const sold = await services.sales.sell({
      reference: 'HD-0001',
      customerAccountId: customer.id,
      revenueAccountId: revenue.id,
      currency: 'VND',
      taxCodeId: vat10,
      occurredAt: on(10),
      lines: [{ itemId: pavers, quantity: 1500_00n, amount: 450_000_000n }],
    });
    if (!sold.ok) throw new Error(sold.error.code);
    sale = sold.value.sale;
  });

  const balanceOf = async (id: string) =>
    (await services.accounts.list()).find((a) => a.id === id)?.balance.minorUnits;
  const line = () => sale.lines[0]!.movementId;
  const layers = async () =>
    (await services.inventory.layers(pavers)).map((layer) => [
      layer.reference,
      layer.remainingQuantityMinor,
      layer.remainingBaseCostMinor,
    ]);

  it('puts returned goods back into the lot they left from, at the cost they left at', async () => {
    // CONT-A is spent, so only CONT-B is listed as open.
    expect(await layers()).toEqual([['CONT-B', '50000', '125000000']]);

    // 200 m² come back cracked-in-transit: 60,000,000 net, 6,000,000 VAT.
    const result = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-0001',
      revenueAccountId: deductions.id,
      reason: 'Cracked in transit',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 200_00n, amount: 60_000_000n }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const note = result.value.creditNote;

    // The newest lot the line reached into is the first one refilled, at
    // CONT-B's 250,000 a square metre — not at an average, not at today's.
    expect(await layers()).toEqual([['CONT-B', '70000', '175000000']]);
    expect(note.cost.minorUnits).toBe('50000000');
    expect(note.tax.minorUnits).toBe('6000000');
    expect(note.gross.minorUnits).toBe('66000000');

    // The customer owes 66m less; revenue comes back out through 5212; the
    // output VAT is reduced; stock and cost of sales move by the goods.
    expect(await balanceOf(customer.id)).toBe(String(495_000_000 - 66_000_000));
    expect(await balanceOf(deductions.id)).toBe('-60000000');
    expect(await balanceOf(outputVat.id)).toBe(String(45_000_000 - 6_000_000));
    expect(await balanceOf(stock.id)).toBe(String(125_000_000 + 50_000_000));
    expect(await balanceOf(cogs.id)).toBe(String(325_000_000 - 50_000_000));

    // Stock and its accounts still agree, item by item.
    expect((await services.inventory.reconcile()).agrees).toBe(true);

    // The sale shows its correction beside what was invoiced.
    const after = await services.sales.get(sale.id);
    expect(after?.gross.minorUnits).toBe('495000000');
    expect(after?.credited.gross.minorUnits).toBe('66000000');
    expect(after?.netRevenue.minorUnits).toBe('390000000');
    expect(after?.netCost.minorUnits).toBe('275000000');
    expect(after?.lines[0]?.creditedQuantityMinor).toBe('20000');
    expect(after?.creditNotes.map((n) => n.reference)).toEqual(['CN-0001']);
  });

  it('lands the tax on the return for the month it was issued, as a negative', async () => {
    const result = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-0002',
      occurredAt: new Date(Date.UTC(2026, 1, 3)),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 45_000_000n }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await withTenant(db, db.$orgId, (tx) =>
      tx
        .select({ base: taxEntries.baseMinor, tax: taxEntries.taxMinor })
        .from(taxEntries)
        .where(eq(taxEntries.transactionId, result.value.entry.id)),
    );
    expect(rows).toEqual([{ base: -45_000_000n, tax: -4_500_000n }]);

    // A price allowance moves no stock at all.
    expect(result.value.creditNote.cost.minorUnits).toBe('0');
    expect(await layers()).toEqual([['CONT-B', '50000', '125000000']]);
  });

  it('ends at exactly zero when a sale is credited in instalments', async () => {
    // A sale of 3 at a price that does not divide evenly, credited in thirds.
    const odd = await services.sales.sell({
      reference: 'HD-0002',
      customerAccountId: customer.id,
      revenueAccountId: revenue.id,
      currency: 'VND',
      taxCodeId: vat10,
      occurredAt: on(11),
      lines: [{ itemId: pavers, quantity: 3_00n, amount: 1_000_001n }],
    });
    if (!odd.ok) throw new Error(odd.error.code);
    const movementId = odd.value.sale.lines[0]!.movementId;
    const before = await balanceOf(customer.id);

    for (const [n, amount] of [
      [1, 333_333n],
      [2, 333_334n],
      [3, 333_334n],
    ] as const) {
      const credited = await services.creditNotes.issue({
        saleId: odd.value.sale.id,
        reference: `CN-1${n}`,
        occurredAt: on(12),
        lines: [{ saleMovementId: movementId, quantity: 1_00n, amount }],
      });
      expect(credited.ok, `instalment ${n}`).toBe(true);
    }

    const after = await services.sales.get(odd.value.sale.id);
    expect(after?.credited.net.minorUnits).toBe(after?.net.minorUnits);
    expect(after?.credited.tax.minorUnits).toBe(after?.tax.minorUnits);
    expect(after?.netRevenue.minorUnits).toBe('0');
    expect(after?.netCost.minorUnits).toBe('0');
    expect(BigInt(before!) - BigInt((await balanceOf(customer.id))!)).toBe(
      BigInt(after!.gross.minorUnits),
    );
  });

  it('refuses to take back more than was sold', async () => {
    const tooMany = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X1',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 1500_01n, amount: 1n }],
    });
    expect(tooMany).toMatchObject({
      ok: false,
      error: {
        code: 'credit_exceeds_sale',
        limit: 'quantity',
        remaining: '150000',
        sku: 'PAV-400',
      },
    });

    const first = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X2',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 400_000_000n }],
    });
    expect(first.ok).toBe(true);

    // The second is capped by what the first already took.
    const tooMuch = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X3',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 50_000_001n }],
    });
    expect(tooMuch).toMatchObject({
      ok: false,
      error: { code: 'credit_exceeds_sale', limit: 'amount', remaining: '50000000' },
    });

    const early = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X4',
      occurredAt: on(9),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 1n }],
    });
    expect(early).toMatchObject({ ok: false, error: { code: 'credit_before_sale' } });

    const taken = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X2',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 1n }],
    });
    expect(taken).toMatchObject({ ok: false, error: { code: 'credit_note_reference_taken' } });

    const empty = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-X5',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 0n }],
    });
    expect(empty).toMatchObject({ ok: false, error: { code: 'credit_note_has_no_lines' } });
  });

  it('is refused by the database when a writer goes around the service', async () => {
    const issued = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-DB',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 1_000n }],
    });
    if (!issued.ok) throw new Error(issued.error.code);
    const noteId = issued.value.creditNote.id;

    // A second note, forged in SQL, crediting more revenue than the invoice
    // line earned — which the line cap refuses whatever the header says.
    await expectDatabaseError(
      withTenant(db, db.$orgId, async (tx) => {
        await tx.execute(sql`
          INSERT INTO credit_notes
            (id, org_id, reference, sale_id, currency, fx_rate, revenue_account_id,
             net_minor, tax_minor, gross_minor, base_net_minor, base_tax_minor,
             base_cost_minor, occurred_at, transaction_id)
          VALUES ('cn_forged', ${db.$orgId}, 'CN-FORGED', ${sale.id}, 'VND', 1, ${revenue.id},
                  1, 0, 1, 450000000, 0, 0, now(), ${issued.value.entry.id})
        `);
        await tx.execute(sql`
          INSERT INTO credit_note_lines
            (id, org_id, credit_note_id, sale_id, line, sale_movement_id,
             quantity_minor, amount_minor, revenue_base_minor, base_cost_minor)
          VALUES ('cnl_forged', ${db.$orgId}, 'cn_forged', ${sale.id}, 1, ${line()},
                  0, 1, 450000000, 0)
        `);
      }),
      /earned 450000000 and credit notes would take back/,
    );

    // History stays history.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE credit_notes SET net_minor = 1 WHERE id = ${noteId}`),
      ),
      /append-only/,
    );

    // And the entry it posted cannot be reversed from the journal, which
    // would leave the note claiming a credit the books no longer hold.
    const reversed = await services.journal.reverseEntry({
      transactionId: issued.value.entry.id,
    });
    expect(reversed).toMatchObject({
      ok: false,
      error: { code: 'entry_owned_by_stock', source: 'credit_note' },
    });
  });

  it('settles against its own invoice, not the oldest one', async () => {
    const older = await services.sales.sell({
      reference: 'HD-0000',
      customerAccountId: customer.id,
      revenueAccountId: revenue.id,
      currency: 'VND',
      occurredAt: on(5),
      lines: [{ itemId: pavers, quantity: 10_00n, amount: 5_000_000n }],
    });
    if (!older.ok) throw new Error(older.error.code);

    const credited = await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-AGE',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 0n, amount: 10_000_000n }],
    });
    expect(credited.ok).toBe(true);

    const aged = await services.aging.report('asset', on(25));
    const items = aged.accounts.find((a) => a.accountId === customer.id)?.items ?? [];
    expect(items.map((item) => [item.reference, item.outstanding.minorUnits])).toEqual([
      ['HD-0000', '5000000'],
      ['HD-0001', String(495_000_000 - 11_000_000)],
    ]);
  });

  it('credits a foreign invoice at the rate it was raised at', async () => {
    const exported = await services.sales.sell({
      reference: 'EX-0001',
      customerAccountId: buyerUsd.id,
      revenueAccountId: revenue.id,
      currency: 'USD',
      occurredAt: on(12),
      lines: [{ itemId: pavers, quantity: 100_00n, amount: 3_000_00n }],
    });
    if (!exported.ok) throw new Error(exported.error.code);

    // The dollar has moved since; the credit ignores it.
    await services.rates.record({ base: 'USD', quote: 'VND', rate: '26000', asOf: '2026-01-15' });

    const credited = await services.creditNotes.issue({
      saleId: exported.value.sale.id,
      reference: 'CN-USD',
      occurredAt: on(20),
      lines: [
        {
          saleMovementId: exported.value.sale.lines[0]!.movementId,
          quantity: 0n,
          amount: 1_000_00n,
        },
      ],
    });
    expect(credited.ok).toBe(true);
    if (!credited.ok) return;

    expect(credited.value.creditNote.gross).toMatchObject({
      minorUnits: '100000',
      currency: 'USD',
    });
    // 1,000 dollars at 25,400, the invoice's rate — not at 26,000.
    expect(credited.value.creditNote.revenue.minorUnits).toBe('25400000');
    expect(await balanceOf(buyerUsd.id)).toBe('200000');
  });

  it('comes off the margin report in the month it was issued', async () => {
    await services.creditNotes.issue({
      saleId: sale.id,
      reference: 'CN-M',
      occurredAt: on(20),
      lines: [{ saleMovementId: line(), quantity: 200_00n, amount: 60_000_000n }],
    });

    const january = await services.sales.margins(on(1), new Date(Date.UTC(2026, 1, 1)));
    expect(january.total.revenue.minorUnits).toBe('390000000');
    expect(january.total.cost.minorUnits).toBe('275000000');
    expect(january.byItem[0]?.quantitySoldMinor).toBe('130000');
    expect(january.byCustomer[0]?.revenue.minorUnits).toBe('390000000');
  });
});

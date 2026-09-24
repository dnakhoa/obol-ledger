import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { newId } from '@/lib/id';
import { organizations, sales, taxEntries } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Selling stock, and knowing what was made on it.
 *
 * A distributor on a dong ledger: pavers bought in two containers at two
 * prices, sold domestically with 10% VAT and exported in dollars at 0%. The
 * properties proved here are the ones a spreadsheet beside the ledger gets
 * wrong: the invoice and its cost land in one entry; two lines of one product
 * do not both draw the oldest container; the dollar receivable holds dollars;
 * and the margin reports reconcile to the revenue and cost-of-sales accounts
 * rather than to a parallel set of figures.
 */
describe('sales', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let revenue: { id: string };
  let revenueUsd: { id: string };
  let customer: { id: string };
  let buyerUsd: { id: string };
  let payable: { id: string };
  let outputVat: { id: string };
  let inputVat: { id: string };
  let vat10: string;
  let vat0: string;
  let pavers: string;
  let tiles: string;

  const on = (day: number) => new Date(Date.UTC(2026, 0, day, 10, 0, 0));
  const JANUARY = [on(1), new Date(Date.UTC(2026, 1, 1))] as const;

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
    revenueUsd = await openAccount(db, db.$orgId, {
      name: 'Revenue kept in dollars',
      type: 'revenue',
      currency: 'USD',
      overdraftAllowed: true,
    });
    customer = await openAccount(db, db.$orgId, {
      name: '131 Công ty Xây dựng Hòa Bình',
      type: 'asset',
      openItems: true,
      ...vnd,
    });
    buyerUsd = await openAccount(db, db.$orgId, {
      name: '131 Southern Landscape Supplies',
      type: 'asset',
      currency: 'USD',
      openItems: true,
    });
    payable = await openAccount(db, db.$orgId, {
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
    inputVat = await openAccount(db, db.$orgId, {
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
    const zero = await services.tax.create({
      name: 'GTGT 0% xuất khẩu',
      rateBasisPoints: 0,
      treatment: 'vat',
      inputAccountId: inputVat.id,
      outputAccountId: outputVat.id,
    });
    if (!ten.ok || !zero.ok) throw new Error('tax codes');
    vat10 = ten.value.id;
    vat0 = zero.value.id;

    const paver = await services.inventory.createItem({
      sku: 'PAV-400',
      name: 'Đá lát 400×400',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    const tile = await services.inventory.createItem({
      sku: 'TIL-600',
      name: 'Gạch 600×600',
      unit: 'piece',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!paver.ok || !tile.ok) throw new Error('items');
    pavers = paver.value.id;
    tiles = tile.value.id;

    // Two containers of pavers at two prices, and one of tiles.
    for (const [itemId, quantity, cost, reference, day] of [
      [pavers, 1000_00n, 200_000_000n, 'CONT-A', 2],
      [pavers, 1000_00n, 250_000_000n, 'CONT-B', 3],
      [tiles, 500n, 50_000_000n, 'CONT-T', 3],
    ] as const) {
      const received = await services.inventory.receive({
        itemId,
        quantity,
        cost,
        currency: 'VND',
        creditAccountId: payable.id,
        occurredAt: on(day),
        reference,
      });
      if (!received.ok) throw new Error(received.error.code);
    }
  });

  const balanceOf = async (id: string) =>
    (await services.accounts.list()).find((a) => a.id === id)?.balance.minorUnits;

  describe('a domestic invoice with VAT', () => {
    it('posts the invoice and its cost in one entry, and knows the margin', async () => {
      const result = await services.sales.sell({
        reference: 'HD-0001',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        taxCodeId: vat10,
        occurredAt: on(10),
        dueOn: '2026-03-11',
        lines: [
          // Two lines of the same paver: 600 then 900 m². Together they
          // must take all of CONT-A and 500 of CONT-B — not 1,500 of A.
          { itemId: pavers, quantity: 600_00n, amount: 180_000_000n },
          { itemId: pavers, quantity: 900_00n, amount: 270_000_000n },
          { itemId: tiles, quantity: 100n, amount: 16_000_000n },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { sale, entry } = result.value;

      // Net 466,000,000; VAT 46,600,000; the customer owes the gross.
      expect(sale.gross.minorUnits).toBe('512600000');
      expect(await balanceOf(customer.id)).toBe('512600000');
      expect(await balanceOf(revenue.id)).toBe('466000000');
      expect(await balanceOf(outputVat.id)).toBe('46600000');

      // FIFO across both lines: 1,000 of A at 200k plus 500 of B at 250k,
      // plus 100 tiles at 100k.
      const cost = 200_000_000 + 125_000_000 + 10_000_000;
      expect(sale.cost.minorUnits).toBe(String(cost));
      expect(await balanceOf(cogs.id)).toBe(String(cost));
      expect(await balanceOf(stock.id)).toBe(String(500_000_000 - cost));

      // The margin, per invoice and per line.
      expect(sale.margin.minorUnits).toBe(String(466_000_000 - cost));
      expect(sale.marginBasisPoints).toBe(2811);
      expect(sale.lines.map((l) => [l.sku, l.revenue.minorUnits, l.cost.minorUnits])).toEqual([
        ['PAV-400', '180000000', '120000000'],
        ['PAV-400', '270000000', '205000000'],
        ['TIL-600', '16000000', '10000000'],
      ]);
      expect(sale.lines[1]?.drawnFrom.map((d) => [d.layerReference, d.quantityMinor])).toEqual([
        ['CONT-A', '40000'],
        ['CONT-B', '50000'],
      ]);

      // One entry. The cost legs share accounts across items and are netted,
      // because an entry may not post twice to one account.
      expect(entry.postings.map((p) => p.accountId).sort()).toEqual(
        [customer.id, revenue.id, outputVat.id, cogs.id, stock.id].sort(),
      );
      expect(entry.metadata).toMatchObject({ invoice: 'HD-0001', dueDate: '2026-03-11' });

      // And the tax return sees it.
      const rows = await withTenant(db, db.$orgId, (tx) =>
        tx.select().from(taxEntries).where(eq(taxEntries.transactionId, entry.id)),
      );
      expect(rows.map((r) => [r.supply, r.baseMinor, r.taxMinor])).toEqual([
        ['sale', 466_000_000n, 46_600_000n],
      ]);
    });

    it('ships nothing and posts nothing when any line is short', async () => {
      const result = await services.sales.sell({
        reference: 'HD-0002',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        occurredAt: on(10),
        lines: [
          { itemId: pavers, quantity: 1500_00n, amount: 450_000_000n },
          // Only 500 m² are left after the first line.
          { itemId: pavers, quantity: 600_00n, amount: 180_000_000n },
        ],
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'insufficient_stock', requested: '60000', available: '50000' },
      });

      expect(await balanceOf(customer.id)).toBe('0');
      expect((await services.inventory.item(pavers))?.onHandMinor).toBe('200000');
      expect(await services.sales.list()).toHaveLength(0);
    });

    it('issues an invoice number once', async () => {
      const line = { itemId: tiles, quantity: 10n, amount: 1_600_000n };
      const first = await services.sales.sell({
        reference: 'HD-0003',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [line],
      });
      expect(first.ok).toBe(true);
      const again = await services.sales.sell({
        reference: 'HD-0003',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [line],
      });
      expect(again).toEqual({
        ok: false,
        error: { code: 'sale_reference_taken', reference: 'HD-0003' },
      });
    });

    it('takes its due date from the customer’s terms when it states none', async () => {
      const onSixty = await services.accounts.open({
        name: '131 Nhà thầu Hà Nội (60 ngày)',
        type: 'asset',
        currency: 'VND',
        openItems: true,
        paymentTermsDays: 60,
      });
      if (!onSixty.ok) throw new Error(onSixty.error.code);

      const sold = await services.sales.sell({
        reference: 'HD-0008',
        customerAccountId: onSixty.value.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        occurredAt: on(10),
        lines: [{ itemId: tiles, quantity: 10n, amount: 1_600_000n }],
      });
      if (!sold.ok) throw new Error(sold.error.code);
      // Written onto the invoice, so changing the customer's terms later
      // cannot make this one retrospectively on time.
      expect(sold.value.sale.dueOn).toBe('2026-03-11');
      expect(sold.value.entry.metadata).toMatchObject({ dueDate: '2026-03-11' });
    });

    it('refuses a due date before the invoice', async () => {
      const result = await services.sales.sell({
        reference: 'HD-0004',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        occurredAt: on(10),
        dueOn: '2025-02-10',
        lines: [{ itemId: tiles, quantity: 1n, amount: 160_000n }],
      });
      expect(result).toEqual({
        ok: false,
        error: { code: 'due_before_invoice', dueOn: '2025-02-10', invoicedOn: '2026-01-10' },
      });
    });

    it('refuses a sale to a supplier account, and revenue kept in a foreign currency', async () => {
      const toSupplier = await services.sales.sell({
        reference: 'HD-0005',
        customerAccountId: payable.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [{ itemId: tiles, quantity: 1n, amount: 160_000n }],
      });
      expect(toSupplier).toMatchObject({
        ok: false,
        error: { code: 'account_wrong_type', expected: 'asset', actual: 'liability' },
      });

      const foreignRevenue = await services.sales.sell({
        reference: 'HD-0006',
        customerAccountId: customer.id,
        revenueAccountId: revenueUsd.id,
        currency: 'VND',
        lines: [{ itemId: tiles, quantity: 1n, amount: 160_000n }],
      });
      expect(foreignRevenue).toMatchObject({
        ok: false,
        error: { code: 'currency_mismatch', expected: 'USD', received: 'VND' },
      });
    });

    it('cannot be unwound from the journal, which would un-ship nothing', async () => {
      const sold = await services.sales.sell({
        reference: 'HD-0007',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [{ itemId: tiles, quantity: 10n, amount: 1_600_000n }],
      });
      if (!sold.ok) throw new Error(sold.error.code);
      const reversed = await services.journal.reverseEntry({
        transactionId: sold.value.entry.id,
      });
      expect(reversed).toMatchObject({ ok: false, error: { code: 'entry_owned_by_stock' } });
    });
  });

  describe('an export invoice in dollars', () => {
    it('holds dollars on the buyer, dong in revenue, and 0% on the return', async () => {
      const result = await services.sales.sell({
        reference: 'INV-2607',
        customerAccountId: buyerUsd.id,
        revenueAccountId: revenue.id,
        currency: 'USD',
        taxCodeId: vat0,
        occurredAt: on(12),
        dueOn: '2026-02-11',
        lines: [{ itemId: pavers, quantity: 1000_00n, amount: 12_000_00n }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 12,000.00 USD owed by the buyer, in dollars.
      expect(await balanceOf(buyerUsd.id)).toBe('1200000');
      // Revenue at 25,400 on the day.
      expect(await balanceOf(revenue.id)).toBe('304800000');
      expect(await balanceOf(outputVat.id)).toBe('0');

      const { sale, entry } = result.value;
      expect(sale.net).toMatchObject({ amount: '12000.00', currency: 'USD' });
      expect(sale.revenue).toMatchObject({ minorUnits: '304800000', currency: 'VND' });
      expect(sale.cost.minorUnits).toBe('200000000');
      expect(sale.margin.minorUnits).toBe('104800000');

      const leg = entry.postings.find((p) => p.accountId === buyerUsd.id);
      expect(leg).toMatchObject({ direction: 'debit', fxRate: '25400' });

      const rows = await withTenant(db, db.$orgId, (tx) =>
        tx.select().from(taxEntries).where(eq(taxEntries.transactionId, entry.id)),
      );
      expect(rows.map((r) => [r.supply, r.baseMinor, r.taxMinor])).toEqual([
        ['sale', 304_800_000n, 0n],
      ]);
    });

    it('refuses a buyer account in a third currency rather than guess a cross rate', async () => {
      const buyerEur = await openAccount(db, db.$orgId, {
        name: '131 Pietra GmbH',
        type: 'asset',
        currency: 'EUR',
      });
      const result = await services.sales.sell({
        reference: 'INV-2608',
        customerAccountId: buyerEur.id,
        revenueAccountId: revenue.id,
        currency: 'USD',
        lines: [{ itemId: tiles, quantity: 10n, amount: 400_00n }],
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'currency_mismatch', expected: 'EUR', received: 'USD' },
      });
    });
  });

  describe('margin reporting', () => {
    it('reconciles to the revenue and cost-of-sales accounts, late freight included', async () => {
      // A shipment whose freight invoice arrives after half the stock is sold.
      const shipment = await services.landedCost.record({ reference: 'BL-77', arrivedAt: on(4) });
      if (!shipment.ok) throw new Error(shipment.error.code);
      const received = await services.inventory.receive({
        itemId: tiles,
        quantity: 200n,
        cost: 20_000_000n,
        currency: 'VND',
        creditAccountId: payable.id,
        occurredAt: on(4),
        reference: 'CONT-T2',
        shipmentId: shipment.value.id,
      });
      if (!received.ok) throw new Error(received.error.code);

      for (const [reference, customerId, currency, lines, day] of [
        [
          'HD-0101',
          customer.id,
          'VND',
          [{ itemId: pavers, quantity: 500_00n, amount: 150_000_000n }],
          10,
        ],
        [
          'INV-2609',
          buyerUsd.id,
          'USD',
          [{ itemId: pavers, quantity: 800_00n, amount: 9_000_00n }],
          11,
        ],
        // All 700 tiles: the 500 of CONT-T and the 200 that came on BL-77.
        [
          'HD-0102',
          customer.id,
          'VND',
          [{ itemId: tiles, quantity: 700n, amount: 105_000_000n }],
          12,
        ],
      ] as const) {
        const sold = await services.sales.sell({
          reference,
          customerAccountId: customerId,
          revenueAccountId: revenue.id,
          currency,
          occurredAt: on(day),
          lines: [...lines],
        });
        if (!sold.ok) throw new Error(`${reference}: ${sold.error.code}`);
      }

      // Freight on BL-77 arrives after every tile has gone: all of it to
      // cost of sales, none to stock.
      const freight = await services.landedCost.addCharge({
        shipmentId: shipment.value.id,
        kind: 'freight',
        description: 'Trucking from Cát Lái',
        amount: 3_000_000n,
        currency: 'VND',
        basis: 'value',
        creditAccountId: payable.id,
        occurredAt: on(20),
      });
      if (!freight.ok) throw new Error(freight.error.code);

      const report = await services.sales.margins(...JANUARY);

      expect(report.total.invoices).toBe(3);
      expect(report.total.lateCharges.minorUnits).toBe('3000000');

      // The report's revenue and cost are the ledger's revenue and cost.
      expect(report.total.revenue.minorUnits).toBe(await balanceOf(revenue.id));
      expect(report.total.cost.minorUnits).toBe(await balanceOf(cogs.id));

      const tilesRow = report.byItem.find((row) => row.sku === 'TIL-600');
      expect(tilesRow).toMatchObject({
        quantitySoldMinor: '700',
        lateCharges: { minorUnits: '3000000' },
        // 50,000,000 + 20,000,000 from the lots, plus the late freight.
        cost: { minorUnits: '73000000' },
        revenue: { minorUnits: '105000000' },
        margin: { minorUnits: '32000000' },
      });

      // By customer, the two domestic invoices together and the export alone.
      expect(
        report.byCustomer.map((row) => [row.name, row.invoices, row.revenue.minorUnits]),
      ).toEqual(
        expect.arrayContaining([
          ['131 Công ty Xây dựng Hòa Bình', 2, '255000000'],
          ['131 Southern Landscape Supplies', 1, '228600000'],
        ]),
      );

      // Customers and products are two views of the same invoices: the
      // revenue agrees, and the cost differs by exactly the late freight,
      // which belongs to a product and to no one invoice.
      const byCustomerCost = report.byCustomer.reduce((s, r) => s + BigInt(r.cost.minorUnits), 0n);
      expect(BigInt(report.total.cost.minorUnits) - byCustomerCost).toBe(3_000_000n);
    });

    it('leaves out invoices outside the period', async () => {
      await services.sales.sell({
        reference: 'HD-0201',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        occurredAt: new Date(Date.UTC(2026, 1, 3)),
        lines: [{ itemId: tiles, quantity: 10n, amount: 1_600_000n }],
      });
      const report = await services.sales.margins(...JANUARY);
      expect(report.byItem).toHaveLength(0);
      expect(report.total.revenue.minorUnits).toBe('0');
      expect(report.total.marginBasisPoints).toBeNull();
    });
  });

  describe('the database', () => {
    it('refuses a sale whose header disagrees with its lines, at commit', async () => {
      const sold = await services.sales.sell({
        reference: 'HD-0301',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [{ itemId: tiles, quantity: 10n, amount: 1_600_000n }],
      });
      if (!sold.ok) throw new Error(sold.error.code);

      // A second header pointing at the same entry, claiming revenue no line
      // carries: exactly what a margin report would silently add up.
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.insert(sales).values({
            id: newId('sale'),
            orgId: db.$orgId,
            reference: 'HD-FORGED',
            customerAccountId: customer.id,
            revenueAccountId: revenue.id,
            currency: 'VND',
            netMinor: 1_000n,
            taxMinor: 0n,
            grossMinor: 1_000n,
            baseNetMinor: 1_000n,
            baseTaxMinor: 0n,
            baseCostMinor: 0n,
            occurredAt: on(10),
            transactionId: sold.value.entry.id,
          }),
        ),
        /has no lines/u,
      );
    });

    it('refuses to edit a sale after the fact', async () => {
      const sold = await services.sales.sell({
        reference: 'HD-0302',
        customerAccountId: customer.id,
        revenueAccountId: revenue.id,
        currency: 'VND',
        lines: [{ itemId: tiles, quantity: 10n, amount: 1_600_000n }],
      });
      if (!sold.ok) throw new Error(sold.error.code);
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.update(sales).set({ reference: 'HD-9999' }).where(eq(sales.id, sold.value.sale.id)),
        ),
        /append-only|not permitted|cannot be (updated|modified)/iu,
      );
    });
  });
});

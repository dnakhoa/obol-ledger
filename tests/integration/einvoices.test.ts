import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { organizations } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Vietnamese e-invoices: the legal invoice for a sale, and the adjustment
 * invoice for a credit note against it.
 *
 * What is proved is what the tax office checks: the numbers in a series run
 * without a gap and never repeat, the seller is named in full before anything
 * is issued, a series is used only in its own year, an issued invoice is
 * corrected by an adjustment that names it rather than reissued, and the
 * document stored is exactly the one fingerprinted.
 */
describe('Vietnamese e-invoices', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let customer: { id: string };
  let saleId: string;
  let lineId: string;

  const today = new Date().toISOString().slice(0, 10);
  const series = `C${today.slice(2, 4)}TBM`;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db
      .update(organizations)
      .set({ functionalCurrency: 'VND' })
      .where(eq(organizations.id, db.$orgId));
    services = servicesFor(db, db.$orgId);

    const vnd = { currency: 'VND' as const };
    const stock = await openAccount(db, db.$orgId, { name: '156', type: 'asset', ...vnd });
    const cogs = await openAccount(db, db.$orgId, { name: '632', type: 'expense', ...vnd });
    const revenue = await openAccount(db, db.$orgId, {
      name: '511',
      type: 'revenue',
      overdraftAllowed: true,
      ...vnd,
    });
    customer = await openAccount(db, db.$orgId, {
      name: 'Hòa Bình',
      type: 'asset',
      openItems: true,
      overdraftAllowed: true,
      ...vnd,
    });
    const payable = await openAccount(db, db.$orgId, {
      name: '331',
      type: 'liability',
      overdraftAllowed: true,
      ...vnd,
    });
    const outputVat = await openAccount(db, db.$orgId, {
      name: '33311',
      type: 'liability',
      overdraftAllowed: true,
      ...vnd,
    });
    const inputVat = await openAccount(db, db.$orgId, { name: '1331', type: 'asset', ...vnd });
    const ten = await services.tax.create({
      name: 'GTGT 10%',
      rateBasisPoints: 1000,
      treatment: 'vat',
      inputAccountId: inputVat.id,
      outputAccountId: outputVat.id,
    });
    if (!ten.ok) throw new Error('tax');
    const item = await services.inventory.createItem({
      sku: 'PAV-600',
      name: 'Đá lát granite 600×600',
      unit: 'm2',
      inventoryAccountId: stock.id,
      cogsAccountId: cogs.id,
    });
    if (!item.ok) throw new Error('item');
    await services.inventory.receive({
      itemId: item.value.id,
      quantity: 2000_00n,
      cost: 400_000_000n,
      currency: 'VND',
      creditAccountId: payable.id,
    });
    const sold = await services.sales.sell({
      reference: 'HD-0001',
      customerAccountId: customer.id,
      revenueAccountId: revenue.id,
      currency: 'VND',
      taxCodeId: ten.value.id,
      lines: [{ itemId: item.value.id, quantity: 1500_00n, amount: 450_000_000n }],
    });
    if (!sold.ok) throw new Error(sold.error.code);
    saleId = sold.value.sale.id;
    lineId = sold.value.sale.lines[0]?.movementId ?? '';
  });

  async function configure() {
    const seller = await services.einvoices.updateSeller({
      legalName: 'Công ty TNHH Đá Bình Minh',
      taxId: '4101234567',
      address: 'Quy Nhơn, Bình Định',
      series,
    });
    expect(seller.ok).toBe(true);
    await services.einvoices.updateBuyer({
      accountId: customer.id,
      legalName: 'Công ty CP Xây dựng Hòa Bình',
      taxId: '0301234567',
      address: 'Quận 3, TP. Hồ Chí Minh',
    });
  }

  it('refuses to issue until the seller is named in full', async () => {
    expect(await services.einvoices.issueForSale({ saleId })).toMatchObject({
      ok: false,
      error: {
        code: 'einvoice_seller_incomplete',
        missing: ['legalName', 'taxId', 'address', 'series'],
      },
    });
    expect(
      await services.einvoices.updateSeller({
        legalName: 'X',
        taxId: '12345',
        address: 'Y',
        series,
      }),
    ).toMatchObject({ ok: false, error: { code: 'tax_id_invalid' } });
  });

  it('issues the invoice with the next number, and the adjustment that corrects it', async () => {
    await configure();
    const invoice = await services.einvoices.issueForSale({ saleId });
    if (!invoice.ok) throw new Error(invoice.error.code);
    expect(invoice.value).toMatchObject({
      kind: 'original',
      series,
      number: 1,
      printedNumber: '0000001',
      gross: { minorUnits: '495000000' },
    });

    const document = await services.einvoices.document(invoice.value.id);
    expect(document?.xml).toContain('<MST>0301234567</MST>');
    expect(document?.xml).toContain('<TSuat>10%</TSuat>');
    expect(document?.xml).toContain('Bốn trăm chín mươi lăm triệu đồng');

    // Issued once: the same sale again is refused, not numbered twice.
    expect(await services.einvoices.issueForSale({ saleId })).toMatchObject({
      ok: false,
      error: { code: 'einvoice_already_issued' },
    });

    const note = await services.creditNotes.issue({
      saleId,
      reference: 'CN-0001',
      reason: 'Hàng vỡ khi vận chuyển',
      lines: [{ saleMovementId: lineId, quantity: 100_00n, amount: 30_000_000n }],
    });
    if (!note.ok) throw new Error(note.error.code);
    const adjustment = await services.einvoices.issueForCreditNote({
      creditNoteId: note.value.creditNote.id,
    });
    if (!adjustment.ok) throw new Error(adjustment.error.code);
    expect(adjustment.value).toMatchObject({
      kind: 'adjustment',
      number: 2,
      gross: { minorUnits: '-33000000' },
    });
    const adjusted = await services.einvoices.document(adjustment.value.id);
    expect(adjusted?.xml).toContain(
      `<KHHDCLQuan>${series}</KHHDCLQuan><SHDCLQuan>0000001</SHDCLQuan>`,
    );
    expect(adjusted?.xml).toContain('<GChu>Hàng vỡ khi vận chuyển</GChu>');

    expect((await services.einvoices.forSale(saleId)).map((e) => e.number)).toEqual([1, 2]);
  });

  it('uses a series only in its own year', async () => {
    await configure();
    const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
    expect(await services.einvoices.issueForSale({ saleId, issuedOn: nextYear })).toMatchObject({
      ok: false,
      error: { code: 'einvoice_series_year', series },
    });
  });

  it('is refused by the database when a writer goes around the service', async () => {
    await configure();
    const invoice = await services.einvoices.issueForSale({ saleId });
    if (!invoice.ok) throw new Error(invoice.error.code);

    const forged = (number: number, xml = '<HDon/>') =>
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO einvoices (id, org_id, kind, sale_id, template, series, number, issued_on,
                                 currency, net_minor, tax_minor, xml, sha256)
          VALUES (${`einv_forged_${number}`}, ${db.$orgId}, 'original', ${saleId}, '1', ${series},
                  ${number}, ${today}, 'VND', 0, 0, ${xml},
                  encode(sha256(convert_to(${xml}, 'UTF8')), 'hex'))
        `),
      );
    // A gap in the numbers.
    await expectDatabaseError(forged(3), /would leave a gap or repeat/);
    // The document is exactly what was fingerprinted, and never edited.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE einvoices SET xml = '<HDon/>' WHERE id = ${invoice.value.id}`),
      ),
      /append-only/,
    );
  });
});

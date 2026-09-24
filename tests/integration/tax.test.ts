import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { eq } from 'drizzle-orm';
import { taxCodes, taxEntries } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Three mechanisms wearing one name, against a real database.
 *
 * What the unit tests prove is the arithmetic. What these prove is that the
 * entry balances whichever mechanism produced it, and that the one asymmetry
 * that cannot be caught by double entry is caught by a constraint instead.
 */
describe('consumption tax', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let receivable: { id: string };
  let payable: { id: string };
  let revenue: { id: string };
  let expense: { id: string };
  let inputTax: { id: string };
  let outputTax: { id: string };

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);

    receivable = await openAccount(db, db.$orgId, {
      name: 'Trade Receivables',
      type: 'asset',
      overdraftAllowed: true,
    });
    payable = await openAccount(db, db.$orgId, {
      name: 'Trade Payables',
      type: 'liability',
      overdraftAllowed: true,
    });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    expense = await openAccount(db, db.$orgId, { name: 'Purchases', type: 'expense' });
    inputTax = await openAccount(db, db.$orgId, {
      name: 'Input VAT',
      type: 'asset',
      overdraftAllowed: true,
    });
    outputTax = await openAccount(db, db.$orgId, {
      name: 'Output VAT',
      type: 'liability',
      overdraftAllowed: true,
    });
  });

  async function vatCode() {
    const created = await services.tax.create({
      name: 'GTGT 10%',
      rateBasisPoints: 1000,
      treatment: 'vat',
      inputAccountId: inputTax.id,
      outputAccountId: outputTax.id,
    });
    if (!created.ok) throw new Error(created.error.code);
    return created.value.id;
  }

  const balanceOf = async (id: string) =>
    (await services.accounts.list()).find((a) => a.id === id)?.balance.minorUnits;

  describe('value added tax', () => {
    it('charges it on a sale and owes it to the state', async () => {
      const taxCodeId = await vatCode();
      const result = await services.tax.post({
        description: 'Export invoice',
        taxCodeId,
        supply: 'sale',
        amount: 1_000_00n,
        netAccountId: revenue.id,
        counterpartyAccountId: receivable.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.gross).toBe('110000');

      // The customer owes the gross, revenue takes the net, the state is owed
      // the tax — and the entry balances, which is the only reason to trust
      // the other two.
      expect(await balanceOf(receivable.id)).toBe('110000');
      expect(await balanceOf(revenue.id)).toBe('100000');
      expect(await balanceOf(outputTax.id)).toBe('10000');
    });

    it('reclaims it on a purchase', async () => {
      const taxCodeId = await vatCode();
      const result = await services.tax.post({
        description: 'Supplier bill',
        taxCodeId,
        supply: 'purchase',
        amount: 1_000_00n,
        netAccountId: expense.id,
        counterpartyAccountId: payable.id,
      });
      expect(result.ok).toBe(true);

      expect(await balanceOf(inputTax.id)).toBe('10000');
      expect(await balanceOf(expense.id)).toBe('100000');
      expect(await balanceOf(payable.id)).toBe('110000');
    });

    it('takes the tax out of a price quoted inclusive', async () => {
      // Prices are quoted gross in Vietnam and Japan.
      const taxCodeId = await vatCode();
      const result = await services.tax.post({
        description: 'Retail sale',
        taxCodeId,
        supply: 'sale',
        amount: 1_100_00n,
        inclusive: true,
        netAccountId: revenue.id,
        counterpartyAccountId: receivable.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.net).toBe('100000');
      expect(result.value.tax).toBe('10000');
      expect(result.value.gross).toBe('110000');
    });

    it('posts a zero-rated export, and still puts it on the return', async () => {
      // Vietnam's GTGT is 0% on exported goods, and so is every VAT system's
      // treatment of an export. There is no tax to post — a nil leg records
      // nothing and the journal rightly refuses it — but the supply belongs
      // on the return, so the tax entry row is written anyway.
      const zero = await services.tax.create({
        name: 'GTGT 0% (xuất khẩu)',
        rateBasisPoints: 0,
        treatment: 'vat',
        inputAccountId: inputTax.id,
        outputAccountId: outputTax.id,
      });
      if (!zero.ok) throw new Error(zero.error.code);

      const result = await services.tax.post({
        description: 'Export invoice INV-2607',
        taxCodeId: zero.value.id,
        supply: 'sale',
        amount: 58_400_00n,
        netAccountId: revenue.id,
        counterpartyAccountId: receivable.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.entry.postings).toHaveLength(2);
      expect(result.value.tax).toBe('0');
      expect(await balanceOf(receivable.id)).toBe('5840000');
      expect(await balanceOf(outputTax.id)).toBe('0');

      const rows = await withTenant(db, db.$orgId, (tx) =>
        tx.select().from(taxEntries).where(eq(taxEntries.transactionId, result.value.entry.id)),
      );
      expect(rows.map((row) => [row.supply, row.baseMinor, row.taxMinor])).toEqual([
        ['sale', 5_840_000n, 0n],
      ]);
    });
  });

  describe('EU reverse charge', () => {
    it('books both sides of the same tax, netting to nothing', async () => {
      const created = await services.tax.create({
        name: 'EU reverse charge 20%',
        rateBasisPoints: 2000,
        treatment: 'reverse_charge',
        inputAccountId: inputTax.id,
        outputAccountId: outputTax.id,
      });
      if (!created.ok) throw new Error(created.error.code);

      const result = await services.tax.post({
        description: 'Intra-community acquisition',
        taxCodeId: created.value.id,
        supply: 'purchase',
        amount: 1_000_00n,
        netAccountId: expense.id,
        counterpartyAccountId: payable.id,
      });
      expect(result.ok).toBe(true);

      // Both halves exist and cancel. The supplier is owed the net only —
      // but a return needs both numbers, and a system that posts neither
      // cannot produce one.
      expect(await balanceOf(inputTax.id)).toBe('20000');
      expect(await balanceOf(outputTax.id)).toBe('20000');
      expect(await balanceOf(payable.id)).toBe('100000');
    });

    it('reports a reverse-charge sale once, without inventing an acquisition', async () => {
      const created = await services.tax.create({
        name: 'EU reverse charge 20%',
        rateBasisPoints: 2000,
        treatment: 'reverse_charge',
        inputAccountId: inputTax.id,
        outputAccountId: outputTax.id,
      });
      if (!created.ok) throw new Error(created.error.code);

      // The seller charges nothing and the buyer self-accounts. The supply
      // goes on the seller's return; a purchase row beside it would claim an
      // acquisition the seller never made.
      const result = await services.tax.post({
        description: 'Supply to a German distributor',
        taxCodeId: created.value.id,
        supply: 'sale',
        amount: 1_000_00n,
        netAccountId: revenue.id,
        counterpartyAccountId: receivable.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await balanceOf(receivable.id)).toBe('100000');

      const rows = await withTenant(db, db.$orgId, (tx) =>
        tx.select().from(taxEntries).where(eq(taxEntries.transactionId, result.value.entry.id)),
      );
      expect(rows.map((row) => [row.supply, row.baseMinor, row.taxMinor])).toEqual([
        ['sale', 100_000n, 0n],
      ]);
    });
  });

  describe('United States sales tax', () => {
    it('collects it on a sale', async () => {
      const created = await services.tax.create({
        name: 'WA sales tax 8.25%',
        rateBasisPoints: 825,
        treatment: 'sales_tax',
        outputAccountId: outputTax.id,
      });
      if (!created.ok) throw new Error(created.error.code);

      const result = await services.tax.post({
        description: 'Domestic sale',
        taxCodeId: created.value.id,
        supply: 'sale',
        amount: 1_000_00n,
        netAccountId: revenue.id,
        counterpartyAccountId: receivable.id,
      });
      expect(result.ok).toBe(true);
      expect(await balanceOf(outputTax.id)).toBe('8250');
    });

    it('does not separate it on a purchase, because it is never reclaimable', async () => {
      const created = await services.tax.create({
        name: 'WA sales tax 8.25%',
        rateBasisPoints: 825,
        treatment: 'sales_tax',
        outputAccountId: outputTax.id,
      });
      if (!created.ok) throw new Error(created.error.code);

      const result = await services.tax.post({
        description: 'Domestic purchase',
        taxCodeId: created.value.id,
        supply: 'purchase',
        amount: 1_000_00n,
        netAccountId: expense.id,
        counterpartyAccountId: payable.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The whole amount is the cost. Nothing is reclaimable, so nothing is
      // split out.
      expect(result.value.tax).toBe('0');
      expect(await balanceOf(expense.id)).toBe('100000');
      expect(await balanceOf(inputTax.id)).toBe('0');
    });

    it('is refused an input account by the service and by the database', async () => {
      // Double entry cannot catch this: a US business given an input-tax
      // account accumulates a receivable from a state that does not owe it,
      // and every entry balances perfectly while the asset is fictional.
      const refused = await services.tax.create({
        name: 'Broken sales tax',
        rateBasisPoints: 825,
        treatment: 'sales_tax',
        inputAccountId: inputTax.id,
        outputAccountId: outputTax.id,
      });
      expect(refused).toEqual({ ok: false, error: { code: 'sales_tax_is_not_reclaimable' } });

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.insert(taxCodes).values({
            id: 'tax_broken',
            orgId: db.$orgId,
            name: 'Straight past the service',
            rateBasisPoints: 825,
            treatment: 'sales_tax',
            inputAccountId: inputTax.id,
            outputAccountId: outputTax.id,
          }),
        ),
        /tax_codes_accounts_check/u,
      );
    });
  });
});

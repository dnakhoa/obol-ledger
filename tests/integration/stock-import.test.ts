import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';

/**
 * Importing a decade of purchase history out of the workbook.
 *
 * The costing engine is useless to somebody whose lots are in a spreadsheet
 * with four hundred rows in it, and "type them in again" is not an answer.
 * What these tests hold is the two promises the screen makes: a clean preview
 * means a clean import, and a file with one bad row changes nothing at all.
 */
describe('importing deliveries', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let stock: { id: string };
  let cogs: { id: string };
  let payable: { id: string };

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
  });

  const accounts = () => ({
    creditAccountId: payable.id,
    inventoryAccountId: stock.id,
    cogsAccountId: cogs.id,
  });

  /** What a person actually pastes: a block copied out of Excel, tab separated. */
  const PASTED = [
    'Product Code\tName\tUnit\tDate Received\tQuantity\tTotal Cost\tContainer',
    'PAV-600\tGranite paver 600×600\tm2\t10/01/2026\t1000\t40000.00\tCONT-4417',
    'PAV-600\tGranite paver 600×600\tm2\t14/02/2026\t800\t36000.00\tCONT-4482',
    'BLK-STR\tStair blocks\tm3\t22/02/2026\t120.500\t67200.00\tCONT-4510',
  ].join('\n');

  describe('preview', () => {
    it('reads a tab-separated paste and says what it will do', async () => {
      const preview = await services.stockImport.preview({ text: PASTED, ...accounts() });

      expect(preview.separator).toBe('tab');
      expect(preview.rows).toHaveLength(3);
      expect(preview.problems).toBe(0);
      // Two distinct codes, so two products get opened as well as three lots.
      expect(preview.newProducts).toBe(2);
      // Day-first, and echoed back resolved so a person can see it was read
      // the way they meant.
      expect(preview.rows[0]?.date).toBe('2026-01-10');
      expect(preview.rows[2]?.date).toBe('2026-02-22');
    });

    it('names the line and the reason, not just "invalid"', async () => {
      const text = [
        'sku,unit,date,quantity,cost',
        'PAV-600,m2,2026-01-10,1000,40000.00',
        'PAV-600,m2,not a date,500,20000.00',
        'PAV-600,m2,2026-02-14,1.005,20000.00',
      ].join('\n');

      const preview = await services.stockImport.preview({ text, ...accounts() });
      expect(preview.ready).toBe(1);
      expect(preview.problems).toBe(2);
      // Line numbers count the header, so they match what the spreadsheet shows.
      expect(preview.rows[1]?.line).toBe(3);
      expect(preview.rows[1]?.problem).toMatch(/not a date/u);
      expect(preview.rows[2]?.line).toBe(4);
      expect(preview.rows[2]?.problem).toMatch(/decimal places/u);
    });

    it('refuses a row whose unit disagrees with the product it names', async () => {
      const created = await services.inventory.createItem({
        sku: 'PAV-600',
        name: 'Granite paver',
        unit: 'm2',
        inventoryAccountId: stock.id,
        cogsAccountId: cogs.id,
      });
      expect(created.ok).toBe(true);

      const preview = await services.stockImport.preview({
        text: 'sku,unit,date,quantity,cost\nPAV-600,tonne,2026-01-10,1000,40000.00',
        ...accounts(),
      });
      // Guessing which of the two is right would quietly change what the
      // business thinks it holds.
      expect(preview.rows[0]?.problem).toMatch(/measured in m2/u);
    });

    // `Date.parse` rolls 30 February over into 2 March rather than refusing
    // it, so a typo was booked on a different day from the one the preview
    // echoed back — and month 13 passed the preview only to throw on import.
    it.each(['2026-02-30', '30/02/2026', '2026-13-01', '01/13/2026'])(
      'refuses %s, a day that does not exist',
      async (date) => {
        const preview = await services.stockImport.preview({
          text: `sku,unit,date,quantity,cost\nPAV-600,m2,${date},10,100.00`,
          ...accounts(),
        });
        expect(preview.rows[0]?.problem).toMatch(/not a date/u);
      },
    );

    it('still reads the last day of February in a leap year', async () => {
      const preview = await services.stockImport.preview({
        text: 'sku,unit,date,quantity,cost\nPAV-600,m2,29/02/2028,10,100.00',
        ...accounts(),
      });
      expect(preview.rows[0]?.problem).toBeUndefined();
      expect(preview.rows[0]?.date).toBe('2028-02-29');
    });

    // A code the ledger has not seen takes its unit from its first row. The
    // second row used to be counted at the first row's precision in the first
    // row's unit — ten square metres plus seven pieces stored as seventeen
    // square metres.
    it('refuses a new product whose rows disagree about its unit', async () => {
      const preview = await services.stockImport.preview({
        text: 'sku,unit,date,quantity,cost\nNEW-1,m2,2026-01-10,10,100.00\nNEW-1,piece,2026-01-11,7,70.00',
        ...accounts(),
      });
      expect(preview.rows[0]?.problem).toBeUndefined();
      expect(preview.rows[1]?.problem).toMatch(/measured in m2/u);
    });

    it('says which columns it did not use', async () => {
      const preview = await services.stockImport.preview({
        text: 'sku,unit,date,quantity,cost,Shipping Agent\nPAV-600,m2,2026-01-10,10,100.00,Maersk',
        ...accounts(),
      });
      expect(preview.ignoredColumns).toEqual(['shippingagent']);
    });

    it('writes nothing', async () => {
      await services.stockImport.preview({ text: PASTED, ...accounts() });
      expect(await services.inventory.list()).toHaveLength(0);
    });
  });

  describe('apply', () => {
    it('opens the products and the lots, and posts each purchase', async () => {
      const result = await services.stockImport.apply({ text: PASTED, ...accounts() });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ lots: 3, products: 2 });

      const items = await services.inventory.list();
      expect(items.map((item) => item.sku)).toEqual(['BLK-STR', 'PAV-600']);

      const pavers = items.find((item) => item.sku === 'PAV-600');
      expect(pavers?.onHandMinor).toBe('180000'); // 1800.00 m²
      expect(pavers?.valueMinor).toBe('7600000'); // 76,000.00

      // And the ledger agrees, because the purchases went through the journal.
      // Both read positive: balances are presented the way an accountant reads
      // them, so a credited payable is a healthy 14,320.00 owed rather than a
      // negative asset.
      const ledger = await services.accounts.list();
      expect(ledger.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('14320000');
      expect(ledger.find((a) => a.id === payable.id)?.balance.minorUnits).toBe('14320000');
    });

    it('costs a shipment from the imported lots straight away', async () => {
      await services.stockImport.apply({ text: PASTED, ...accounts() });
      const pavers = (await services.inventory.list()).find((item) => item.sku === 'PAV-600');
      expect(pavers).toBeDefined();
      if (!pavers) return;

      const issued = await services.inventory.issue({ itemId: pavers.id, quantity: 150000n });
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      // 1000 at 40.00 then 500 at 45.00 — the imported history is ordinary
      // history the moment it lands.
      expect(issued.value.movement.baseCostMinor).toBe('6250000');
      expect(issued.value.movement.drawnFrom.map((d) => d.layerReference)).toEqual([
        'CONT-4417',
        'CONT-4482',
      ]);
    });

    it('changes nothing at all when one row is wrong', async () => {
      const text = [
        'sku,unit,date,quantity,cost',
        'PAV-600,m2,2026-01-10,1000,40000.00',
        'PAV-600,m2,2026-02-14,800,36000.00',
        'BLK-STR,m3,2026-02-22,120.500,oops',
      ].join('\n');

      const result = await services.stockImport.apply({ text, ...accounts() });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('import_has_problems');

      // Not "two of the three landed". A partially applied import is the worst
      // outcome available: the books have moved and nobody knows how far.
      expect(await services.inventory.list()).toHaveLength(0);
      const ledger = await services.accounts.list();
      expect(ledger.find((a) => a.id === stock.id)?.balance.minorUnits).toBe('0');
    });

    it('refuses an empty file rather than reporting success', async () => {
      const result = await services.stockImport.apply({
        text: 'sku,unit,date,quantity,cost\n',
        ...accounts(),
      });
      expect(result.ok).toBe(false);
    });
  });
});

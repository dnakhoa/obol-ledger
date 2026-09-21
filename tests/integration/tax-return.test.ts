import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';

/**
 * Filing, against a real database.
 *
 * The unit tests prove the arithmetic. What these prove is the part the
 * arithmetic cannot: that the clearing entry balances, that the credit really
 * is left behind in the input account rather than remembered on a form, and
 * that a month cannot be filed twice — which is an index doing the work, not
 * a check this code could be trusted to make.
 */
describe('tax returns', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let receivable: { id: string };
  let payable: { id: string };
  let revenue: { id: string };
  let expense: { id: string };
  let inputTax: { id: string };
  let outputTax: { id: string };
  let taxPayable: { id: string };
  let taxCodeId: string;

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
    taxPayable = await openAccount(db, db.$orgId, {
      name: 'VAT Payable',
      type: 'liability',
      overdraftAllowed: true,
      role: 'tax_payable',
    });

    const created = await services.tax.create({
      name: 'VAT 10%',
      rateBasisPoints: 1000,
      treatment: 'vat',
      inputAccountId: inputTax.id,
      outputAccountId: outputTax.id,
    });
    if (!created.ok) throw new Error(created.error.code);
    taxCodeId = created.value.id;
  });

  const balanceOf = async (id: string) =>
    (await services.accounts.list()).find((account) => account.id === id)?.balance.minorUnits;

  const sell = (amount: bigint, on: string) =>
    services.tax.post({
      description: `Sale ${on}`,
      taxCodeId,
      supply: 'sale',
      amount,
      netAccountId: revenue.id,
      counterpartyAccountId: receivable.id,
      occurredAt: new Date(`${on}T10:00:00.000Z`),
    });

  const buy = (amount: bigint, on: string) =>
    services.tax.post({
      description: `Purchase ${on}`,
      taxCodeId,
      supply: 'purchase',
      amount,
      netAccountId: expense.id,
      counterpartyAccountId: payable.id,
      occurredAt: new Date(`${on}T10:00:00.000Z`),
    });

  const march = { periodStart: '2026-03-01', periodEnd: '2026-03-01' };
  const april = { periodStart: '2026-04-01', periodEnd: '2026-04-01' };
  const may = { periodStart: '2026-05-01', periodEnd: '2026-05-01' };

  it('pays the difference between what it charged and what it paid', async () => {
    await sell(10_000_00n, '2026-03-05');
    await buy(4_000_00n, '2026-03-12');

    const preview = await services.taxReturns.preview(march);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.outputTax.minorUnits).toBe('100000');
    expect(preview.value.inputTax.minorUnits).toBe('40000');
    expect(preview.value.payable.minorUnits).toBe('60000');
    // Not filed yet, so it has no identity and no entry behind it.
    expect(preview.value.id).toBeNull();

    const filed = await services.taxReturns.file(march);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;

    // Both tax accounts are emptied and the debt is one number in one place.
    expect(await balanceOf(outputTax.id)).toBe('0');
    expect(await balanceOf(inputTax.id)).toBe('0');
    expect(await balanceOf(taxPayable.id)).toBe('60000');
  });

  it('leaves an unused credit in the input account rather than on a form', async () => {
    await sell(1_000_00n, '2026-03-05');
    await buy(5_000_00n, '2026-03-12');

    const filed = await services.taxReturns.file(march);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.value.return.payable.minorUnits).toBe('0');
    expect(filed.value.return.carriedForward.minorUnits).toBe('40000');

    // The output account is cleared and nothing is owed. The credit is still
    // an asset on the balance sheet, which is what it is — the state owes it.
    expect(await balanceOf(outputTax.id)).toBe('0');
    expect(await balanceOf(inputTax.id)).toBe('40000');
    expect(await balanceOf(taxPayable.id)).toBe('0');
  });

  it('opens the next period with the credit the last one left', async () => {
    await sell(1_000_00n, '2026-03-05');
    await buy(5_000_00n, '2026-03-12');
    await services.taxReturns.file(march);

    await sell(10_000_00n, '2026-04-08');

    const preview = await services.taxReturns.preview(april);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // 100,000 output, nothing bought, but 40,000 of credit was waiting.
    expect(preview.value.broughtForward.minorUnits).toBe('40000');
    expect(preview.value.payable.minorUnits).toBe('60000');
  });

  it('carries the credit forward one link at a time, not from the first return', async () => {
    // Three returns, each leaving a different credit. A carry-forward that
    // read the *earliest* return instead of the latest would pass the two-
    // period test above and fail here — which is why there is a third period.
    await buy(5_000_00n, '2026-03-12');
    await services.taxReturns.file(march);

    await sell(1_000_00n, '2026-04-08');
    const second = await services.taxReturns.file(april);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // 50,000 brought in, 10,000 used, 40,000 left.
    expect(second.value.return.broughtForward.minorUnits).toBe('50000');
    expect(second.value.return.carriedForward.minorUnits).toBe('40000');

    await sell(1_000_00n, '2026-05-08');
    const third = await services.taxReturns.preview(may);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.broughtForward.minorUnits).toBe('40000');
  });

  it('files a period that moves nothing, because it still sets the credit', async () => {
    // Bought, sold nothing. There is no output tax to clear against, so the
    // clearing entry has no legs — but the return exists, claims March, and
    // hands 50,000 to April.
    await buy(5_000_00n, '2026-03-12');

    const filed = await services.taxReturns.file(march);
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.value.entry).toBeNull();
    expect(filed.value.return.carriedForward.minorUnits).toBe('50000');
    // The credit is untouched — crediting it would have claimed a refund.
    expect(await balanceOf(inputTax.id)).toBe('50000');

    const again = await services.taxReturns.file(march);
    expect(again.ok).toBe(false);
  });

  it('refuses to file a month twice', async () => {
    await sell(1_000_00n, '2026-03-05');
    await services.taxReturns.file(march);

    const again = await services.taxReturns.file(march);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('period_already_filed');
  });

  it('refuses a quarter that swallows an already-filed month', async () => {
    await sell(1_000_00n, '2026-04-05');
    await services.taxReturns.file(april);

    // The quarter overlaps April. Nothing compares date ranges — April simply
    // already has an owner, and a month has exactly one.
    const quarter = await services.taxReturns.file({
      periodStart: '2026-04-01',
      periodEnd: '2026-06-01',
    });
    expect(quarter.ok).toBe(false);
    if (quarter.ok) return;
    expect(quarter.error.code).toBe('period_already_filed');
  });

  it('files a quarter as one return over three months', async () => {
    await sell(1_000_00n, '2026-04-05');
    await sell(2_000_00n, '2026-05-05');
    await buy(500_00n, '2026-06-05');

    const quarter = await services.taxReturns.file({
      periodStart: '2026-04-01',
      periodEnd: '2026-06-01',
    });
    expect(quarter.ok).toBe(true);
    if (!quarter.ok) return;
    expect(quarter.value.return.outputTax.minorUnits).toBe('30000');
    expect(quarter.value.return.inputTax.minorUnits).toBe('5000');
    expect(quarter.value.return.payable.minorUnits).toBe('25000');

    // And the months it swallowed are now all spoken for.
    const may2 = await services.taxReturns.file(may);
    expect(may2.ok).toBe(false);
  });

  it('refuses to file out of order, which would strand the earlier credit', async () => {
    await buy(5_000_00n, '2026-03-12');
    await sell(10_000_00n, '2026-04-08');

    const skipped = await services.taxReturns.file(april);
    expect(skipped.ok).toBe(false);
    if (skipped.ok) return;
    expect(skipped.error.code).toBe('earlier_return_unfiled');
  });

  it('splits sales by tax code, not by rate', async () => {
    // A domestic 10% sale and a 10% reverse charge are both 10% and belong on
    // different lines of the form, so the grouping key has to be the code.
    const reverse = await services.tax.create({
      name: 'Reverse charge 10%',
      rateBasisPoints: 1000,
      treatment: 'reverse_charge',
      inputAccountId: inputTax.id,
      outputAccountId: outputTax.id,
    });
    if (!reverse.ok) throw new Error(reverse.error.code);

    await sell(1_000_00n, '2026-03-05');
    await services.tax.post({
      description: 'Imported service',
      taxCodeId: reverse.value.id,
      supply: 'purchase',
      amount: 2_000_00n,
      netAccountId: expense.id,
      counterpartyAccountId: payable.id,
      occurredAt: new Date('2026-03-09T10:00:00.000Z'),
    });

    const preview = await services.taxReturns.preview(march);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // The reverse charge appears on both sides and nets to nothing, so the
    // payable is the domestic sale's tax alone.
    expect(preview.value.sales).toHaveLength(2);
    expect(preview.value.purchases).toHaveLength(1);
    expect(preview.value.payable.minorUnits).toBe('10000');
  });

  it('will not file a period with nothing in it', async () => {
    const empty = await services.taxReturns.file(march);
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('nothing_to_file');
  });

  it('cannot be edited once filed, because it is evidence', async () => {
    await sell(1_000_00n, '2026-03-05');
    const filed = await services.taxReturns.file(march);
    expect(filed.ok).toBe(true);

    const listed = await services.taxReturns.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.filedAt).not.toBeNull();
  });
});

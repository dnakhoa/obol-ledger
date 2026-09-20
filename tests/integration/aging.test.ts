import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { minorUnits, type MinorUnits } from '@/lib/money';

/**
 * Who owes what, and for how long — built from the postings, like everything
 * else, with no separate receivables ledger to fall out of step.
 */
describe('aged receivables', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let receivable: { id: string };
  let revenue: { id: string };
  let bank: { id: string };
  let stock: { id: string };

  const usd = (value: bigint): MinorUnits => minorUnits(value);
  const ASOF = new Date(Date.UTC(2026, 3, 1));
  const daysBefore = (days: number) => new Date(ASOF.getTime() - days * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);

    receivable = await openAccount(db, db.$orgId, {
      name: 'Trade Receivables',
      type: 'asset',
      overdraftAllowed: true,
      openItems: true,
    });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Export Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    bank = await openAccount(db, db.$orgId, {
      name: 'Bank',
      type: 'asset',
      overdraftAllowed: true,
    });
    // A non-monetary asset, to prove it is excluded: ageing stock would be
    // meaningless and would bury the accounts that matter.
    stock = await services.accounts
      .create({
        name: 'Inventory',
        type: 'asset',
        currency: 'USD',
        overdraftAllowed: true,
        monetary: false,
      })
      .then((account) => ({ id: account.id }));
  });

  async function invoice(days: number, amount: bigint, reference: string) {
    const result = await services.journal.postEntry({
      description: `Export ${reference}`,
      currency: 'USD',
      occurredAt: daysBefore(days),
      metadata: { invoice: reference },
      postings: [
        { accountId: receivable.id, amount: usd(amount) },
        { accountId: revenue.id, amount: usd(-amount) },
      ],
    });
    if (!result.ok) throw new Error(result.error.code);
  }

  async function receipt(days: number, amount: bigint) {
    const result = await services.journal.postEntry({
      description: 'Customer payment',
      currency: 'USD',
      occurredAt: daysBefore(days),
      postings: [
        { accountId: bank.id, amount: usd(amount) },
        { accountId: receivable.id, amount: usd(-amount) },
      ],
    });
    if (!result.ok) throw new Error(result.error.code);
  }

  it('buckets what is owed by how long it has been owed', async () => {
    await invoice(10, 1_000_00n, 'INV-1');
    await invoice(45, 2_000_00n, 'INV-2');
    await invoice(120, 4_000_00n, 'INV-3');

    const report = await services.aging.report('asset', ASOF);
    const account = report.accounts.find((a) => a.accountId === receivable.id);
    expect(account).toBeDefined();
    if (!account) return;

    expect(account.total.minorUnits).toBe('700000');
    expect(account.byBucket.current.minorUnits).toBe('100000');
    expect(account.byBucket.days31to60.minorUnits).toBe('200000');
    expect(account.byBucket.over90.minorUnits).toBe('400000');
    // Six sevenths of it is past thirty days, which is the fact worth seeing.
    expect(account.overdueBasisPoints).toBe(8571);
  });

  it('carries the invoice number through from the entry metadata', async () => {
    await invoice(45, 2_000_00n, 'INV-2612');

    const report = await services.aging.report('asset', ASOF);
    const account = report.accounts.find((a) => a.accountId === receivable.id);
    expect(account?.items[0]?.reference).toBe('INV-2612');
    expect(account?.items[0]?.ageDays).toBe(45);
  });

  it('settles the oldest invoice first, because nothing says which one was paid', async () => {
    await invoice(120, 1_000_00n, 'INV-OLD');
    await invoice(20, 1_000_00n, 'INV-NEW');
    await receipt(5, 1_500_00n);

    const report = await services.aging.report('asset', ASOF);
    const account = report.accounts.find((a) => a.accountId === receivable.id);
    expect(account).toBeDefined();
    if (!account) return;

    // The old invoice is cleared and half the new one remains — so nothing is
    // left in the over-90 bucket.
    expect(account.items.map((item) => item.reference)).toEqual(['INV-NEW']);
    expect(account.byBucket.over90.minorUnits).toBe('0');
    expect(account.total.minorUnits).toBe('50000');
  });

  it('leaves out an account that is not managed as open items', async () => {
    await invoice(10, 1_000_00n, 'INV-1');
    await services.journal.postEntry({
      description: 'Stock purchase',
      currency: 'USD',
      occurredAt: daysBefore(10),
      postings: [
        { accountId: stock.id, amount: usd(500_00n) },
        { accountId: bank.id, amount: usd(-500_00n) },
      ],
    });

    const report = await services.aging.report('asset', ASOF);
    // Stock and the bank are both assets with balances, and ageing either
    // produces a confident, meaningless table — that money is not
    // outstanding, it is there. `openItems` is what tells them apart, because
    // `monetary` says yes to all three.
    expect(report.accounts.map((a) => a.accountId)).not.toContain(stock.id);
    expect(report.accounts.map((a) => a.accountId)).not.toContain(bank.id);
  });

  it('says nothing is outstanding once everything is paid', async () => {
    await invoice(60, 1_000_00n, 'INV-1');
    await receipt(5, 1_000_00n);

    const report = await services.aging.report('asset', ASOF);
    expect(report.accounts.find((a) => a.accountId === receivable.id)).toBeUndefined();
  });
});

describe('aged payables', () => {
  it('reads the signs the other way round', async () => {
    const db = await createTestDatabase();
    const services = servicesFor(db, db.$orgId);
    const payable = await openAccount(db, db.$orgId, {
      name: 'Trade Payables',
      type: 'liability',
      overdraftAllowed: true,
      openItems: true,
    });
    const expense = await openAccount(db, db.$orgId, { name: 'Freight', type: 'expense' });

    const asOf = new Date(Date.UTC(2026, 3, 1));
    const posted = await services.journal.postEntry({
      description: 'Forwarder invoice',
      currency: 'USD',
      occurredAt: new Date(asOf.getTime() - 100 * 24 * 60 * 60 * 1000),
      metadata: { invoice: 'FWD-88' },
      postings: [
        { accountId: expense.id, amount: minorUnits(3_000_00n) as MinorUnits },
        { accountId: payable.id, amount: minorUnits(-3_000_00n) as MinorUnits },
      ],
    });
    expect(posted.ok).toBe(true);

    const report = await services.aging.report('liability', asOf);
    const account = report.accounts.find((a) => a.accountId === payable.id);
    expect(account?.total.minorUnits).toBe('300000');
    expect(account?.items[0]?.bucket).toBe('over90');
  });
});

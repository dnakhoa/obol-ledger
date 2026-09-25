import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { postings } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';

/**
 * Bank reconciliation: the statement beside the books.
 *
 * A distributor's September: rent paid, a customer's transfer, and a bank fee
 * nobody booked. What is proved is the month-end routine without the
 * spreadsheet — the statement goes in once however often it is imported,
 * each line finds the entry that is the same movement, the fee becomes an
 * entry from the line itself, the difference comes to zero, and the database
 * refuses a match between two different amounts.
 */
describe('bank reconciliation', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let bank: { id: string };
  let savings: { id: string };
  let fees: { id: string };
  let revenue: { id: string };
  let rentPosting: string;

  const on = (date: string) => new Date(`${date}T10:00:00.000Z`);

  const STATEMENT = [
    'Date,Description,Reference,Debit,Credit,Balance',
    '01/09/2026,RENT SEPT - YARD 4,TRF-881,2000.00,,8000.00',
    '03/09/2026,HOA BINH CONSTRUCTION INV-0912,TRF-902,,500.00,8500.00',
    '05/09/2026,ACCOUNT KEEPING FEE,,12.50,,8487.50',
  ].join('\n');

  async function post(description: string, date: string, pairs: [string, bigint][]) {
    const entry = await services.journal.postEntry({
      description,
      currency: 'USD',
      occurredAt: on(date),
      postings: pairs.map(([accountId, amount]) => ({ accountId, amount: amount as never })),
    });
    if (!entry.ok) throw new Error(entry.error.code);
    return entry.value.transaction;
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    bank = await openAccount(db, db.$orgId, { name: 'ANZ Business', type: 'asset' });
    savings = await openAccount(db, db.$orgId, { name: 'Savings', type: 'asset' });
    fees = await openAccount(db, db.$orgId, { name: 'Bank fees', type: 'expense' });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    const rent = await openAccount(db, db.$orgId, { name: 'Rent', type: 'expense' });
    const owner = await openAccount(db, db.$orgId, {
      name: 'Owner',
      type: 'equity',
      overdraftAllowed: true,
    });

    await post('Capital', '2026-07-01', [
      [bank.id, 10_000_00n],
      [owner.id, -10_000_00n],
    ]);
    const paid = await post('Rent, September', '2026-08-31', [
      [rent.id, 2_000_00n],
      [bank.id, -2_000_00n],
    ]);
    rentPosting = paid.postings.find((p) => p.accountId === bank.id)?.id ?? '';
    await post('Hòa Bình Construction paid INV-0912', '2026-09-03', [
      [bank.id, 500_00n],
      [revenue.id, -500_00n],
    ]);
  });

  it('imports a statement once, however often it is imported', async () => {
    const preview = await services.bank.preview(bank.id, STATEMENT);
    expect(preview).toMatchObject({ ok: true, value: { added: 3, skipped: 0, problems: [] } });

    const first = await services.bank.importFile({ accountId: bank.id, text: STATEMENT });
    expect(first).toMatchObject({ ok: true, value: { added: 3, skipped: 0 } });
    const again = await services.bank.importFile({ accountId: bank.id, text: STATEMENT });
    expect(again).toMatchObject({ ok: true, value: { added: 0, skipped: 3 } });

    const lines = await services.bank.lines(bank.id);
    expect(lines.map((line) => [line.occurredOn, line.amount.minorUnits])).toEqual([
      ['2026-09-05', '-1250'],
      ['2026-09-03', '50000'],
      ['2026-09-01', '-200000'],
    ]);
  });

  it('suggests each line’s entry, matches them, and books the fee from the line', async () => {
    await services.bank.importFile({ accountId: bank.id, text: STATEMENT });

    const lines = await services.bank.lines(bank.id);
    const rentLine = lines.find((line) => line.amount.minorUnits === '-200000');
    const feeLine = lines.find((line) => line.amount.minorUnits === '-1250');
    expect(rentLine?.suggested).toBe(rentPosting);
    expect(feeLine).toMatchObject({ suggested: null, candidates: [] });

    expect(await services.bank.matchSuggested(bank.id)).toBe(2);

    // Before the fee is booked: the books are out by exactly the fee.
    const before = await services.bank.reconciliation(bank.id);
    expect(before).toMatchObject({
      ok: true,
      value: {
        ledger: { minorUnits: '850000' },
        statement: { minorUnits: '848750' },
        bankOnly: { total: { minorUnits: '-1250' }, count: 1 },
        difference: { minorUnits: '0' },
        reconciled: false,
      },
    });

    const recorded = await services.bank.record({
      lineId: feeLine?.id ?? '',
      counterAccountId: fees.id,
    });
    if (!recorded.ok) throw new Error(recorded.error.code);
    expect(recorded.value.entry.description).toBe('Per bank statement: ACCOUNT KEEPING FEE');
    expect(recorded.value.entry.occurredAt.slice(0, 10)).toBe('2026-09-05');

    const after = await services.bank.reconciliation(bank.id);
    expect(after).toMatchObject({
      ok: true,
      value: {
        ledger: { minorUnits: '848750' },
        bankOnly: { count: 0 },
        booksOnly: { lines: [] },
        difference: { minorUnits: '0' },
        reconciled: true,
      },
    });
  });

  it('shows an entry the bank has not seen yet as in the books only', async () => {
    await services.bank.importFile({ accountId: bank.id, text: STATEMENT });
    await services.bank.matchSuggested(bank.id);
    await post('Cheque 1043 to the quarry', '2026-09-06', [
      [fees.id, 300_00n],
      [bank.id, -300_00n],
    ]);
    const report = await services.bank.reconciliation(bank.id);
    expect(report).toMatchObject({
      ok: true,
      value: {
        booksOnly: {
          total: { minorUnits: '-30000' },
          lines: [{ description: 'Cheque 1043 to the quarry' }],
        },
        difference: { minorUnits: '0' },
      },
    });
  });

  it('refuses a match that is not the same movement', async () => {
    await services.bank.importFile({ accountId: bank.id, text: STATEMENT });
    const lines = await services.bank.lines(bank.id);
    const feeLine = lines.find((line) => line.amount.minorUnits === '-1250');
    const rentLine = lines.find((line) => line.amount.minorUnits === '-200000');

    expect(
      await services.bank.match({ lineId: feeLine?.id ?? '', postingId: rentPosting }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'bank_match_amount_mismatch',
        lineAmount: '-12.50',
        postingAmount: '-2000.00',
      },
    });

    const elsewhere = await post('To savings', '2026-09-01', [
      [savings.id, 2_000_00n],
      [bank.id, -2_000_00n],
    ]);
    const savingsPosting = elsewhere.postings.find((p) => p.accountId === savings.id)?.id ?? '';
    expect(
      await services.bank.match({ lineId: rentLine?.id ?? '', postingId: savingsPosting }),
    ).toMatchObject({ ok: false, error: { code: 'bank_posting_not_on_account' } });

    expect(
      (await services.bank.match({ lineId: rentLine?.id ?? '', postingId: rentPosting })).ok,
    ).toBe(true);
    expect(
      await services.bank.match({ lineId: rentLine?.id ?? '', postingId: rentPosting }),
    ).toMatchObject({ ok: false, error: { code: 'bank_line_already_matched' } });

    // Undone, and made again: the history of both stays.
    expect((await services.bank.unmatch({ lineId: rentLine?.id ?? '' })).ok).toBe(true);
    expect(
      (await services.bank.match({ lineId: rentLine?.id ?? '', postingId: rentPosting })).ok,
    ).toBe(true);
  });

  it('takes a feed by the bank’s own ids, so a resend adds nothing', async () => {
    const lines = [
      {
        externalId: 'anz-7781',
        occurredOn: '2026-09-07',
        amount: 1_250_00n,
        description: 'Transfer in',
      },
      { externalId: 'anz-7782', occurredOn: '2026-09-07', amount: -9_90n, description: 'Card' },
    ];
    expect(await services.bank.feed({ accountId: bank.id, lines })).toMatchObject({
      ok: true,
      value: { added: 2, skipped: 0 },
    });
    const [firstLine] = lines;
    if (!firstLine) throw new Error('lines');
    expect(
      await services.bank.feed({ accountId: bank.id, lines: [...lines, firstLine] }),
    ).toMatchObject({ ok: true, value: { added: 0, skipped: 3 } });
  });

  it('explains what it cannot read, and which accounts have statements', async () => {
    expect(
      await services.bank.importFile({ accountId: revenue.id, text: STATEMENT }),
    ).toMatchObject({ ok: false, error: { code: 'bank_account_not_reconcilable' } });
    expect(
      await services.bank.importFile({ accountId: bank.id, text: 'Foo,Bar\n1,2' }),
    ).toMatchObject({ ok: false, error: { code: 'bank_statement_unreadable' } });
    expect(
      await services.bank.importFile({
        accountId: bank.id,
        text: 'Date,Description,Amount\n31/09/2026,Nothing,5.00\n01/09/2026,Fine,5.00',
      }),
    ).toMatchObject({ ok: false, error: { code: 'bank_statement_has_problems', rows: [2] } });
    // Nothing from the refused file was kept.
    expect(await services.bank.lines(bank.id)).toEqual([]);

    const listed = (await services.bank.accounts()).map((account) => account.name);
    expect(listed).toContain('ANZ Business');
    expect(listed).not.toContain('Sales');
  });

  it('is refused by the database when a writer goes around the service', async () => {
    await services.bank.importFile({ accountId: bank.id, text: STATEMENT });
    const lines = await services.bank.lines(bank.id);
    const feeLine = lines.find((line) => line.amount.minorUnits === '-1250');

    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`
          INSERT INTO bank_matches (id, org_id, account_id, line_id, posting_id)
          VALUES ('bmatch_forged', ${db.$orgId}, ${bank.id}, ${feeLine?.id}, ${rentPosting})
        `),
      ),
      /a match is the same movement/,
    );
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`UPDATE bank_lines SET amount_minor = -200000 WHERE id = ${feeLine?.id}`),
      ),
      /append-only/,
    );

    const matched = await services.bank.match({
      lineId: lines.find((line) => line.amount.minorUnits === '-200000')?.id ?? '',
      postingId: rentPosting,
    });
    expect(matched.ok).toBe(true);
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.execute(sql`DELETE FROM bank_matches WHERE posting_id = ${rentPosting}`),
      ),
      /append-only/,
    );
    // The posting a match names is still an ordinary posting.
    const [posting] = await withTenant(db, db.$orgId, (tx) =>
      tx.select().from(postings).where(eq(postings.id, rentPosting)),
    );
    expect(posting?.amountMinor).toBe(-2_000_00n);
  });
});

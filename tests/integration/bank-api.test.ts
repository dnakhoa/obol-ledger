import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { setDatabaseForTesting } from '@/server/db/client';
import { resetRateLimits } from '@/server/http/rate-limit';
import { apiKeys } from '@/server/db/schema';
import { digestToken } from '@/server/services/authentication';
import { newId } from '@/lib/id';
import { GET as listBankAccounts } from '@/app/api/v1/bank-accounts/route';
import {
  GET as listLines,
  POST as feedLines,
} from '@/app/api/v1/bank-accounts/[accountId]/lines/route';
import { POST as importStatement } from '@/app/api/v1/bank-accounts/[accountId]/statements/route';
import { GET as reconciliation } from '@/app/api/v1/bank-accounts/[accountId]/reconciliation/route';
import { DELETE as unmatch, POST as match } from '@/app/api/v1/bank-lines/[lineId]/match/route';
import { POST as bookLine } from '@/app/api/v1/bank-lines/[lineId]/entry/route';

/**
 * Bank reconciliation over HTTP: a feed that can resend, a CSV body, a match
 * refused when the amounts differ, and a fee booked from its line.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('bank API', () => {
  let db: TestDatabase;
  let bank: { id: string };
  let fees: { id: string };
  let rentPosting: string;

  const account = () => ({ params: Promise.resolve({ accountId: bank.id }) });
  const lineParams = (lineId: string) => ({ params: Promise.resolve({ lineId }) });
  const url = (path: string) => `https://ledger.test/api/v1${path}`;

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();
    process.env['DEMO_ORG_SLUG'] = 'primary';
    await db.insert(apiKeys).values({
      id: newId('apiKey'),
      orgId: db.$orgId,
      name: 'test key',
      tokenDigest: digestToken(TOKEN),
      tokenPrefix: TOKEN.slice(0, 6),
    });
    bank = await openAccount(db, db.$orgId, { name: 'Westpac', type: 'asset' });
    fees = await openAccount(db, db.$orgId, { name: 'Bank fees', type: 'expense' });
    const rent = await openAccount(db, db.$orgId, { name: 'Rent', type: 'expense' });
    const owner = await openAccount(db, db.$orgId, {
      name: 'Owner',
      type: 'equity',
      overdraftAllowed: true,
    });
    const journal = servicesFor(db, db.$orgId).journal;
    await journal.postEntry({
      description: 'Capital',
      currency: 'USD',
      occurredAt: new Date('2026-08-01T10:00:00Z'),
      postings: [
        { accountId: bank.id, amount: 5_000_00n as never },
        { accountId: owner.id, amount: -5_000_00n as never },
      ],
    });
    const paid = await journal.postEntry({
      description: 'Rent',
      currency: 'USD',
      occurredAt: new Date('2026-09-01T10:00:00Z'),
      postings: [
        { accountId: rent.id, amount: 1_000_00n as never },
        { accountId: bank.id, amount: -1_000_00n as never },
      ],
    });
    if (!paid.ok) throw new Error(paid.error.code);
    rentPosting = paid.value.transaction.postings.find((p) => p.accountId === bank.id)?.id ?? '';
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  it('takes a feed and a CSV, matches, books a fee, and reconciles', async () => {
    const feed = () =>
      feedLines(
        new Request(url(`/bank-accounts/${bank.id}/lines`), {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            lines: [
              {
                id: 'wbc-1',
                date: '2026-09-01',
                amount: '-1000.00',
                description: 'RENT',
                balance: '4000.00',
              },
            ],
          }),
        }),
        account(),
      );
    expect((await (await feed()).json()) as unknown).toMatchObject({ data: { added: 1 } });
    expect((await (await feed()).json()) as unknown).toMatchObject({
      data: { added: 0, skipped: 1 },
    });

    const imported = await importStatement(
      new Request(url(`/bank-accounts/${bank.id}/statements`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'text/csv' },
        body: 'Date,Description,Amount,Balance\n02/09/2026,MONTHLY FEE,-5.00,3995.00\n',
      }),
      account(),
    );
    expect(imported.status).toBe(201);

    const { data: lines } = (await (
      await listLines(new Request(url(`/bank-accounts/${bank.id}/lines`)), account())
    ).json()) as { data: { id: string; amount: { minorUnits: string }; suggested: string }[] };
    const rentLine = lines.find((line) => line.amount.minorUnits === '-100000');
    const feeLine = lines.find((line) => line.amount.minorUnits === '-500');
    expect(rentLine?.suggested).toBe(rentPosting);

    const wrong = await match(
      new Request(url(`/bank-lines/${feeLine?.id}/match`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ postingId: rentPosting }),
      }),
      lineParams(feeLine?.id ?? ''),
    );
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { code: string }).code).toBe('bank_match_amount_mismatch');

    const right = await match(
      new Request(url(`/bank-lines/${rentLine?.id}/match`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ postingId: rentPosting }),
      }),
      lineParams(rentLine?.id ?? ''),
    );
    expect(right.status).toBe(201);

    const booked = await bookLine(
      new Request(url(`/bank-lines/${feeLine?.id}/entry`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ counterAccountId: fees.id }),
      }),
      lineParams(feeLine?.id ?? ''),
    );
    expect(booked.status).toBe(201);
    expect(
      ((await booked.json()) as { data: { entry: { createdVia: string } } }).data.entry.createdVia,
    ).toBe('api');

    const report = (await (
      await reconciliation(new Request(url(`/bank-accounts/${bank.id}/reconciliation`)), account())
    ).json()) as { data: { reconciled: boolean; difference: { minorUnits: string } } };
    expect(report.data).toMatchObject({ reconciled: true, difference: { minorUnits: '0' } });

    const undone = await unmatch(
      new Request(url(`/bank-lines/${rentLine?.id}/match`), { method: 'DELETE', headers: auth }),
      lineParams(rentLine?.id ?? ''),
    );
    expect(undone.status).toBe(204);

    const accounts = (await (
      await listBankAccounts(new Request(url('/bank-accounts')), {
        params: Promise.resolve({} as Record<string, never>),
      })
    ).json()) as { data: { name: string; unmatched: number }[] };
    expect(accounts.data.find((a) => a.name === 'Westpac')?.unmatched).toBe(1);
  });

  it('needs a key to write, and refuses a statement it cannot read', async () => {
    const anonymous = await importStatement(
      new Request(url(`/bank-accounts/${bank.id}/statements`), {
        method: 'POST',
        body: 'Date,Description,Amount\n',
      }),
      account(),
    );
    expect(anonymous.status).toBe(401);

    const unreadable = await importStatement(
      new Request(url(`/bank-accounts/${bank.id}/statements`), {
        method: 'POST',
        headers: { ...auth, 'content-type': 'text/csv' },
        body: 'Foo,Bar\n1,2\n',
      }),
      account(),
    );
    expect(unreadable.status).toBe(422);
    expect(((await unreadable.json()) as { code: string }).code).toBe('bank_statement_unreadable');
  });
});

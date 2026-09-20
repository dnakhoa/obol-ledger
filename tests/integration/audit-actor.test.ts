import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor } from '../helpers/fixtures';
import { transactions } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { minorUnits, type MinorUnits } from '@/lib/money';

/**
 * Who entered this.
 *
 * The ledger has always recorded what happened and when, and never who. For a
 * single-person demo that is invisible; for a business with a bookkeeper, an
 * accountant and an owner it is the first question asked about any entry
 * somebody disagrees with.
 */
describe('the audit actor', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: { id: string };
  let capital: { id: string };

  const usd = (value: bigint): MinorUnits => minorUnits(value);

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    capital = await openAccount(db, db.$orgId, {
      name: 'Capital',
      type: 'equity',
      overdraftAllowed: true,
    });
  });

  const post = (actor?: Parameters<typeof services.journal.postEntry>[0]['actor']) =>
    services.journal.postEntry({
      description: 'Opening capital',
      currency: 'USD',
      ...(actor ? { actor } : {}),
      postings: [
        { accountId: cash.id, amount: usd(1_000_00n) },
        { accountId: capital.id, amount: usd(-1_000_00n) },
      ],
    });

  it('records the person and the route they used', async () => {
    const result = await post({ userId: 'user_abc', via: 'ui' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.transaction.createdBy).toBe('user_abc');
    expect(result.value.transaction.createdVia).toBe('ui');
  });

  it('records the route with no person for something the ledger wrote itself', async () => {
    const result = await post({ via: 'system' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A cron-driven close has no user behind it, and claiming one would be
    // inventing evidence.
    expect(result.value.transaction.createdBy).toBeNull();
    expect(result.value.transaction.createdVia).toBe('system');
  });

  it('leaves an entry with no actor honestly unattributed', async () => {
    const result = await post();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction.createdBy).toBeNull();
    expect(result.value.transaction.createdVia).toBe('unknown');
  });

  it('refuses to attribute a system entry to a person', async () => {
    // The combination is nonsense and the database says so: a route with
    // nobody behind it cannot name somebody.
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.insert(transactions).values({
          id: 'txn_impossible',
          orgId: db.$orgId,
          description: 'Written by nobody, signed by someone',
          currency: 'USD',
          occurredAt: new Date(),
          createdBy: 'user_abc',
          createdVia: 'system',
        }),
      ),
      /transactions_actor_check/u,
    );
  });

  it('refuses a route nobody defined', async () => {
    await expectDatabaseError(
      withTenant(db, db.$orgId, (tx) =>
        tx.insert(transactions).values({
          id: 'txn_bad_route',
          orgId: db.$orgId,
          description: 'Via telepathy',
          currency: 'USD',
          occurredAt: new Date(),
          createdVia: 'telepathy' as never,
        }),
      ),
      /transactions_created_via_check/u,
    );
  });

  it('survives the person being deleted, because the entry is the record', async () => {
    const result = await post({ userId: 'user_gone', via: 'ui' });
    expect(result.ok).toBe(true);

    // There is deliberately no foreign key to `user`: deleting a person must
    // not be blocked by, or cascade into, the entries they posted. The claim
    // about who wrote it stays true after the account is closed.
    const rows = await withTenant(db, db.$orgId, (tx) =>
      tx.select({ createdBy: transactions.createdBy }).from(transactions),
    );
    expect(rows.some((row) => row.createdBy === 'user_gone')).toBe(true);
  });
});

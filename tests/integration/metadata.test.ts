import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import { withTenant } from '@/server/db/tenancy';
import { transactions } from '@/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Metadata exists so the caller does not have to keep a parallel table mapping
 * their references to ours — and a parallel table is one more thing that can
 * disagree with the ledger.
 */
describe('metadata', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: { id: string };
  let savings: { id: string };

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, {
      name: 'Cash',
      type: 'asset',
      overdraftAllowed: true,
    });
    savings = await openAccount(db, db.$orgId, { name: 'Savings', type: 'asset' });
  });

  afterEach(async () => {
    await db.$close();
  });

  async function post(metadata: Record<string, string>, description = 'Sale') {
    const result = await services.journal.postEntry({
      description,
      currency: 'USD',
      metadata,
      postings: [
        { accountId: savings.id, amount: usd(5000n) },
        { accountId: cash.id, amount: usd(-5000n) },
      ],
    });
    if (!result.ok) throw new Error(`post failed: ${result.error.code}`);
    return result.value.transaction;
  }

  it('round-trips on entries and accounts', async () => {
    const entry = await post({ invoice: 'INV-42', source: 'stripe' });
    expect(entry.metadata).toEqual({ invoice: 'INV-42', source: 'stripe' });

    const account = await openAccount(db, db.$orgId, { name: 'Tagged', type: 'asset' });
    expect(account.metadata).toEqual({});
  });

  it('defaults to an empty object rather than null', async () => {
    // A caller reading `entry.metadata.invoice` should get undefined, not a
    // TypeError, on an entry nobody annotated.
    const entry = await post({});
    expect(entry.metadata).toEqual({});
  });

  it('finds an entry by its reference', async () => {
    await post({ invoice: 'INV-1' }, 'First');
    await post({ invoice: 'INV-2' }, 'Second');
    await post({}, 'Unannotated');

    const page = await services.journal.list({
      limit: 10,
      metadataKey: 'invoice',
      metadataValue: 'INV-2',
    });
    expect(page.items.map((item) => item.description)).toEqual(['Second']);
  });

  it('does not match a partial value', async () => {
    // Containment is exact. `INV-1` must not match `INV-10`, or a reference
    // lookup silently returns someone else's entry.
    await post({ invoice: 'INV-10' }, 'Ten');
    const page = await services.journal.list({
      limit: 10,
      metadataKey: 'invoice',
      metadataValue: 'INV-1',
    });
    expect(page.items).toHaveLength(0);
  });

  it('combines with the other filters rather than replacing them', async () => {
    await post({ batch: 'b1' }, 'Matching');
    await post({ batch: 'b1' }, 'Also matching');

    const page = await services.journal.list({
      limit: 10,
      metadataKey: 'batch',
      metadataValue: 'b1',
      search: 'Also',
    });
    expect(page.items.map((item) => item.description)).toEqual(['Also matching']);
  });

  it('can be annotated after the entry has settled', async () => {
    // The deliberate widening of immutability: an invoice reference often
    // arrives after the entry does.
    const entry = await post({}, 'Settled');
    await withTenant(db, db.$orgId, async (tx) => {
      await tx
        .update(transactions)
        .set({ metadata: { invoice: 'INV-LATE' } })
        .where(eq(transactions.id, entry.id));
    });

    const found = await services.journal.list({
      limit: 10,
      metadataKey: 'invoice',
      metadataValue: 'INV-LATE',
    });
    expect(found.items.map((item) => item.id)).toEqual([entry.id]);
  });

  it('still refuses to let the accounting record change', async () => {
    const entry = await post({}, 'Frozen');
    await expect(
      withTenant(db, db.$orgId, async (tx) => {
        await tx
          .update(transactions)
          .set({ description: 'Edited', metadata: { note: 'sneaky' } })
          .where(eq(transactions.id, entry.id));
      }),
    ).rejects.toThrow();
  });
});

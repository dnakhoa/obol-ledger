import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, expectDatabaseError, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import { withTenant } from '@/server/db/tenancy';
import { transactions } from '@/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { AccountDto } from '@/server/services/dto';

/**
 * Two-phase entries: pending -> posted | archived.
 *
 * The claim under test is that an authorisation reserves funds the moment it
 * is made. Everything else here follows from that: if `available` does not
 * drop when an entry goes pending, two concurrent withdrawals both see a
 * healthy balance and both succeed, which is the failure this feature exists
 * to prevent.
 */
describe('two-phase entries', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;
  let cash: AccountDto;
  let revenue: AccountDto;
  let savings: AccountDto;

  beforeEach(async () => {
    db = await createTestDatabase();
    services = servicesFor(db, db.$orgId);
    cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    savings = await openAccount(db, db.$orgId, { name: 'Savings', type: 'asset' });
    revenue = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });

    // Settled opening balance of 1,000.
    const funded = await services.journal.postEntry({
      description: 'Opening balance',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(100_000n) },
        { accountId: revenue.id, amount: usd(-100_000n) },
      ],
    });
    if (!funded.ok) throw new Error(`setup: ${funded.error.code}`);
  });

  afterEach(async () => {
    await db.$close();
  });

  const balancesOf = async (accountId: string) => {
    const result = await services.accounts.byId(accountId);
    if (!result.ok) throw new Error('account vanished');
    return {
      posted: result.value.balance.amount,
      pending: result.value.pendingBalance.amount,
      available: result.value.availableBalance.amount,
      version: result.value.version,
    };
  };

  async function authorise(amount: bigint) {
    return services.journal.postEntry({
      description: 'Authorisation',
      currency: 'USD',
      status: 'pending',
      postings: [
        { accountId: savings.id, amount: usd(amount) },
        { accountId: cash.id, amount: usd(-amount) },
      ],
    });
  }

  describe('the three balances', () => {
    it('reserves funds without moving them', async () => {
      expect(await balancesOf(cash.id)).toMatchObject({
        posted: '1000.00',
        pending: '1000.00',
        available: '1000.00',
      });

      const held = await authorise(30_000n);
      expect(held.ok).toBe(true);
      expect(held.ok && held.value.transaction.status).toBe('pending');

      // Posted is untouched — nothing has actually moved.
      // Available has dropped — the money is spoken for.
      expect(await balancesOf(cash.id)).toMatchObject({
        posted: '1000.00',
        pending: '700.00',
        available: '700.00',
      });
    });

    it('does not let an unsettled deposit fund an outgoing payment', async () => {
      // The reason pending is two columns rather than one signed number. A
      // single net figure would let an inbound authorisation offset an
      // outbound one before either settles.
      const incoming = await services.journal.postEntry({
        description: 'Incoming, not yet settled',
        currency: 'USD',
        status: 'pending',
        postings: [
          { accountId: cash.id, amount: usd(500_000n) },
          { accountId: revenue.id, amount: usd(-500_000n) },
        ],
      });
      expect(incoming.ok).toBe(true);

      const balances = await balancesOf(cash.id);
      // Pending counts it; available does not.
      expect(balances.pending).toBe('6000.00');
      expect(balances.available).toBe('1000.00');

      // So a withdrawal beyond the settled balance is still refused.
      const spend = await authorise(200_000n);
      expect(spend).toMatchObject({ ok: false, error: { code: 'insufficient_funds' } });
    });

    it('refuses a second authorisation the first one has already reserved', async () => {
      // Without reservations both of these see a settled balance of 1,000 and
      // both succeed, overdrawing the account by 600.
      const first = await authorise(80_000n);
      expect(first.ok).toBe(true);

      const second = await authorise(80_000n);
      expect(second).toMatchObject({
        ok: false,
        error: { code: 'insufficient_funds', accountId: cash.id, available: '200.00' },
      });
    });
  });

  describe('settling', () => {
    it('moves the amounts from reserved to posted', async () => {
      const held = await authorise(30_000n);
      if (!held.ok) throw new Error('authorisation failed');

      const settled = await services.journal.postPending(held.value.transaction.id);
      expect(settled.ok).toBe(true);
      expect(settled.ok && settled.value.status).toBe('posted');
      expect(settled.ok && settled.value.postedAt).not.toBeNull();

      // The reservation is released and the money has actually moved.
      expect(await balancesOf(cash.id)).toMatchObject({
        posted: '700.00',
        pending: '700.00',
        available: '700.00',
      });
      expect(await balancesOf(savings.id)).toMatchObject({
        posted: '300.00',
        available: '300.00',
      });
    });

    it('releases the reservation without moving anything when archived', async () => {
      const held = await authorise(30_000n);
      if (!held.ok) throw new Error('authorisation failed');

      const cancelled = await services.journal.archivePending(held.value.transaction.id);
      expect(cancelled.ok).toBe(true);
      expect(cancelled.ok && cancelled.value.status).toBe('archived');

      expect(await balancesOf(cash.id)).toMatchObject({
        posted: '1000.00',
        pending: '1000.00',
        available: '1000.00',
      });
      expect(await balancesOf(savings.id)).toMatchObject({ posted: '0.00' });
    });

    it('refuses to settle an entry twice', async () => {
      const held = await authorise(10_000n);
      if (!held.ok) throw new Error('authorisation failed');

      expect((await services.journal.postPending(held.value.transaction.id)).ok).toBe(true);

      const again = await services.journal.postPending(held.value.transaction.id);
      expect(again).toMatchObject({
        ok: false,
        error: { code: 'invalid_status_transition', from: 'posted', to: 'posted' },
      });
    });

    it('refuses to archive a settled entry', async () => {
      const held = await authorise(10_000n);
      if (!held.ok) throw new Error('authorisation failed');
      await services.journal.postPending(held.value.transaction.id);

      const result = await services.journal.archivePending(held.value.transaction.id);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'invalid_status_transition', from: 'posted' },
      });
    });
  });

  describe('enforced by Postgres, not the service', () => {
    it('refuses to edit anything but the status of a pending entry', async () => {
      const held = await authorise(10_000n);
      if (!held.ok) throw new Error('authorisation failed');
      const id = held.value.transaction.id;

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.update(transactions).set({ description: 'rewritten' }).where(eq(transactions.id, id)),
        ),
        /only the status and metadata of a transaction may change/,
      );
    });

    it('refuses to change a posted entry at all', async () => {
      const page = await services.journal.list({ limit: 1 });
      const posted = page.items[0];
      if (!posted) throw new Error('no posted entry');

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx
            .update(transactions)
            .set({ status: 'archived', archivedAt: new Date() })
            .where(eq(transactions.id, posted.id)),
        ),
        /immutable/,
      );
    });

    it('refuses to move an entry back to pending', async () => {
      const page = await services.journal.list({ limit: 1 });
      const posted = page.items[0];
      if (!posted) throw new Error('no posted entry');

      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.update(transactions).set({ status: 'pending' }).where(eq(transactions.id, posted.id)),
        ),
        /immutable|only move to posted or archived/,
      );
    });

    it('fills the timestamps from the status rather than demanding both', async () => {
      // A plain insert must work. Requiring the writer to supply posted_at
      // would be a trap for hand-written SQL and would have broken every
      // statement written before two-phase entries existed.
      await withTenant(db, db.$orgId, (tx) =>
        tx.insert(transactions).values({
          id: 'txn_plain',
          orgId: db.$orgId,
          description: 'posted without an explicit timestamp',
          currency: 'USD',
          occurredAt: new Date(),
        }),
      );

      const entry = await services.journal.byId('txn_plain');
      expect(entry?.status).toBe('posted');
      expect(entry?.postedAt).not.toBeNull();
    });

    it('cannot end up with a pending entry that claims to have settled', async () => {
      // Two independent defences, which is why this state is unreachable.
      //
      // On insert the normaliser clears a pending entry's timestamps, so
      // supplying one has no effect rather than producing a contradiction.
      await withTenant(db, db.$orgId, (tx) =>
        tx.execute(
          sql`INSERT INTO transactions (id, org_id, description, currency, occurred_at, status, posted_at)
              VALUES ('txn_claims', ${db.$orgId}, 'pending yet posted', 'USD', now(), 'pending', now())`,
        ),
      );
      const inserted = await services.journal.byId('txn_claims');
      expect(inserted?.status).toBe('pending');
      expect(inserted?.postedAt).toBeNull();

      // Afterwards the guard refuses any update that is not a status
      // transition, so the timestamp cannot be set behind the status's back.
      await expectDatabaseError(
        withTenant(db, db.$orgId, (tx) =>
          tx.execute(sql`UPDATE transactions SET posted_at = now() WHERE id = 'txn_claims'`),
        ),
        /may only move to posted or archived|only the status/,
      );
    });
  });

  describe('optimistic concurrency', () => {
    it('applies a write when the account has not moved', async () => {
      const before = await balancesOf(cash.id);

      const result = await services.journal.postEntry({
        description: 'Conditional on version',
        currency: 'USD',
        expectedVersions: { [cash.id]: before.version },
        postings: [
          { accountId: cash.id, amount: usd(-1_000n) },
          { accountId: savings.id, amount: usd(1_000n) },
        ],
      });

      expect(result.ok).toBe(true);
    });

    it('refuses a write against a version that has since moved', async () => {
      const stale = (await balancesOf(cash.id)).version;

      // Something else touches the account in between.
      await authorise(1_000n);

      const result = await services.journal.postEntry({
        description: 'Decided against a stale balance',
        currency: 'USD',
        expectedVersions: { [cash.id]: stale },
        postings: [
          { accountId: cash.id, amount: usd(-1_000n) },
          { accountId: savings.id, amount: usd(1_000n) },
        ],
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'stale_account_version', accountId: cash.id, expected: stale },
      });
    });

    it('advances the version on both settling and archiving', async () => {
      const start = (await balancesOf(cash.id)).version;
      const held = await authorise(1_000n);
      if (!held.ok) throw new Error('authorisation failed');

      const afterHold = (await balancesOf(cash.id)).version;
      expect(afterHold).toBeGreaterThan(start);

      await services.journal.postPending(held.value.transaction.id);
      expect((await balancesOf(cash.id)).version).toBeGreaterThan(afterHold);
    });
  });

  describe('reporting', () => {
    it('keeps the running balance reconciled with the posted balance', async () => {
      // The bug this prevents: a statement whose running total included
      // pending lines would disagree with the posted balance shown beside it,
      // and a reader would have no way to tell which figure was wrong.
      await authorise(30_000n);

      const statement = await services.reporting.statement(cash.id, { limit: 20 });
      expect(statement).toBeDefined();
      if (!statement) return;

      expect(statement.account.balance.amount).toBe('1000.00');
      expect(statement.lines.items[0]?.runningBalance.amount).toBe('1000.00');

      // And the pending line is reported, just not in the ledger.
      expect(statement.pending).toHaveLength(1);
      expect(statement.pending[0]?.description).toBe('Authorisation');
      expect(statement.pending[0]?.direction).toBe('credit');
      expect(statement.lines.items.some((l) => l.description === 'Authorisation')).toBe(false);
    });

    it('moves a settled entry from pending into the ledger', async () => {
      const held = await authorise(30_000n);
      if (!held.ok) throw new Error('authorisation failed');
      await services.journal.postPending(held.value.transaction.id);

      const statement = await services.reporting.statement(cash.id, { limit: 20 });
      expect(statement?.pending).toEqual([]);
      expect(statement?.lines.items[0]?.description).toBe('Authorisation');
      expect(statement?.lines.items[0]?.runningBalance.amount).toBe('700.00');
    });

    it('keeps the trial balance on settled entries only', async () => {
      await authorise(30_000n);

      // A pending entry has not moved money, so it must not appear in a
      // statement of position — otherwise the books would show value that
      // does not exist yet.
      const rows = await services.reporting.trialBalance();
      expect(rows.every((row) => row.balanced)).toBe(true);

      const sheet = await services.reporting.balanceSheet();
      expect(sheet.balanced).toBe(true);
      expect(sheet.assets.total.amount).toBe('1000.00');
    });
  });
});

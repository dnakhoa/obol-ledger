import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import { fingerprintOf } from '@/server/services/idempotency';
import type { AccountDto } from '@/server/services/dto';

describe('journal service', () => {
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
  });

  afterEach(async () => {
    await db.$close();
  });

  /** Gives `cash` a starting balance without going through the code under test. */
  async function fund(amount: bigint) {
    const result = await services.journal.postEntry({
      description: 'Opening balance',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(amount) },
        { accountId: revenue.id, amount: usd(-amount) },
      ],
    });
    if (!result.ok) throw new Error(`funding failed: ${result.error.code}`);
    return result.value.transaction;
  }

  it('records a balanced entry and moves both balances', async () => {
    const entry = await fund(50_000n);

    expect(entry.postings).toHaveLength(2);
    expect(entry.postings.map((posting) => posting.direction)).toEqual(['debit', 'credit']);

    const after = await services.accounts.list();
    const balances = Object.fromEntries(after.map((a) => [a.name, a.balance.amount]));
    expect(balances).toMatchObject({ Cash: '500.00', Sales: '500.00' });
  });

  it('preserves the caller ordering of postings regardless of insert order', async () => {
    // Postings are inserted in account-id order to keep lock ordering stable,
    // but the entry must read back the way it was written.
    const result = await services.journal.postEntry({
      description: 'Ordering',
      currency: 'USD',
      postings: [
        { accountId: revenue.id, amount: usd(-2_500n) },
        { accountId: cash.id, amount: usd(2_500n) },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transaction.postings.map((p) => p.accountId)).toEqual([
      revenue.id,
      cash.id,
    ]);
    expect(result.value.transaction.postings.map((p) => p.sequence)).toEqual([0, 1]);
  });

  it('rejects an unbalanced entry before touching the database', async () => {
    const result = await services.journal.postEntry({
      description: 'Off by one cent',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(1_000n) },
        { accountId: revenue.id, amount: usd(-999n) },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unbalanced_transaction', residual: '0.01' },
    });
    // Nothing was written, so no entry exists.
    expect((await services.journal.list({ limit: 10 })).items).toHaveLength(0);
  });

  it('rejects a single-sided entry', async () => {
    const result = await services.journal.postEntry({
      description: 'One-legged',
      currency: 'USD',
      postings: [{ accountId: cash.id, amount: usd(1_000n) }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'too_few_postings', count: 1 } });
  });

  it('rejects an entry that names the same account twice', async () => {
    const result = await services.journal.postEntry({
      description: 'Self-netting',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(1_000n) },
        { accountId: cash.id, amount: usd(-1_000n) },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'duplicate_account_in_transaction' },
    });
  });

  it('reports insufficient funds with the figures the caller needs', async () => {
    await fund(10_000n);

    const result = await services.journal.postEntry({
      description: 'Overdraw',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(-15_000n) },
        { accountId: savings.id, amount: usd(15_000n) },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'insufficient_funds',
        accountId: cash.id,
        available: '100.00',
        requested: '150.00',
        currency: 'USD',
      },
    });

    // The failed attempt rolled back cleanly: the balance is untouched.
    const reread = await services.accounts.byId(cash.id);
    expect(reread.ok && reread.value.balance.amount).toBe('100.00');
  });

  it('rolls the whole entry back when any part of it fails', async () => {
    await fund(10_000n);
    const before = await services.journal.list({ limit: 10 });

    const result = await services.journal.postEntry({
      description: 'References a ghost',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(-500n) },
        { accountId: 'acct_does_not_exist', amount: usd(500n) },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'account_not_found' } });
    const after = await services.journal.list({ limit: 10 });
    expect(after.items).toHaveLength(before.items.length);
  });

  it('refuses to post to a closed account', async () => {
    await fund(10_000n);
    await services.accounts.close(savings.id);

    const result = await services.journal.postEntry({
      description: 'To a closed account',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(-500n) },
        { accountId: savings.id, amount: usd(500n) },
      ],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'account_closed' } });
  });

  it('refuses to mix currencies inside one entry', async () => {
    const euro = await openAccount(db, db.$orgId, {
      name: 'Euro cash',
      type: 'asset',
      currency: 'EUR',
    });
    const result = await services.journal.postEntry({
      description: 'Cross currency',
      currency: 'USD',
      postings: [
        { accountId: cash.id, amount: usd(-500n) },
        { accountId: euro.id, amount: usd(500n) },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'currency_mismatch', expected: 'EUR', received: 'USD' },
    });
  });

  describe('idempotency', () => {
    const body = { description: 'Idempotent', amount: '25.00' };

    it('replays the stored response instead of posting twice', async () => {
      const idempotency = { key: 'key-1', fingerprint: fingerprintOf(body) };
      const input = {
        description: 'Idempotent',
        currency: 'USD' as const,
        postings: [
          { accountId: cash.id, amount: usd(2_500n) },
          { accountId: revenue.id, amount: usd(-2_500n) },
        ],
        idempotency,
      };

      const first = await services.journal.postEntry(input);
      const second = await services.journal.postEntry(input);

      expect(first.ok && first.value.replayed).toBe(false);
      expect(second.ok && second.value.replayed).toBe(true);
      expect(first.ok && second.ok && second.value.transaction.id).toBe(
        first.ok ? first.value.transaction.id : undefined,
      );

      // One entry, not two — and the balance moved exactly once.
      expect((await services.journal.list({ limit: 10 })).items).toHaveLength(1);
      const reread = await services.accounts.byId(cash.id);
      expect(reread.ok && reread.value.balance.amount).toBe('25.00');
    });

    it('rejects a key reused for a different request', async () => {
      await services.journal.postEntry({
        description: 'First',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(2_500n) },
          { accountId: revenue.id, amount: usd(-2_500n) },
        ],
        idempotency: { key: 'key-2', fingerprint: fingerprintOf({ amount: '25.00' }) },
      });

      const result = await services.journal.postEntry({
        description: 'Different',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(9_900n) },
          { accountId: revenue.id, amount: usd(-9_900n) },
        ],
        idempotency: { key: 'key-2', fingerprint: fingerprintOf({ amount: '99.00' }) },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'idempotency_key_reused', key: 'key-2' },
      });
      expect((await services.journal.list({ limit: 10 })).items).toHaveLength(1);
    });

    it('does not burn the key when the entry itself is rejected', async () => {
      const idempotency = { key: 'key-3', fingerprint: fingerprintOf(body) };

      const failed = await services.journal.postEntry({
        description: 'Overdraw',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(-5_000n) },
          { accountId: savings.id, amount: usd(5_000n) },
        ],
        idempotency,
      });
      expect(failed.ok).toBe(false);

      // The claim was rolled back with the entry, so the key is free again.
      await fund(10_000n);
      const retried = await services.journal.postEntry({
        description: 'Now affordable',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(-5_000n) },
          { accountId: savings.id, amount: usd(5_000n) },
        ],
        idempotency,
      });
      expect(retried.ok && retried.value.replayed).toBe(false);
    });
  });

  describe('ordering', () => {
    it('orders by when things happened, not by when they were recorded', async () => {
      // Entries are frequently recorded out of order — a back-dated invoice, a
      // batch import. A journal sorted by insertion order would interleave them
      // apparently at random.
      const days = [5, 1, 9, 3];
      for (const day of days) {
        const occurredAt = new Date(Date.UTC(2026, 0, day, 12, 0, 0));
        const result = await services.journal.postEntry({
          description: `Day ${day}`,
          currency: 'USD',
          occurredAt,
          postings: [
            { accountId: cash.id, amount: usd(1_000n) },
            { accountId: revenue.id, amount: usd(-1_000n) },
          ],
        });
        expect(result.ok).toBe(true);
      }

      const page = await services.journal.list({ limit: 10 });
      expect(page.items.map((item) => item.description)).toEqual([
        'Day 9',
        'Day 5',
        'Day 3',
        'Day 1',
      ]);
    });

    it('breaks ties on the id so the order is total and stable', async () => {
      // Two entries sharing a timestamp still need a deterministic order, or a
      // keyset cursor could skip or repeat one of them.
      const sharedTime = new Date(Date.UTC(2026, 0, 15, 9, 0, 0));
      for (let i = 0; i < 4; i += 1) {
        await services.journal.postEntry({
          description: `Simultaneous ${i}`,
          currency: 'USD',
          occurredAt: sharedTime,
          postings: [
            { accountId: cash.id, amount: usd(100n) },
            { accountId: revenue.id, amount: usd(-100n) },
          ],
        });
      }

      const first = await services.journal.list({ limit: 2 });
      const second = await services.journal.list({
        limit: 2,
        cursor: first.nextCursor ?? undefined,
      });
      const ids = [...first.items, ...second.items].map((item) => item.id);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('filtering', () => {
    it('restricts to entries touching an account', async () => {
      const other = await openAccount(db, db.$orgId, {
        name: 'Other',
        type: 'asset',
        overdraftAllowed: true,
      });
      await fund(10_000n);
      const unrelated = await services.journal.postEntry({
        description: 'Unrelated movement',
        currency: 'USD',
        postings: [
          { accountId: other.id, amount: usd(500n) },
          { accountId: revenue.id, amount: usd(-500n) },
        ],
      });
      expect(unrelated.ok).toBe(true);

      const filtered = await services.journal.list({ limit: 20, accountId: other.id });
      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]?.description).toBe('Unrelated movement');

      // Unfiltered still sees both.
      expect((await services.journal.list({ limit: 20 })).items).toHaveLength(2);
    });

    it('matches a description case-insensitively', async () => {
      await services.journal.postEntry({
        description: 'Invoice 1042 settled',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(1_000n) },
          { accountId: revenue.id, amount: usd(-1_000n) },
        ],
      });
      await fund(1_000n);

      const hit = await services.journal.list({ limit: 20, search: 'invoice' });
      expect(hit.items).toHaveLength(1);
      expect(hit.items[0]?.description).toBe('Invoice 1042 settled');

      const miss = await services.journal.list({ limit: 20, search: 'nothing matches this' });
      expect(miss.items).toEqual([]);
      expect(miss.nextCursor).toBeNull();
    });

    it('combines filters with the keyset cursor rather than replacing it', async () => {
      // A filtered list must page exactly as an unfiltered one does, or the
      // second page silently ignores the filter.
      for (let i = 0; i < 5; i += 1) {
        await services.journal.postEntry({
          description: `Payroll run ${i}`,
          currency: 'USD',
          postings: [
            { accountId: cash.id, amount: usd(100n) },
            { accountId: revenue.id, amount: usd(-100n) },
          ],
        });
      }
      await fund(5_000n);

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await services.journal.list({ limit: 2, cursor, search: 'payroll' });
        for (const item of page.items) {
          expect(item.description).toContain('Payroll');
        }
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('applies both filters together', async () => {
      const other = await openAccount(db, db.$orgId, {
        name: 'Other',
        type: 'asset',
        overdraftAllowed: true,
      });
      await services.journal.postEntry({
        description: 'Rent for March',
        currency: 'USD',
        postings: [
          { accountId: other.id, amount: usd(500n) },
          { accountId: revenue.id, amount: usd(-500n) },
        ],
      });
      await services.journal.postEntry({
        description: 'Rent for April',
        currency: 'USD',
        postings: [
          { accountId: cash.id, amount: usd(500n) },
          { accountId: revenue.id, amount: usd(-500n) },
        ],
      });

      const page = await services.journal.list({
        limit: 20,
        accountId: other.id,
        search: 'rent',
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.description).toBe('Rent for March');
    });
  });

  describe('pagination', () => {
    it('walks every entry exactly once with a keyset cursor', async () => {
      for (let i = 0; i < 7; i += 1) await fund(1_000n);

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await services.journal.list({ limit: 3, cursor });
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it('walks back through exactly the pages it walked forward', async () => {
      // The round trip is the assertion that matters. A backward cursor that is
      // off by one row would silently skip or repeat an entry, and no
      // forward-only test would ever notice.
      for (let i = 0; i < 9; i += 1) await fund(1_000n);

      const forward: string[][] = [];
      let cursor: string | undefined;
      let lastPage = await services.journal.list({ limit: 4 });
      do {
        const page = await services.journal.list({ limit: 4, cursor });
        forward.push(page.items.map((item) => item.id));
        lastPage = page;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      expect(forward.flat()).toHaveLength(9);

      // From the final page, walk back to the first.
      const backward: string[][] = [lastPage.items.map((item) => item.id)];
      let previous = lastPage.previousCursor ?? undefined;
      while (previous) {
        const page = await services.journal.list({
          limit: 4,
          cursor: previous,
          direction: 'backward',
        });
        backward.unshift(page.items.map((item) => item.id));
        previous = page.previousCursor ?? undefined;
      }

      expect(backward).toEqual(forward);
    });

    it('offers no previous page on the first page and no next on the last', async () => {
      for (let i = 0; i < 3; i += 1) await fund(1_000n);

      const first = await services.journal.list({ limit: 2 });
      expect(first.previousCursor).toBeNull();
      expect(first.nextCursor).not.toBeNull();

      const last = await services.journal.list({ limit: 2, cursor: first.nextCursor ?? undefined });
      expect(last.nextCursor).toBeNull();
      expect(last.previousCursor).not.toBeNull();
    });

    it('ignores a backward direction when there is no cursor to walk back from', async () => {
      await fund(1_000n);
      const page = await services.journal.list({ limit: 5, direction: 'backward' });
      expect(page.items).toHaveLength(1);
      expect(page.previousCursor).toBeNull();
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLivePostgres, LIVE_DATABASE_URL, type LivePostgres } from '../helpers/live-postgres';
import { createAccountService } from '@/server/services/accounts';
import { createJournalService } from '@/server/services/journal';
import { withTenant } from '@/server/db/tenancy';
import { accounts } from '@/server/db/schema';
import { minorUnits } from '@/lib/money';
import type { AccountDto } from '@/server/services/dto';

/**
 * Claims about concurrency, checked against real concurrency.
 *
 * `src/server/services/journal.ts` states that postings are inserted in
 * account-id order so that two entries touching the same pair of accounts take
 * row locks in the same order and cannot deadlock. That was a comment, and a
 * comment is not evidence — PGlite is a single connection, so the main suite
 * physically cannot express two transactions racing.
 *
 * These run against a real server over independent connections. Without
 * `CONCURRENCY_DATABASE_URL` they skip, so `pnpm test` stays green for someone
 * without Postgres; CI always provides one.
 */
const suite = LIVE_DATABASE_URL ? describe : describe.skip;

suite('concurrent transfers', () => {
  let live: LivePostgres;
  let cash: AccountDto;
  let savings: AccountDto;
  let capital: AccountDto;

  const TRANSFER = minorUnits(100n);

  beforeAll(async () => {
    live = await createLivePostgres();
    const accountService = createAccountService(live.database, live.orgId);

    cash = await accountService.create({
      name: 'Cash',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    savings = await accountService.create({
      name: 'Savings',
      type: 'asset',
      currency: 'USD',
      overdraftAllowed: true,
    });
    capital = await accountService.create({
      name: 'Capital',
      type: 'equity',
      currency: 'USD',
      overdraftAllowed: true,
    });

    // Fund both accounts so neither can hit the overdraft rule mid-race.
    const journal = createJournalService(live.database, live.orgId);
    for (const account of [cash, savings]) {
      const result = await journal.postEntry({
        description: `Opening ${account.name}`,
        currency: 'USD',
        postings: [
          { accountId: account.id, amount: minorUnits(1_000_000n) },
          { accountId: capital.id, amount: minorUnits(-1_000_000n) },
        ],
      });
      expect(result.ok).toBe(true);
    }
  }, 60_000);

  afterAll(async () => {
    await live?.close();
  });

  async function balanceOf(accountId: string): Promise<bigint> {
    return withTenant(live.database, live.orgId, async (tx) => {
      const [row] = await tx
        .select({ balance: accounts.balanceMinor })
        .from(accounts)
        .where(sql`${accounts.id} = ${accountId}`);
      return row?.balance ?? 0n;
    });
  }

  it('survives transfers racing in opposite directions without deadlocking', async () => {
    // The classic deadlock shape: A→B and B→A at the same time. If the two
    // transactions locked their accounts in the order the caller listed them,
    // each would hold what the other needs and Postgres would abort one with
    // 40P01. Inserting in account-id order means both take the same lock first.
    const before = (await balanceOf(cash.id)) + (await balanceOf(savings.id));
    const rounds = 40;

    const journal = createJournalService(live.database, live.orgId);
    const work = Array.from({ length: rounds * 2 }, (_, index) => {
      const [from, to] = index % 2 === 0 ? [cash, savings] : [savings, cash];
      return journal.postEntry({
        description: `Race ${index}`,
        currency: 'USD',
        postings: [
          { accountId: to.id, amount: TRANSFER },
          { accountId: from.id, amount: minorUnits(-TRANSFER) },
        ],
      });
    });

    const results = await Promise.all(work);

    const failures = results.filter((result) => !result.ok);
    expect(failures).toEqual([]);

    // Equal numbers each way, so the pair nets to exactly where it started.
    const after = (await balanceOf(cash.id)) + (await balanceOf(savings.id));
    expect(after).toBe(before);
  }, 120_000);

  it('loses no update when many transfers target one account', async () => {
    // The lost-update shape. Balances are maintained by an AFTER INSERT trigger
    // doing `balance = balance + delta`, which takes the row lock for the rest
    // of the transaction — so concurrent writers serialise rather than each
    // reading the same stale value and overwriting one another.
    const before = await balanceOf(savings.id);
    const transfers = 60;

    const journal = createJournalService(live.database, live.orgId);
    const work = Array.from({ length: transfers }, (_, index) =>
      journal.postEntry({
        description: `Contended ${index}`,
        currency: 'USD',
        postings: [
          { accountId: savings.id, amount: TRANSFER },
          { accountId: cash.id, amount: minorUnits(-TRANSFER) },
        ],
      }),
    );

    const results = await Promise.all(work);
    expect(results.filter((result) => !result.ok)).toEqual([]);

    const after = await balanceOf(savings.id);
    expect(after - before).toBe(TRANSFER * BigInt(transfers));
  }, 120_000);

  it('serialises duplicate idempotency keys instead of racing them', async () => {
    // The key is claimed before any work happens, inside the same transaction
    // as the entry. A concurrent duplicate therefore blocks on the primary key
    // until the first settles — so exactly one of these posts, and the rest
    // replay its stored response.
    const key = `race-${Date.now()}`;
    const attempts = 8;

    const journal = createJournalService(live.database, live.orgId);
    const work = Array.from({ length: attempts }, () =>
      journal.postEntry({
        description: 'Simultaneous retry',
        currency: 'USD',
        postings: [
          { accountId: savings.id, amount: TRANSFER },
          { accountId: cash.id, amount: minorUnits(-TRANSFER) },
        ],
        idempotency: { key, fingerprint: 'same-body' },
      }),
    );

    const results = await Promise.all(work);
    const succeeded = results.filter((result) => result.ok);
    expect(succeeded).toHaveLength(attempts);

    const written = succeeded.filter((result) => result.ok && !result.value.replayed);
    const replayed = succeeded.filter((result) => result.ok && result.value.replayed);

    // Exactly one did the work; every other attempt replayed that same entry.
    expect(written).toHaveLength(1);
    expect(replayed).toHaveLength(attempts - 1);

    const ids = new Set(succeeded.map((r) => (r.ok ? r.value.transaction.id : '')));
    expect(ids.size).toBe(1);
  }, 120_000);
});

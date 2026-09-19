import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { openAccount, servicesFor, usd } from '../helpers/fixtures';
import { setDatabaseForTesting } from '@/server/db/client';
import { resetRateLimits } from '@/server/http/rate-limit';
import { GET as search } from '@/app/api/search/route';

/**
 * The command palette's search.
 *
 * One box over three kinds of thing, because the person typing does not know
 * which of the three their reference lives in — that is the entire point of a
 * single box, and it is also where a search feature quietly becomes wrong.
 */
describe('palette search', () => {
  let db: TestDatabase;
  let services: ReturnType<typeof servicesFor>;

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();
    process.env['DEMO_ORG_SLUG'] = 'primary';
    services = servicesFor(db, db.$orgId);
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  async function get(query: string) {
    const response = await search(
      new Request(`https://ledger.test/api/search?q=${encodeURIComponent(query)}`),
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        accounts: { id: string; name: string; balance: string; currency: string }[];
        entries: { id: string; description: string }[];
      },
    };
  }

  it('answers nothing for a query too short to mean anything', async () => {
    // One character matches most of a chart of accounts, which is a list, not
    // an answer — and it costs a database round trip per keystroke to produce.
    const { body } = await get('o');
    expect(body.accounts).toHaveLength(0);
    expect(body.entries).toHaveLength(0);
  });

  it('finds accounts and entries in one response', async () => {
    const cash = await openAccount(db, db.$orgId, {
      name: 'Operating Cash',
      type: 'asset',
      overdraftAllowed: true,
    });
    const savings = await openAccount(db, db.$orgId, { name: 'Reserve', type: 'asset' });
    await services.journal.postEntry({
      description: 'Operating float top-up',
      currency: 'USD',
      postings: [
        { accountId: savings.id, amount: usd(2500n) },
        { accountId: cash.id, amount: usd(-2500n) },
      ],
    });

    const { body } = await get('operating');
    expect(body.accounts.map((account) => account.name)).toEqual(['Operating Cash']);
    expect(body.entries.map((entry) => entry.description)).toEqual(['Operating float top-up']);
  });

  it('matches case-insensitively', async () => {
    await openAccount(db, db.$orgId, { name: 'Operating Cash', type: 'asset' });
    const { body } = await get('OPERATING');
    expect(body.accounts).toHaveLength(1);
  });

  it('returns the balance split from its currency, not a pre-joined string', async () => {
    // The palette groups the digits for display. Handing it "1234.00 USD"
    // would force it to split a formatted string back apart, which is how a
    // currency ends up inside a thousands separator.
    await openAccount(db, db.$orgId, { name: 'Operating Cash', type: 'asset' });
    const { body } = await get('operating');
    expect(body.accounts[0]?.balance).toMatch(/^-?\d+\.\d+$/u);
    expect(body.accounts[0]?.currency).toBe('USD');
  });

  it('returns an empty result rather than failing when nothing matches', async () => {
    const { status, body } = await get('zzzznothing');
    expect(status).toBe(200);
    expect(body.accounts).toHaveLength(0);
    expect(body.entries).toHaveLength(0);
  });

  it('does not reach into another tenant', async () => {
    // The route resolves the demo tenant and every query runs under its
    // policy, so this is the database's guarantee rather than the route's —
    // but a search box is exactly where a forgotten scope would show up.
    const other = servicesFor(db, await createOther());
    await other.accounts.create({ name: 'Secret Vault', type: 'asset', currency: 'USD' });

    const { body } = await get('secret');
    expect(body.accounts).toHaveLength(0);
  });

  async function createOther(): Promise<string> {
    const { createOrganization } = await import('../helpers/fixtures');
    return createOrganization(db, 'other');
  }
});

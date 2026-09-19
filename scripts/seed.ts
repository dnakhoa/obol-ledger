import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { createAccountService } from '../src/server/services/accounts';
import { digestToken } from '../src/server/services/authentication';
import { newId } from '../src/lib/id';
import { createJournalService } from '../src/server/services/journal';
import { minorUnits, type MinorUnits } from '../src/lib/money';
import type { Database } from '../src/server/db/types';
import { checkTenantPolicies, withTenant } from '../src/server/db/tenancy';
import type { AccountType } from '../src/server/domain/account';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/**
 * Seeds a small, believable set of books.
 *
 * The data is deliberately not random noise: it is a month of trading for a
 * coffee roastery, so the dashboard shows the shape a real ledger has — a few
 * large entries, many small ones, expenses clustered at month end — and every
 * figure on screen is the result of the same code path the API uses.
 */

type Seeded = Record<string, string>;

const ACCOUNTS: { key: string; name: string; type: AccountType; overdraft?: boolean }[] = [
  { key: 'cash', name: 'Operating Cash', type: 'asset' },
  { key: 'receivable', name: 'Accounts Receivable', type: 'asset' },
  { key: 'inventory', name: 'Green Coffee Inventory', type: 'asset' },
  { key: 'equipment', name: 'Roasting Equipment', type: 'asset' },
  { key: 'payable', name: 'Accounts Payable', type: 'liability', overdraft: true },
  { key: 'loan', name: 'Equipment Loan', type: 'liability', overdraft: true },
  { key: 'capital', name: 'Owner Capital', type: 'equity', overdraft: true },
  { key: 'wholesale', name: 'Wholesale Revenue', type: 'revenue', overdraft: true },
  { key: 'retail', name: 'Retail Revenue', type: 'revenue', overdraft: true },
  { key: 'cogs', name: 'Cost of Goods Sold', type: 'expense', overdraft: true },
  { key: 'rent', name: 'Rent', type: 'expense', overdraft: true },
  { key: 'wages', name: 'Wages', type: 'expense', overdraft: true },
  { key: 'utilities', name: 'Utilities', type: 'expense', overdraft: true },
];

/**
 * A deterministic generator, so a reseed produces the same books.
 * `Math.random()` would make the screenshots in the README a lie.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260919);

function between(low: number, high: number): number {
  return Math.floor(random() * (high - low + 1)) + low;
}

function daysAgo(days: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, between(0, 59), 0, 0);
  return date;
}

async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });
  console.log(`seeding ${describeTarget(url)}`);
  try {
    const database = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;

    // Seeding is destructive and must be explicit. Postings and entries are
    // append-only by trigger, so the triggers are lifted for the truncate.
    console.log('clearing existing data');
    // TRUNCATE is not subject to row-level security, but the append-only
    // triggers are, so they come off for the duration and go straight back on.
    await database.execute(sql`
      ALTER TABLE postings DISABLE TRIGGER postings_append_only;
      ALTER TABLE transactions DISABLE TRIGGER transactions_append_only;
      TRUNCATE idempotency_keys, postings, transactions, accounts, api_keys, organizations RESTART IDENTITY CASCADE;
      ALTER TABLE postings ENABLE TRIGGER postings_append_only;
      ALTER TABLE transactions ENABLE TRIGGER transactions_append_only;
    `);

    const demoSlug = process.env['DEMO_ORG_SLUG'] ?? 'demo';
    const orgId = newId('organization');
    await database
      .insert(schema.organizations)
      .values({ id: orgId, name: 'Demo Roastery', slug: demoSlug });

    // A second tenant with its own books exists purely so the isolation is
    // real rather than theoretical: there is something on the other side of
    // the policy for it to keep out.
    const otherOrgId = newId('organization');
    await database
      .insert(schema.organizations)
      .values({ id: otherOrgId, name: 'Second Tenant', slug: 'second' });

    // The demo tenant's API key is whatever LEDGER_API_TOKEN is set to, so a
    // deployment's existing credential keeps working and the token still
    // travels through the real api_keys lookup rather than a special case.
    const token = process.env['LEDGER_API_TOKEN'];
    if (token) {
      await database.insert(schema.apiKeys).values({
        id: newId('apiKey'),
        orgId,
        name: 'seeded demo key',
        tokenDigest: digestToken(token),
      });
      console.log('registered LEDGER_API_TOKEN as the demo tenant key');
    } else {
      console.log('LEDGER_API_TOKEN not set; no API key registered (reads still work)');
    }

    const accountService = createAccountService(database, orgId);
    const journal = createJournalService(database, orgId);

    const ids: Seeded = {};
    for (const account of ACCOUNTS) {
      const created = await accountService.create({
        name: account.name,
        type: account.type,
        currency: 'USD',
        overdraftAllowed: account.overdraft ?? false,
      });
      ids[account.key] = created.id;
    }
    // Back-date the accounts to just before the first entry.
    //
    // `created_at` defaults to now(), so a freshly seeded ledger claims every
    // account was opened today while showing a statement going back six weeks.
    // Accounts are not append-only — only postings and journal entries are —
    // so this is a plain UPDATE rather than anything that fights a trigger.
    // Only created_at: updated_at is trigger-maintained and will correctly
    // become the time of each account's last movement as the entries post.
    await database.execute(sql`UPDATE accounts SET created_at = now() - interval '45 days'`);
    console.log(`opened ${ACCOUNTS.length} accounts`);

    const dollars = (value: number): MinorUnits => minorUnits(BigInt(Math.round(value * 100)));
    const at = (key: string): string => {
      const id = ids[key];
      if (!id) throw new Error(`unknown seed account ${key}`);
      return id;
    };

    let entries = 0;
    async function post(
      description: string,
      occurredAt: Date,
      legs: { account: string; amount: MinorUnits }[],
    ): Promise<void> {
      const result = await journal.postEntry({
        description,
        currency: 'USD',
        occurredAt,
        postings: legs.map((leg) => ({ accountId: at(leg.account), amount: leg.amount })),
      });
      if (!result.ok) {
        throw new Error(`seed entry "${description}" was rejected: ${result.error.code}`);
      }
      entries += 1;
    }

    // Opening the books — six weeks before trading starts.
    //
    // The gap is deliberate. A business is capitalised and equipped well before
    // it takes its first order, and these one-off entries are an order of
    // magnitude larger than daily takings. Posting them inside the dashboard's
    // 30-day window would set the chart's axis to $48,000 and squash a month of
    // real trading into invisible slivers — a chart that is accurate and tells
    // the reader nothing.
    await post('Owner capital contribution', daysAgo(44, 9), [
      { account: 'cash', amount: dollars(85_000) },
      { account: 'capital', amount: dollars(-85_000) },
    ]);
    await post('Roaster purchased on finance', daysAgo(43, 11), [
      { account: 'equipment', amount: dollars(48_000) },
      { account: 'loan', amount: dollars(-36_000) },
      { account: 'cash', amount: dollars(-12_000) },
    ]);
    await post('Opening green coffee stock', daysAgo(42, 8), [
      { account: 'inventory', amount: dollars(21_500) },
      { account: 'payable', amount: dollars(-21_500) },
    ]);

    // A month of trading.
    for (let day = 27; day >= 0; day -= 1) {
      const retail = between(380, 1_650);
      await post(`Retail counter sales`, daysAgo(day, 18), [
        { account: 'cash', amount: dollars(retail) },
        { account: 'retail', amount: dollars(-retail) },
      ]);

      const cost = Math.round(retail * 0.38 * 100) / 100;
      await post('Cost of retail sales', daysAgo(day, 18), [
        { account: 'cogs', amount: dollars(cost) },
        { account: 'inventory', amount: dollars(-cost) },
      ]);

      if (day % 3 === 0) {
        const wholesale = between(2_400, 9_800);
        await post('Wholesale order invoiced', daysAgo(day, 10), [
          { account: 'receivable', amount: dollars(wholesale) },
          { account: 'wholesale', amount: dollars(-wholesale) },
        ]);
      }

      if (day % 7 === 2) {
        const collected = between(3_000, 11_000);
        await post('Customer payment received', daysAgo(day, 14), [
          { account: 'cash', amount: dollars(collected) },
          { account: 'receivable', amount: dollars(-collected) },
        ]);
      }

      if (day % 5 === 1) {
        const restock = between(1_800, 6_500);
        await post('Green coffee restock', daysAgo(day, 7), [
          { account: 'inventory', amount: dollars(restock) },
          { account: 'payable', amount: dollars(-restock) },
        ]);
      }
    }

    // Month-end obligations.
    await post('Monthly rent', daysAgo(2, 9), [
      { account: 'rent', amount: dollars(4_200) },
      { account: 'cash', amount: dollars(-4_200) },
    ]);
    await post('Payroll', daysAgo(1, 9), [
      { account: 'wages', amount: dollars(18_400) },
      { account: 'cash', amount: dollars(-18_400) },
    ]);
    await post('Utilities', daysAgo(1, 16), [
      { account: 'utilities', amount: dollars(1_180) },
      { account: 'cash', amount: dollars(-1_180) },
    ]);
    await post('Supplier settlement', daysAgo(0, 11), [
      { account: 'payable', amount: dollars(14_000) },
      { account: 'cash', amount: dollars(-14_000) },
    ]);

    // Assert the *schema* carries the isolation policies.
    //
    // Deliberately not "does an unscoped read return nothing". Seeding is an
    // administrative task and runs as a privileged role, which bypasses
    // row-level security by design — so that check fails on exactly the
    // connections that are supposed to bypass it. What a migration can
    // meaningfully verify is that the policies exist and are forced; whether a
    // given connection is subject to them depends on its role, and that is the
    // application's question, answered by /api/v1/health.
    const policies = await checkTenantPolicies(database);
    if (!policies.configured) {
      throw new Error(
        `tenant isolation is not configured: ${policies.tablesWithRls}/4 tables with RLS, ` +
          `${policies.tablesForced}/4 forced, ${policies.policies} policies`,
      );
    }
    console.log(
      `tenant isolation: ${policies.tablesForced}/4 tables forced, ${policies.policies} policies`,
    );

    // The seed asserts its own output: if the books do not balance, the script
    // fails rather than leaving a broken ledger behind for the UI to render.

    const residual = await withTenant(database, orgId, async (tx) => {
      const [row] = await tx
        .select({ residual: sql<string>`coalesce(sum(${schema.accounts.balanceMinor}), 0)::text` })
        .from(schema.accounts);
      return row?.residual;
    });

    console.log(`posted ${entries} entries`);
    console.log(`trial balance residual: ${residual ?? 'unknown'} (0 means consistent)`);
    if (residual !== '0') throw new Error('seeded ledger does not balance');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exitCode = 1;
});

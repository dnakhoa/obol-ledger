import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { createOrganization, openAccount, servicesFor, usd } from '../helpers/fixtures';
import { ATTACK_IDS, createAttackService, type AttackResult } from '@/server/services/attacks';

/**
 * The attacks behind "Try to break it".
 *
 * The page makes two promises, and these hold it to both. Each attack is
 * refused by the guard it names — not by some other error that happens to fire
 * first, which would make the page a lie that looks like a proof. And nothing
 * an attack writes survives, including when a guard has been removed and the
 * attack gets through: that is the case the page exists to detect, and the one
 * in which it must not become the corruption it reports.
 */
describe('attacks on the ledger', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    const services = servicesFor(db, db.$orgId);
    const cash = await openAccount(db, db.$orgId, { name: 'Cash', type: 'asset' });
    const sales = await openAccount(db, db.$orgId, {
      name: 'Sales',
      type: 'revenue',
      overdraftAllowed: true,
    });
    await openAccount(db, db.$orgId, { name: 'Rent', type: 'expense', overdraftAllowed: true });

    for (const amount of [50_000n, 20_000n]) {
      const posted = await services.journal.postEntry({
        description: `Invoice ${amount}`,
        currency: 'USD',
        occurredAt: new Date('2026-05-10T12:00:00Z'),
        postings: [
          { accountId: cash.id, amount: usd(amount) },
          { accountId: sales.id, amount: usd(-amount) },
        ],
      });
      if (!posted.ok) throw new Error(`setup failed: ${posted.error.code}`);
    }

    // A neighbour with books of its own, for the attacks that reach across.
    const other = await createOrganization(db, 'neighbour');
    await openAccount(db, other, { name: 'Their cash', type: 'asset' });
  });

  afterEach(async () => {
    await db.$close();
  });

  /** Row counts and balances — everything an attack could leave behind. */
  async function snapshot() {
    await db.execute(sql`select set_config('app.current_org', ${db.$orgId}, false)`);
    const result = (await db.execute(sql`
      select
        (select count(*) from transactions)::int as transactions,
        (select count(*) from postings)::int as postings,
        (select count(*) from accounts)::int as accounts,
        (select count(*) from accounting_periods)::int as periods,
        (select string_agg(balance_minor::text, ',' order by id) from accounts) as balances
    `)) as unknown as { rows: unknown[] };
    await db.execute(sql`select set_config('app.current_org', '', false)`);
    return result.rows[0];
  }

  async function run(id: (typeof ATTACK_IDS)[number]): Promise<AttackResult> {
    return createAttackService(db, db.$orgId).run(id);
  }

  it('is refused by the guard each attack names, and leaves nothing behind', async () => {
    const before = await snapshot();

    const unbalanced = await run('unbalanced');
    expect(unbalanced.verdict).toBe('refused');
    expect(unbalanced.error?.condition).toBe('check_violation');
    expect(unbalanced.error?.message).toMatch(/unbalanced by 1 minor units/);
    // Refused by the deferred check, at the statement standing in for COMMIT.
    expect(unbalanced.refusedAt).toBe(2);

    const rewrite = await run('rewrite');
    expect(rewrite.error?.message).toMatch(/postings is append-only; UPDATE/);

    const erase = await run('erase');
    expect(erase.error?.message).toMatch(/append-only; DELETE/);

    const overdraw = await run('overdraw');
    expect(overdraw.error?.constraint).toBe('accounts_overdraft_check');
    // One cent more than the 700.00 the account holds.
    expect(overdraw.target?.amount).toBe('700.01');

    const currency = await run('wrong-currency');
    expect(currency.error?.constraint).toBe('postings_account_currency_fk');

    const twice = await run('reverse-twice');
    // The first reversal is legitimate; it is the second the index stops.
    expect(twice.refusedAt).toBe(1);
    expect(twice.error?.constraint).toBe('transactions_one_reversal_per_entry');

    const backdate = await run('backdate');
    expect(backdate.error?.message).toMatch(/period 2026-05 is closed/);

    const plant = await run('plant');
    expect(plant.error?.condition).toBe('insufficient_privilege');
    expect(plant.error?.message).toMatch(/row-level security/);

    const peek = await run('peek');
    expect(peek.verdict).toBe('held');
    expect(peek.rowsSeen).toBe(0);

    expect(await snapshot()).toEqual(before);
  });

  it('reports a breach as a breach when a guard is missing — and still keeps nothing', async () => {
    const before = await snapshot();

    // Remove the rule the attack is aimed at, as a careless migration might.
    await db.execute(sql`RESET ROLE`);
    await db.execute(sql`DROP TRIGGER postings_append_only ON postings`);
    await db.execute(sql`SET ROLE obol_app`);

    const rewrite = await run('rewrite');
    expect(rewrite.verdict).toBe('breached');
    expect(rewrite.error).toBeNull();

    expect(await snapshot()).toEqual(before);
  });

  it('shows the SQL before it runs, and it is the SQL that runs', async () => {
    const attacks = createAttackService(db, db.$orgId);
    const plans = await attacks.plan();
    expect(plans.map((plan) => plan.id)).toEqual([...ATTACK_IDS]);
    for (const plan of plans) expect(plan.statements.length).toBeGreaterThan(0);

    // Identifiers are fresh per aim, so compare the shape rather than the text.
    const shape = (statements: readonly string[]) =>
      statements.map((statement) => statement.replaceAll(/_[0-9A-Z]{26}/gu, '_…'));
    const planned = plans.find((plan) => plan.id === 'rewrite');
    const ran = await attacks.run('rewrite');
    expect(shape(ran.statements)).toEqual(shape(planned?.statements ?? []));
  });

  it('says so, rather than failing, when an empty ledger has nothing to aim at', async () => {
    const empty = await createOrganization(db, 'empty');
    const result = await createAttackService(db, empty).run('erase');
    expect(result.verdict).toBe('unavailable');
    expect(result.statements).toEqual([]);
  });
});

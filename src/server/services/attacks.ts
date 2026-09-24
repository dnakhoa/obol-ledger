import { sql } from 'drizzle-orm';
import type { Database, Transactional } from '../db/types';
import { withTenant } from '../db/tenancy';
import { newId } from '@/lib/id';
import { isCurrencyCode, minorUnits, toDecimalString } from '@/lib/money';

/**
 * Attacks on the ledger, run for real and never kept.
 *
 * The README's argument is that every rule worth having is enforced by
 * Postgres as well as by the application, so a writer that skips the
 * application — psql, a migration, a second service — still cannot corrupt
 * the books. An argument like that is easy to state and cheap to doubt. This
 * module lets a visitor stop taking it on trust: each attack is raw SQL,
 * aimed past every service at the live tables, and the page shows what
 * Postgres said back.
 *
 * ## Why it is safe to run against the published demo
 *
 * Every attack runs inside one transaction that is **always rolled back** —
 * whether Postgres refused it or, if a rule ever regressed, let it through.
 * Nothing an attack writes can outlive the request, so it cannot corrupt the
 * demo even in the case the page exists to detect.
 *
 * A deferred constraint normally speaks only at COMMIT, which never comes.
 * `SET CONSTRAINTS ALL IMMEDIATE` asks Postgres to run those checks now,
 * exactly as COMMIT would, and is the last statement of the attack that needs
 * it — so the balance rule is exercised without a commit to trigger it.
 *
 * The transaction also carries a statement and a lock timeout, so an attack
 * that meets a row a real writer holds gives up in a second rather than
 * queueing behind it.
 *
 * ## Why the statements are strings
 *
 * The SQL on the page is the SQL that ran — not a paraphrase of a
 * parameterised query — because "here is what we tried" is only worth reading
 * if it is exact. So each statement is built as text and executed verbatim.
 * Nothing in it comes from the request: the attack is chosen from a fixed
 * list, and every value is an identifier or an amount this module read from
 * the tenant's own rows a moment earlier, re-validated against a strict shape
 * and quoted before it is spliced in. Descriptions, which a tenant writes
 * freely, are carried beside the SQL for display and never inside it.
 */

export const ATTACK_IDS = [
  'unbalanced',
  'rewrite',
  'erase',
  'overdraw',
  'wrong-currency',
  'reverse-twice',
  'backdate',
  'plant',
  'peek',
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];

export function isAttackId(value: string): value is AttackId {
  return (ATTACK_IDS as readonly string[]).includes(value);
}

/** What an attack will aim at, in words, for the reader. Never executed. */
export type AttackTarget = {
  /** An entry's description or an account's name, as the tenant wrote it. */
  readonly label: string;
  /** A decimal string in `currency`, like every amount that leaves the server. */
  readonly amount?: string | undefined;
  readonly currency?: string | undefined;
};

export type AttackPlan = {
  readonly id: AttackId;
  /** The statements, verbatim; empty when the ledger has nothing to aim at. */
  readonly statements: readonly string[];
  readonly target: AttackTarget | null;
};

export type AttackVerdict =
  /** Postgres raised an error: the rule held. */
  | 'refused'
  /** A read that must see nothing saw nothing: the rule held. */
  | 'held'
  /** Every statement went through, or a read saw another tenant's rows. */
  | 'breached'
  /** The ledger has nothing for this attack to aim at, e.g. no entries yet. */
  | 'unavailable';

export type AttackResult = AttackPlan & {
  readonly verdict: AttackVerdict;
  /** Index of the statement Postgres refused, when it refused one. */
  readonly refusedAt: number | null;
  readonly error: {
    readonly sqlstate: string;
    readonly condition: string;
    readonly message: string;
    readonly constraint: string | null;
  } | null;
  /** Rows a read attack could see. Anything but zero is a breach. */
  readonly rowsSeen: number | null;
  readonly elapsedMs: number;
};

/**
 * The condition names for the SQLSTATEs these attacks can meet.
 *
 * Postgres reports the five-character code; the name is what its
 * documentation and every `EXCEPTION WHEN` clause use, and it is the half a
 * reader can understand without looking it up.
 */
const CONDITIONS: Record<string, string> = {
  '23001': 'restrict_violation',
  '23503': 'foreign_key_violation',
  '23505': 'unique_violation',
  '23514': 'check_violation',
  '42501': 'insufficient_privilege',
  '55P03': 'lock_not_available',
  '57014': 'query_canceled',
};

/** A tenant that does not exist, for the attacks that try to reach another one. */
const SOMEONE_ELSE = 'org_SOMEONE_ELSE';

/**
 * A quoted SQL literal for a value this module read from the database.
 *
 * Belt and braces: the shape check rejects anything that is not an
 * identifier, an ISO date, a currency code or an integer — which is all an
 * attack ever splices in — and the quote-doubling makes even a value that
 * slipped past it inert under `standard_conforming_strings`, which has been
 * Postgres' default since 9.1.
 */
function literal(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(value)) {
    throw new Error(`refusing to splice an unexpected value into attack SQL: ${value}`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function integer(value: bigint): string {
  return value.toString();
}

/** Minor units as the decimal string a reader expects: 70001 cents is 700.01. */
function decimal(value: bigint, currency: string): string {
  return isCurrencyCode(currency) ? toDecimalString(minorUnits(value), currency) : value.toString();
}

type Context = { readonly orgId: string; readonly currency: string };

type Aim = { readonly statements: readonly string[]; readonly target: AttackTarget };

type Attack = {
  readonly id: AttackId;
  /**
   * `refusal`: the attack is a write, and holding means Postgres raised.
   * `no-rows`: the attack is a read, and holding means it saw nothing.
   */
  readonly expects: 'refusal' | 'no-rows';
  /** Reads the tenant's rows to aim at. Null when there is nothing to aim at. */
  readonly aim: (tx: Transactional, context: Context) => Promise<Aim | null>;
};

type Row = Record<string, unknown>;

async function rows<T extends Row>(tx: Transactional, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await tx.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}

async function first<T extends Row>(
  tx: Transactional,
  query: ReturnType<typeof sql>,
): Promise<T | undefined> {
  return (await rows<T>(tx, query))[0];
}

/** An open account of one type in the tenant's own currency. */
async function accountOf(
  tx: Transactional,
  context: Context,
  type: 'asset' | 'revenue' | 'expense',
): Promise<{ id: string; name: string } | undefined> {
  return first(
    tx,
    sql`
      select id, name from accounts
       where type = ${type} and currency = ${context.currency} and status = 'open'
       order by code nulls last, id
       limit 1
    `,
  );
}

function header(id: string, context: Context, description: string, occurredAt = 'now()'): string {
  return (
    `INSERT INTO transactions\n  (id, org_id, description, currency, occurred_at)\n` +
    `VALUES\n  (${literal(id)},\n   ${literal(context.orgId)},\n   '${description}', ${literal(context.currency)}, ${occurredAt});`
  );
}

function posting(
  id: string,
  transactionId: string,
  context: Context,
  accountId: string,
  amount: bigint,
  currency: string = context.currency,
  sequence = 0,
): string {
  return (
    `(${literal(id)},\n   ${literal(context.orgId)},\n   ${literal(transactionId)},\n   ${literal(accountId)},\n   ` +
    `${integer(amount)}, ${literal(currency)}, ${integer(amount)}, 1, ${sequence})`
  );
}

const POSTING_COLUMNS =
  'INSERT INTO postings\n  (id, org_id, transaction_id, account_id,\n   amount_minor, currency, base_amount_minor, fx_rate, sequence)';

const ATTACKS: readonly Attack[] = [
  {
    id: 'unbalanced',
    expects: 'refusal',
    aim: async (tx, context) => {
      const [debit, credit] = await Promise.all([
        accountOf(tx, context, 'asset'),
        accountOf(tx, context, 'revenue'),
      ]);
      if (!debit || !credit) return null;
      const txn = newId('transaction');
      return {
        target: { label: `${debit.name} / ${credit.name}` },
        statements: [
          header(txn, context, 'Off by one'),
          `${POSTING_COLUMNS}\nVALUES\n  ${posting(newId('posting'), txn, context, debit.id, 1000n)},\n  ${posting(newId('posting'), txn, context, credit.id, -999n, context.currency, 1)};`,
          '-- What COMMIT would check; we roll back instead.\nSET CONSTRAINTS ALL IMMEDIATE;',
        ],
      };
    },
  },
  {
    id: 'rewrite',
    expects: 'refusal',
    aim: async (tx) => {
      const row = await first<{ id: string; description: string }>(
        tx,
        sql`
          select p.id, t.description from postings p
            join transactions t on t.id = p.transaction_id
           order by t.occurred_at desc, p.id desc
           limit 1
        `,
      );
      if (!row) return null;
      return {
        target: { label: row.description },
        statements: [
          `UPDATE postings\n   SET amount_minor = amount_minor * 10,\n       base_amount_minor = base_amount_minor * 10\n WHERE id = ${literal(row.id)};`,
        ],
      };
    },
  },
  {
    id: 'erase',
    expects: 'refusal',
    aim: async (tx) => {
      const row = await first<{ id: string; description: string }>(
        tx,
        sql`
          select id, description from transactions
           where status = 'posted'
           order by occurred_at desc, id desc
           limit 1
        `,
      );
      if (!row) return null;
      return {
        target: { label: row.description },
        statements: [`DELETE FROM transactions\n WHERE id = ${literal(row.id)};`],
      };
    },
  },
  {
    id: 'overdraw',
    expects: 'refusal',
    aim: async (tx, context) => {
      const [account, expense] = await Promise.all([
        first<{ id: string; name: string; balance: string }>(
          tx,
          sql`
            select id, name, balance_minor::text as balance from accounts
             where type = 'asset' and currency = ${context.currency}
               and status = 'open' and not overdraft_allowed
             -- Money rather than machinery: a monetary account that is not a
             -- ledger of receivables is the bank, which is the account a
             -- reader pictures being overdrawn.
             order by monetary desc, open_items, balance_minor desc, id
             limit 1
          `,
        ),
        accountOf(tx, context, 'expense'),
      ]);
      if (!account || !expense) return null;
      // One more than it holds: the smallest withdrawal that must fail.
      const amount = BigInt(account.balance) + 1n;
      const txn = newId('transaction');
      return {
        target: {
          label: account.name,
          amount: decimal(amount, context.currency),
          currency: context.currency,
        },
        statements: [
          header(txn, context, 'Overdraw'),
          `${POSTING_COLUMNS}\nVALUES\n  ${posting(newId('posting'), txn, context, account.id, -amount)},\n  ${posting(newId('posting'), txn, context, expense.id, amount, context.currency, 1)};`,
        ],
      };
    },
  },
  {
    id: 'wrong-currency',
    expects: 'refusal',
    aim: async (tx, context) => {
      const account = await accountOf(tx, context, 'asset');
      if (!account) return null;
      const foreign = context.currency === 'USD' ? 'EUR' : 'USD';
      const txn = newId('transaction');
      return {
        target: { label: account.name, currency: foreign },
        statements: [
          header(txn, context, 'Wrong currency'),
          `${POSTING_COLUMNS}\nVALUES\n  ${posting(newId('posting'), txn, context, account.id, 100n, foreign)};`,
        ],
      };
    },
  },
  {
    id: 'reverse-twice',
    expects: 'refusal',
    aim: async (tx, context) => {
      // An entry the journal itself would offer to reverse: posted, not yet
      // reversed, and not written by the stock records, which refuse
      // reversal for a reason of their own and would make this a different
      // attack.
      const row = await first<{ id: string; description: string }>(
        tx,
        sql`
          select t.id, t.description from transactions t
           where t.status = 'posted' and t.reverses_transaction_id is null
             and not exists (select 1 from transactions r where r.reverses_transaction_id = t.id)
             and not exists (select 1 from inventory_movements m where m.transaction_id = t.id)
             and not exists (select 1 from landed_cost_charges c where c.transaction_id = t.id)
           order by t.occurred_at desc, t.id desc
           limit 1
        `,
      );
      if (!row) return null;
      const reversal = (id: string, n: number) =>
        `INSERT INTO transactions\n  (id, org_id, description, currency, occurred_at,\n   reverses_transaction_id)\n` +
        `VALUES\n  (${literal(id)},\n   ${literal(context.orgId)},\n   'Reversal #${n}', ${literal(context.currency)}, now(),\n   ${literal(row.id)});`;
      return {
        target: { label: row.description },
        statements: [reversal(newId('transaction'), 1), reversal(newId('transaction'), 2)],
      };
    },
  },
  {
    id: 'backdate',
    expects: 'refusal',
    aim: async (tx, context) => {
      // A month the tenant has already closed, if there is one. Otherwise the
      // attack closes the earliest month it has books for — inside the same
      // doomed transaction — and then tries to write into it.
      const closed = await first<{ month: string }>(
        tx,
        sql`
          select to_char(period_month, 'YYYY-MM-DD') as month from accounting_periods
           where status = 'closed'
           order by period_month desc
           limit 1
        `,
      );
      const statements: string[] = [];
      let month = closed?.month;
      if (!month) {
        const open = await first<{ month: string; closing: string }>(
          tx,
          sql`
            select to_char(m.month, 'YYYY-MM-DD') as month,
                   (select id from transactions t
                     where date_trunc('month', t.occurred_at at time zone 'UTC') = m.month
                     order by t.occurred_at desc, t.id desc limit 1) as closing
              from (select distinct date_trunc('month', occurred_at at time zone 'UTC') as month
                      from transactions) m
             where m.month < date_trunc('month', now() at time zone 'UTC')
               and not exists (
                 select 1 from accounting_periods p where p.period_month = m.month::date
               )
             order by m.month
             limit 1
          `,
        );
        if (!open) return null;
        month = open.month;
        statements.push(
          `-- No month is closed yet, so close one first.\n` +
            `INSERT INTO accounting_periods\n  (id, org_id, period_month, status, closed_at,\n   closing_transaction_id)\n` +
            `VALUES\n  (${literal(newId('period'))},\n   ${literal(context.orgId)},\n   ${literal(month)}, 'closed', now(),\n   ${literal(open.closing)});`,
        );
      }
      const midMonth = `${month.slice(0, 8)}15`;
      statements.push(header(newId('transaction'), context, 'Back-dated', literal(midMonth)));
      return { target: { label: month.slice(0, 7) }, statements };
    },
  },
  {
    id: 'plant',
    expects: 'refusal',
    aim: async (_tx, context) => ({
      target: { label: SOMEONE_ELSE },
      statements: [
        `INSERT INTO accounts\n  (id, org_id, name, type, currency)\n` +
          `VALUES\n  (${literal(newId('account'))},\n   ${literal(SOMEONE_ELSE)},\n   'Planted', 'asset', ${literal(context.currency)});`,
      ],
    }),
  },
  {
    id: 'peek',
    expects: 'no-rows',
    aim: async (_tx, context) => ({
      target: { label: SOMEONE_ELSE },
      statements: [
        `SELECT id, org_id, name, balance_minor\n  FROM accounts\n WHERE org_id <> ${literal(context.orgId)}\n LIMIT 5;`,
      ],
    }),
  },
];

const BY_ID = new Map(ATTACKS.map((attack) => [attack.id, attack]));

/** Thrown to end every attack's transaction in a rollback, carrying its result. */
class RolledBack extends Error {
  constructor(readonly result: Omit<AttackResult, 'elapsedMs'>) {
    super('attack rolled back');
  }
}

/** The Postgres error under drizzle's wrapper, if there is one. */
function postgresError(
  error: unknown,
): { code: string; message: string; constraint: string | null } | null {
  let current: unknown = error;
  while (current instanceof Error) {
    const candidate = current as { code?: unknown; constraint?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/u.test(candidate.code)) {
      return {
        code: candidate.code,
        message: current.message,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : null,
      };
    }
    current = current.cause;
  }
  return null;
}

async function contextFor(tx: Transactional, orgId: string): Promise<Context> {
  const org = await first<{ currency: string }>(
    tx,
    sql`select functional_currency as currency from organizations where id = ${orgId}`,
  );
  return { orgId, currency: (org?.currency ?? 'USD').trim() };
}

export type AttackConnection = {
  /** The Postgres role the application is connected as. */
  readonly role: string;
  /** True when that role skips row-level security, as a superuser does. */
  readonly bypassesRls: boolean;
};

export function createAttackService(database: Database, orgId: string) {
  return {
    /**
     * Who the attacks run as. Stated on the page because the two tenancy
     * attacks succeed against a role that bypasses row-level security, and a
     * reader should be told why before they see it rather than after.
     */
    async connection(): Promise<AttackConnection> {
      const row = await first<{ role: string; bypass: boolean }>(
        database,
        sql`
          select current_user as role,
                 (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as bypass
        `,
      );
      return { role: row?.role ?? 'unknown', bypassesRls: row?.bypass === true };
    },

    /**
     * Every attack, aimed but not fired — so the page can show the SQL before
     * anyone presses a button. Read-only.
     */
    async plan(): Promise<AttackPlan[]> {
      return withTenant(database, orgId, async (tx) => {
        const context = await contextFor(tx, orgId);
        const plans: AttackPlan[] = [];
        // In sequence: one connection, and a transaction runs one statement
        // at a time whatever the caller asks for.
        for (const attack of ATTACKS) {
          let aim: Aim | null;
          try {
            aim = await attack.aim(tx, context);
          } catch (error) {
            // A value that failed the literal check costs one card its SQL,
            // not the whole page. A database error still propagates: it has
            // aborted the transaction the remaining attacks would aim in.
            if (postgresError(error)) throw error;
            aim = null;
          }
          plans.push({
            id: attack.id,
            statements: aim?.statements ?? [],
            target: aim?.target ?? null,
          });
        }
        return plans;
      });
    },

    /** Fires one attack and reports what Postgres did. Never commits. */
    async run(id: AttackId): Promise<AttackResult> {
      const attack = BY_ID.get(id);
      if (!attack) throw new Error(`unknown attack ${id}`);
      const started = performance.now();

      try {
        await withTenant(database, orgId, async (tx) => {
          await tx.execute(
            sql`select set_config('statement_timeout', '3000', true), set_config('lock_timeout', '1000', true)`,
          );
          const context = await contextFor(tx, orgId);
          const aim = await attack.aim(tx, context);
          const plan = { id, statements: aim?.statements ?? [], target: aim?.target ?? null };
          if (!aim) {
            throw new RolledBack({
              ...plan,
              verdict: 'unavailable',
              refusedAt: null,
              error: null,
              rowsSeen: null,
            });
          }

          let seen = 0;
          for (const [index, statement] of aim.statements.entries()) {
            try {
              seen = (await rows(tx, sql.raw(statement))).length;
            } catch (error) {
              const refusal = postgresError(error);
              if (!refusal) throw error;
              throw new RolledBack({
                ...plan,
                verdict: 'refused',
                refusedAt: index,
                error: {
                  sqlstate: refusal.code,
                  condition: CONDITIONS[refusal.code] ?? 'error',
                  message: refusal.message,
                  constraint: refusal.constraint,
                },
                rowsSeen: null,
              });
            }
          }

          throw new RolledBack({
            ...plan,
            verdict: attack.expects === 'no-rows' && seen === 0 ? 'held' : 'breached',
            refusedAt: null,
            error: null,
            rowsSeen: attack.expects === 'no-rows' ? seen : null,
          });
        });
      } catch (error) {
        if (error instanceof RolledBack) {
          return { ...error.result, elapsedMs: Math.round(performance.now() - started) };
        }
        throw error;
      }
      // `withTenant` resolves only if the callback returns, and it always throws.
      throw new Error('attack transaction committed');
    },
  };
}

export type AttackService = ReturnType<typeof createAttackService>;

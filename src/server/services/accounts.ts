import { asc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import type { AccountRole } from '@/server/domain/period';
import { newId } from '@/lib/id';
import type { CurrencyCode } from '@/lib/money';
import type { AccountType } from '@/server/domain/account';
import type { LedgerError } from '@/server/domain/errors';
import { accounts, organizations } from '@/server/db/schema';
import { agreesWithTt200, type ChartTemplate } from '@/server/domain/chart';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { toAccountDto } from './serialize';
import { enqueue } from './outbox';
import type { AccountDto } from './dto';

export type CreateAccountInput = {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly overdraftAllowed?: boolean;
  readonly metadata?: Record<string, string> | undefined;
  /** Structural job, currently only `retained_earnings`. At most one per tenant. */
  readonly role?: AccountRole | undefined;
  /** The number this is filed under. Required on a statutory chart. */
  readonly code?: string | undefined;
  /**
   * Whether the account holds a fixed number of currency units, and so is
   * retranslated at each period end. Defaults to true for assets and
   * liabilities, which is right for cash, receivables and payables and wrong
   * for inventory — so the chart templates set it explicitly.
   */
  readonly monetary?: boolean | undefined;
  /** Whether this account is managed as a set of open items that age. */
  readonly openItems?: boolean | undefined;
  /** Days this customer or supplier has to pay. Only on an open-item account. */
  readonly paymentTermsDays?: number | undefined;
};

/**
 * Account reads and writes.
 *
 * Services are factories over a `Database` *and a tenant* rather than modules
 * that import a singleton client. The cost is two arguments; the benefit is
 * that the integration suite hands them a throwaway Postgres and exercises the
 * real queries, and that no method can be called without a tenant in scope —
 * every one of them runs inside `withTenant`, which is what makes the
 * row-level security policies engage.
 */
/**
 * The currency this tenant keeps its books in.
 *
 * Read per call rather than cached: it is one indexed lookup of a one-row
 * table, and a cached copy is a stale identity waiting to happen.
 */
async function functionalCurrencyFor(tx: Transactional, orgId: string): Promise<CurrencyCode> {
  const [row] = await tx
    .select({ currency: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return (row?.currency ?? 'USD') as CurrencyCode;
}

export function createAccountService(database: Database, orgId: string) {
  const functionalCurrency = (tx: Transactional) => functionalCurrencyFor(tx, orgId);

  return {
    async list(): Promise<AccountDto[]> {
      return withTenant(database, orgId, async (tx) => {
        /*
         * By code, then by name.
         *
         * Alphabetical was nobody's chart of accounts: an accountant reads
         * one in code order, and "Accounts Payable" sorting above "Cash"
         * above "Sales" tells them nothing about which is an asset. Codes are
         * optional, and `NULLS LAST` keeps an uncoded account out of the way
         * of the coded ones rather than sorting it to the top, which is where
         * Postgres puts NULLs in ascending order by default.
         */
        const rows = await tx
          .select()
          .from(accounts)
          .orderBy(sql`${accounts.code} asc nulls last`, asc(accounts.name));
        const functional = await functionalCurrency(tx);
        return rows.map((row) => toAccountDto(row, functional));
      });
    },

    /** Which chart the tenant is on, which decides whether a code is optional. */
    async chart(): Promise<ChartTemplate> {
      return withTenant(database, orgId, async (tx) => {
        const [org] = await tx
          .select({ chartTemplate: organizations.chartTemplate })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        return (org?.chartTemplate ?? 'generic') as ChartTemplate;
      });
    },

    async byId(id: string): Promise<Result<AccountDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
        // An account belonging to another tenant is filtered out by the policy
        // before this code sees it, so it is reported as not found — which is
        // also the right answer to give a caller who should not know it exists.
        return row
          ? ok(toAccountDto(row, await functionalCurrency(tx)))
          : err({ code: 'account_not_found', accountId: id });
      });
    },

    /**
     * Opens an account for a person — from the dashboard or the API — and
     * refuses with a reason rather than a constraint violation.
     *
     * Every rule here is also a CHECK or an index, so `create` below cannot
     * write a bad row either; what this adds is the sentence. It exists
     * because the first person to open an account on a Thông tư 200 ledger
     * found out the hard way: the form had no code field, the database
     * requires one on a statutory chart, and the answer was a 500.
     */
    async open(input: CreateAccountInput): Promise<Result<AccountDto, LedgerError>> {
      const refusal = await withTenant(database, orgId, async (tx): Promise<LedgerError | null> => {
        const [org] = await tx
          .select({ chartTemplate: organizations.chartTemplate })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        const chartTemplate = org?.chartTemplate ?? 'generic';

        if (chartTemplate === 'vn_tt200') {
          if (!input.code) return { code: 'account_code_required', chartTemplate };
          if (!agreesWithTt200(input.code, input.type)) {
            return { code: 'account_code_disagrees', accountCode: input.code, type: input.type };
          }
        }
        if (input.code) {
          const [taken] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.code, input.code))
            .limit(1);
          if (taken) return { code: 'account_code_taken', accountCode: input.code };
        }
        if (input.openItems && input.type !== 'asset' && input.type !== 'liability') {
          return { code: 'open_items_not_permitted', type: input.type };
        }
        if (input.paymentTermsDays !== undefined && !input.openItems) {
          return { code: 'payment_terms_need_open_items' };
        }
        return null;
      });
      if (refusal) return err(refusal);
      return ok(await this.create(input));
    },

    async create(input: CreateAccountInput): Promise<AccountDto> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .insert(accounts)
          .values({
            id: newId('account'),
            orgId,
            name: input.name,
            type: input.type,
            currency: input.currency,
            overdraftAllowed: input.overdraftAllowed ?? false,
            metadata: input.metadata ?? {},
            ...(input.code ? { code: input.code } : {}),
            monetary: input.monetary ?? (input.type === 'asset' || input.type === 'liability'),
            openItems: input.openItems ?? false,
            ...(input.paymentTermsDays === undefined
              ? {}
              : { paymentTermsDays: input.paymentTermsDays }),
            ...(input.role ? { role: input.role } : {}),
          })
          .returning();

        // `.returning()` on a single-row insert always yields exactly one row;
        // an empty result would mean the driver lied to us.
        if (!row) throw new Error('INSERT ... RETURNING produced no row');

        const dto = toAccountDto(row, await functionalCurrency(tx));
        await enqueue(tx, orgId, { type: 'account.opened', data: { account: dto } });
        return dto;
      });
    },

    /**
     * Closing is a soft state change, not a delete: the postings that reference
     * the account are history and a foreign key stops them being orphaned.
     */
    async close(id: string): Promise<Result<AccountDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .update(accounts)
          .set({ status: 'closed', updatedAt: new Date() })
          .where(eq(accounts.id, id))
          .returning();
        return row
          ? ok(toAccountDto(row, await functionalCurrency(tx)))
          : err({ code: 'account_not_found', accountId: id });
      });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

import { asc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { CurrencyCode } from '@/lib/money';
import type { AccountType } from '@/server/domain/account';
import type { LedgerError } from '@/server/domain/errors';
import { accounts } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database } from '@/server/db/types';
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
  readonly role?: 'retained_earnings' | 'fx_gain_loss' | undefined;
  /** The number this is filed under. Required on a statutory chart. */
  readonly code?: string | undefined;
  /**
   * Whether the account holds a fixed number of currency units, and so is
   * retranslated at each period end. Defaults to true for assets and
   * liabilities, which is right for cash, receivables and payables and wrong
   * for inventory — so the chart templates set it explicitly.
   */
  readonly monetary?: boolean | undefined;
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
export function createAccountService(database: Database, orgId: string) {
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
        return rows.map(toAccountDto);
      });
    },

    async byId(id: string): Promise<Result<AccountDto, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx.select().from(accounts).where(eq(accounts.id, id)).limit(1);
        // An account belonging to another tenant is filtered out by the policy
        // before this code sees it, so it is reported as not found — which is
        // also the right answer to give a caller who should not know it exists.
        return row ? ok(toAccountDto(row)) : err({ code: 'account_not_found', accountId: id });
      });
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
            ...(input.role ? { role: input.role } : {}),
          })
          .returning();

        // `.returning()` on a single-row insert always yields exactly one row;
        // an empty result would mean the driver lied to us.
        if (!row) throw new Error('INSERT ... RETURNING produced no row');

        const dto = toAccountDto(row);
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
        return row ? ok(toAccountDto(row)) : err({ code: 'account_not_found', accountId: id });
      });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

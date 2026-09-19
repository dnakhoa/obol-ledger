import { asc, eq } from 'drizzle-orm';
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
        const rows = await tx.select().from(accounts).orderBy(asc(accounts.name));
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

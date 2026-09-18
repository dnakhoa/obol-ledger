import { asc, eq } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { CurrencyCode } from '@/lib/money';
import type { AccountType } from '@/server/domain/account';
import type { LedgerError } from '@/server/domain/errors';
import { accounts } from '@/server/db/schema';
import type { Database } from '@/server/db/types';
import { toAccountDto } from './serialize';
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
 * Services are factories over a `Database` rather than modules that import a
 * singleton client. The cost is one argument; the benefit is that the
 * integration suite hands them a throwaway Postgres and exercises the real
 * queries, instead of the tests having to monkey-patch a global.
 */
export function createAccountService(database: Database) {
  return {
    async list(): Promise<AccountDto[]> {
      const rows = await database.select().from(accounts).orderBy(asc(accounts.name));
      return rows.map(toAccountDto);
    },

    async byId(id: string): Promise<Result<AccountDto, LedgerError>> {
      const [row] = await database.select().from(accounts).where(eq(accounts.id, id)).limit(1);
      return row ? ok(toAccountDto(row)) : err({ code: 'account_not_found', accountId: id });
    },

    async create(input: CreateAccountInput): Promise<AccountDto> {
      const [row] = await database
        .insert(accounts)
        .values({
          id: newId('account'),
          name: input.name,
          type: input.type,
          currency: input.currency,
          overdraftAllowed: input.overdraftAllowed ?? false,
        })
        .returning();

      // `.returning()` on a single-row insert always yields exactly one row;
      // an empty result would mean the driver lied to us.
      if (!row) throw new Error('INSERT ... RETURNING produced no row');
      return toAccountDto(row);
    },

    /**
     * Closing is a soft state change, not a delete: the postings that reference
     * the account are history and a foreign key stops them being orphaned.
     */
    async close(id: string): Promise<Result<AccountDto, LedgerError>> {
      const [row] = await database
        .update(accounts)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(eq(accounts.id, id))
        .returning();
      return row ? ok(toAccountDto(row)) : err({ code: 'account_not_found', accountId: id });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

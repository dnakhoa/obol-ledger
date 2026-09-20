import { toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { deriveBalances, type AccountType } from '@/server/domain/account';
import type { AccountDto, MoneyDto, PostingDto, TransactionDto } from './dto';
import type { AccountRow, PostingRow, TransactionRow } from '@/server/db/schema';

/**
 * Row-to-DTO mapping, kept in one module so the wire format is defined in a
 * single place. Every route and every server component renders through these,
 * which is why a change to how money is presented cannot reach some endpoints
 * and miss others.
 */

export function toMoneyDto(amount: MinorUnits, currency: CurrencyCode): MoneyDto {
  return {
    amount: toDecimalString(amount, currency),
    minorUnits: amount.toString(),
    currency,
  };
}

export function toAccountDto(row: AccountRow): AccountDto {
  const currency = row.currency as CurrencyCode;
  const balances = deriveBalances({
    signedPosted: row.balanceMinor as MinorUnits,
    pendingInflow: row.pendingInflowMinor as MinorUnits,
    pendingOutflow: row.pendingOutflowMinor as MinorUnits,
    type: row.type as AccountType,
  });

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    overdraftAllowed: row.overdraftAllowed,
    balance: toMoneyDto(balances.posted, currency),
    pendingBalance: toMoneyDto(balances.pending, currency),
    availableBalance: toMoneyDto(balances.available, currency),
    version: row.version,
    metadata: row.metadata,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPostingDto(row: PostingRow, accountName: string): PostingDto {
  const currency = row.currency as CurrencyCode;
  const amount = row.amountMinor as MinorUnits;
  return {
    id: row.id,
    accountId: row.accountId,
    accountName,
    // Storage is debit-positive; the DTO names the side explicitly so no
    // consumer has to re-derive the convention.
    direction: amount >= 0n ? 'debit' : 'credit',
    amount: toMoneyDto((amount < 0n ? -amount : amount) as MinorUnits, currency),
    sequence: row.sequence,
  };
}

export function toTransactionDto(
  row: TransactionRow,
  postings: readonly PostingDto[],
  reversedByTransactionId: string | null = null,
): TransactionDto {
  return {
    id: row.id,
    description: row.description,
    currency: row.currency as CurrencyCode,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    postedAt: row.postedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    postings,
    reversesTransactionId: row.reversesTransactionId,
    reversedByTransactionId,
    metadata: row.metadata,
  };
}

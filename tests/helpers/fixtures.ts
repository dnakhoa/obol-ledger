import { minorUnits, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { createAccountService } from '@/server/services/accounts';
import { createJournalService } from '@/server/services/journal';
import { createReportingService } from '@/server/services/reporting';
import type { Database } from '@/server/db/types';
import type { AccountType } from '@/server/domain/account';

/** Wires the services the way the application does, against a test database. */
export function servicesFor(database: Database) {
  return {
    accounts: createAccountService(database),
    journal: createJournalService(database),
    reporting: createReportingService(database),
  };
}

export const usd = (value: bigint): MinorUnits => minorUnits(value);

export async function openAccount(
  database: Database,
  overrides: {
    name: string;
    type: AccountType;
    currency?: CurrencyCode;
    overdraftAllowed?: boolean;
  },
) {
  return createAccountService(database).create({
    name: overrides.name,
    type: overrides.type,
    currency: overrides.currency ?? 'USD',
    overdraftAllowed: overrides.overdraftAllowed ?? false,
  });
}

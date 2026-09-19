import { minorUnits, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { newId } from '@/lib/id';
import { organizations } from '@/server/db/schema';
import { createAccountService } from '@/server/services/accounts';
import { createApiKeyService } from '@/server/services/api-keys';
import { createJournalService } from '@/server/services/journal';
import { createReportingService } from '@/server/services/reporting';
import { createWebhookService } from '@/server/services/webhooks';
import type { Database } from '@/server/db/types';
import type { AccountType } from '@/server/domain/account';

/** Wires the services the way the application does, against a test database. */
export function servicesFor(database: Database, orgId: string) {
  return {
    accounts: createAccountService(database, orgId),
    apiKeys: createApiKeyService(database, orgId),
    journal: createJournalService(database, orgId),
    reporting: createReportingService(database, orgId),
    webhooks: createWebhookService(database, orgId),
  };
}

/**
 * Creates a tenant.
 *
 * Tests take an explicit tenant rather than sharing an implicit one, which is
 * what lets the isolation suite hold two of them at once and prove the policy
 * keeps them apart.
 */
export async function createOrganization(database: Database, slug: string): Promise<string> {
  const id = newId('organization');
  await database.insert(organizations).values({ id, name: slug, slug });
  return id;
}

export const usd = (value: bigint): MinorUnits => minorUnits(value);

export async function openAccount(
  database: Database,
  orgId: string,
  overrides: {
    name: string;
    type: AccountType;
    currency?: CurrencyCode;
    overdraftAllowed?: boolean;
  },
) {
  return createAccountService(database, orgId).create({
    name: overrides.name,
    type: overrides.type,
    currency: overrides.currency ?? 'USD',
    overdraftAllowed: overrides.overdraftAllowed ?? false,
  });
}

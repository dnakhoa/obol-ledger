import { minorUnits, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { newId } from '@/lib/id';
import { organizations } from '@/server/db/schema';
import { createAccountService } from '@/server/services/accounts';
import { createAttackService } from '@/server/services/attacks';
import { createApiKeyService } from '@/server/services/api-keys';
import { createJournalService } from '@/server/services/journal';
import { createReportingService } from '@/server/services/reporting';
import { createPeriodService } from '@/server/services/periods';
import { createRateService } from '@/server/services/rates';
import { createRevaluationService } from '@/server/services/revaluation';
import { createInventoryService } from '@/server/services/inventory';
import { createStockImportService } from '@/server/services/stock-import';
import { createLandedCostService } from '@/server/services/landed-cost';
import { createAgingService } from '@/server/services/aging';
import { createTaxService } from '@/server/services/tax';
import { createSalesService } from '@/server/services/sales';
import { createCreditNoteService } from '@/server/services/credit-notes';
import { createSupplierReturnService } from '@/server/services/supplier-returns';
import { createTaxReturnService } from '@/server/services/tax-return';
import type { AccountRole } from '@/server/domain/period';
import { createWebhookService } from '@/server/services/webhooks';
import type { Database } from '@/server/db/types';
import type { AccountType } from '@/server/domain/account';

/** Wires the services the way the application does, against a test database. */
export function servicesFor(database: Database, orgId: string) {
  return {
    accounts: createAccountService(database, orgId),
    attacks: createAttackService(database, orgId),
    apiKeys: createApiKeyService(database, orgId),
    journal: createJournalService(database, orgId),
    reporting: createReportingService(database, orgId),
    periods: createPeriodService(database, orgId),
    rates: createRateService(database, orgId),
    revaluation: createRevaluationService(database, orgId),
    webhooks: createWebhookService(database, orgId),
    inventory: createInventoryService(database, orgId),
    stockImport: createStockImportService(database, orgId),
    landedCost: createLandedCostService(database, orgId),
    aging: createAgingService(database, orgId),
    tax: createTaxService(database, orgId),
    sales: createSalesService(database, orgId),
    creditNotes: createCreditNoteService(database, orgId),
    supplierReturns: createSupplierReturnService(database, orgId),
    taxReturns: createTaxReturnService(database, orgId),
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
    /** Managed as unsettled documents, so an aged report means something. */
    openItems?: boolean;
    /** A structural job, such as where a filed return leaves the debt. */
    role?: AccountRole;
  },
) {
  return createAccountService(database, orgId).create({
    name: overrides.name,
    type: overrides.type,
    currency: overrides.currency ?? 'USD',
    overdraftAllowed: overrides.overdraftAllowed ?? false,
    ...(overrides.openItems === undefined ? {} : { openItems: overrides.openItems }),
    ...(overrides.role === undefined ? {} : { role: overrides.role }),
  });
}

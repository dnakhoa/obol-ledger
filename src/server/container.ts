import 'server-only';

import { db } from './db/client';
import type { Database } from './db/types';
import { createAccountService } from './services/accounts';
import { createAttackService } from './services/attacks';
import { createApiKeyService } from './services/api-keys';
import { createAuthenticationService } from './services/authentication';
import { createJournalService } from './services/journal';
import { createReportingService } from './services/reporting';
import { createPeriodService } from './services/periods';
import { createRateService } from './services/rates';
import { createRevaluationService } from './services/revaluation';
import { createInventoryService } from '@/server/services/inventory';
import { createStockImportService } from '@/server/services/stock-import';
import { createLandedCostService } from '@/server/services/landed-cost';
import { createAgingService } from '@/server/services/aging';
import { createTaxService } from '@/server/services/tax';
import { createSalesService } from '@/server/services/sales';
import { createTaxReturnService } from '@/server/services/tax-return';
import { createWebhookService } from './services/webhooks';
import { SetupRequiredError } from './setup-error';
import { currentViewer, type Viewer } from './auth/viewer';

/**
 * Composition root.
 *
 * Services take a `Database` and a tenant rather than reaching for a
 * singleton, which is what lets the test suite hand them a throwaway Postgres
 * and what makes every query run under the right row-level security context.
 * The application still needs *somewhere* to do the wiring, and doing it here —
 * once, lazily — keeps that out of every route and page.
 *
 * Lazy matters: building this at module scope would open a connection during
 * `next build`, when no database exists.
 *
 * `database` is a transaction when a caller needs several services' writes to
 * commit or roll back as one — an idempotent API write claims its key and does
 * its work in the same transaction. Each service's own `withTenant` then opens
 * a savepoint inside it rather than a transaction of its own.
 */
export function servicesFor(orgId: string, database: Database = db()) {
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
    taxReturns: createTaxReturnService(database, orgId),
  };
}

/**
 * Tenant-independent services. Authentication is the only one: resolving which
 * tenant a request belongs to necessarily happens before there is one.
 */
export function authentication() {
  return createAuthenticationService(db());
}

/**
 * The tenant the public dashboard reads.
 *
 * The deployed demo is a real multi-tenant ledger with one tenant published,
 * rather than a single-tenant app pretending otherwise — so the read path goes
 * through exactly the same isolation as an authenticated one.
 *
 * Kept for the seed and for tests, which need to name the demo before anyone
 * has signed in. The application resolves it from `organizations.is_demo`
 * instead: deciding by slug is how a tenant becomes publicly readable by
 * renaming itself.
 */
export function demoOrgSlug(): string {
  return process.env['DEMO_ORG_SLUG'] ?? 'demo';
}

/**
 * Services for whoever is asking, and the viewer that decided.
 *
 * Every page and action goes through this rather than naming a tenant, so
 * "whose books are these?" is answered once, from the session, in a single
 * place. A signed-out visitor gets the published demo and cannot write; a
 * member gets their own organisation.
 */
export async function viewerServices(): Promise<{ services: Services; viewer: Viewer }> {
  const viewer = await currentViewer();
  if (viewer.kind === 'unenrolled') {
    // No membership yet — there is no ledger to bind services to, and
    // inventing one would be worse than sending them to onboarding.
    throw new OnboardingRequiredError('This account has no ledger yet.');
  }
  return { services: servicesFor(viewer.orgId), viewer };
}

export class OnboardingRequiredError extends Error {
  override readonly name = 'OnboardingRequiredError';
}

/**
 * Services bound to the tenant the public dashboard publishes.
 *
 * Server Components go through this rather than skipping tenancy, so the pages
 * read the ledger under exactly the same row-level security policy an API
 * client does. The demo is one tenant of a multi-tenant system, not an
 * exception carved out of it.
 */
export async function demoServices(): Promise<Services> {
  const org = await authentication().organizationBySlug(demoOrgSlug());
  if (!org) {
    throw new SetupRequiredError(
      `No organization with slug "${demoOrgSlug()}" exists yet, so there is no ledger to show.`,
    );
  }
  return servicesFor(org.id);
}

export type Services = ReturnType<typeof servicesFor>;

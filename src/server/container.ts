import 'server-only';

import { db } from './db/client';
import { createAccountService } from './services/accounts';
import { createApiKeyService } from './services/api-keys';
import { createAuthenticationService } from './services/authentication';
import { createJournalService } from './services/journal';
import { createReportingService } from './services/reporting';
import { createPeriodService } from './services/periods';
import { createWebhookService } from './services/webhooks';
import { SetupRequiredError } from './setup-error';

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
 */
export function servicesFor(orgId: string) {
  const database = db();
  return {
    accounts: createAccountService(database, orgId),
    apiKeys: createApiKeyService(database, orgId),
    journal: createJournalService(database, orgId),
    reporting: createReportingService(database, orgId),
    periods: createPeriodService(database, orgId),
    webhooks: createWebhookService(database, orgId),
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
 */
export function demoOrgSlug(): string {
  return process.env['DEMO_ORG_SLUG'] ?? 'demo';
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

import 'server-only';

import { db } from './db/client';
import { createAccountService } from './services/accounts';
import { createJournalService } from './services/journal';
import { createReportingService } from './services/reporting';

/**
 * Composition root.
 *
 * Services take a `Database` rather than reaching for a singleton, which is
 * what lets the test suite hand them a throwaway Postgres. The application
 * still needs *somewhere* to do the wiring, and doing it here — once, lazily —
 * keeps that decision out of every route and page.
 *
 * Lazy matters: building this at module scope would open a connection during
 * `next build`, when no database exists.
 */
export function services() {
  const database = db();
  return {
    accounts: createAccountService(database),
    journal: createJournalService(database),
    reporting: createReportingService(database),
  };
}

export type Services = ReturnType<typeof services>;

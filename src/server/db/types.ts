import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * A handle on the ledger database, independent of which driver produced it.
 *
 * Production runs on Neon over WebSockets; tests run on PGlite, a full Postgres
 * compiled to WebAssembly and embedded in the test process. Both satisfy
 * drizzle's `PgDatabase`, so services depend on this type and never import a
 * driver. That is what lets the integration suite exercise the *real* schema —
 * triggers, deferred constraints and all — with no database server to start,
 * and what would let the app move to another Postgres host without touching a
 * line of service code.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * A handle inside an open transaction. Structurally identical to `Database`,
 * but named separately so a signature can state that it *must* be called within
 * one — every write path in this codebase does.
 */
export type Transactional = Database;

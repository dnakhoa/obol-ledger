import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '@/server/db/schema';
import type { Database } from '@/server/db/types';
import { createOrganization } from './fixtures';

/**
 * An ephemeral Postgres for a single test file.
 *
 * PGlite is real Postgres compiled to WebAssembly, so the migrations under
 * `drizzle/` — including the plpgsql triggers and the deferred constraint that
 * enforces double entry — run exactly as they will in production. Mocking the
 * database would test the mock; this tests the schema.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type TestDatabase = Database & {
  readonly $close: () => Promise<void>;
  /** A tenant created with the database, for suites that only need one. */
  readonly $orgId: string;
};

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const database = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

  // Migrations run as the owner, before the role switch below.
  await migrate(database as never, { migrationsFolder: MIGRATIONS_FOLDER });

  /*
   * Drop to a non-superuser role for the rest of the suite.
   *
   * This is not tidiness — without it the isolation tests are worthless.
   * PGlite connects as a superuser, and a superuser bypasses row-level
   * security outright; `FORCE ROW LEVEL SECURITY` only subjects the table
   * *owner* to policies, it does not constrain a superuser or a role with
   * BYPASSRLS. Tested through that connection, every policy silently does
   * nothing while every query still returns plausible-looking rows.
   *
   * The same trap exists in production: deploy with a superuser connection and
   * tenancy quietly stops existing. `assertTenantIsolationEnforced` in
   * `src/server/db/tenancy.ts` is the runtime guard for that, and
   * `tests/integration/tenancy.test.ts` proves the guard catches it.
   */
  // One statement per call: the extended protocol drizzle uses cannot parse
  // multiple commands in a single prepared statement.
  for (const statement of [
    sql`CREATE ROLE obol_app NOSUPERUSER NOBYPASSRLS`,
    sql`GRANT USAGE ON SCHEMA public TO obol_app`,
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO obol_app`,
    sql`SET ROLE obol_app`,
  ]) {
    await database.execute(statement);
  }

  const orgId = await createOrganization(database, 'primary');

  return Object.assign(database, {
    $close: () => client.close(),
    $orgId: orgId,
  }) as TestDatabase;
}

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose own message is
 * only "Failed query: …"; the message Postgres actually produced — the one
 * naming the violated constraint — is further down the `cause` chain. These
 * helpers walk that chain so a test can assert on the real reason rather than
 * on drizzle's wrapper.
 */
export function databaseErrorMessage(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(' | ');
}

export async function expectDatabaseError(
  operation: PromiseLike<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    const message = databaseErrorMessage(error);
    if (pattern.test(message)) return;
    throw new Error(`expected a database error matching ${String(pattern)}, got: ${message}`);
  }
  throw new Error(`expected a database error matching ${String(pattern)}, but the query succeeded`);
}

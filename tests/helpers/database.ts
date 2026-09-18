import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '@/server/db/schema';
import type { Database } from '@/server/db/types';

/**
 * An ephemeral Postgres for a single test file.
 *
 * PGlite is real Postgres compiled to WebAssembly, so the migrations under
 * `drizzle/` — including the plpgsql triggers and the deferred constraint that
 * enforces double entry — run exactly as they will in production. Mocking the
 * database would test the mock; this tests the schema.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type TestDatabase = Database & { readonly $close: () => Promise<void> };

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const database = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
  return Object.assign(database as unknown as Database, {
    $close: () => client.close(),
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

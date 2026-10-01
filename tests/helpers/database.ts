import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import { inject } from 'vitest';
import * as schema from '@/server/db/schema';
import type { Database } from '@/server/db/types';
import { createOrganization } from './fixtures';

/**
 * An ephemeral Postgres for a single test.
 *
 * PGlite is real Postgres compiled to WebAssembly, so the migrations under
 * `drizzle/` — including the plpgsql triggers and the deferred constraint that
 * enforces double entry — run exactly as they will in production. Mocking the
 * database would test the mock; this tests the schema.
 *
 * Each one is loaded from a snapshot taken after the migrations ran
 * (`database-template.ts`), so every test gets a database of its own without
 * paying for `initdb` and every migration to get it.
 */

export type TestDatabase = Database & {
  readonly $close: () => Promise<void>;
  /** A tenant created with the database, for suites that only need one. */
  readonly $orgId: string;
};

/** The snapshot, read from disk once per test file and shared by its tests. */
let template: Promise<Blob> | undefined;

function migratedSnapshot(): Promise<Blob> {
  template ??= readFile(inject('databaseTemplate')).then((bytes) => new Blob([bytes]));
  return template;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite({ loadDataDir: await migratedSnapshot() });
  const database = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

  // The snapshot holds the role; switching to it is per connection. See
  // `database-template.ts` for why the suite must not run as a superuser.
  await database.execute(sql`SET ROLE obol_app`);

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

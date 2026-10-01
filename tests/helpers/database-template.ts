import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Path to a PGlite data directory with every migration applied. */
    databaseTemplate: string;
  }
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * The database every integration test starts from, built once per run.
 *
 * Each test still gets a Postgres of its own — loaded from this snapshot
 * rather than created empty and migrated. Creating one runs `initdb` inside
 * WebAssembly and then replays every migration on top: about three quarters
 * of a second, paid before each of several hundred tests, which was most of
 * CI's wall clock. Loading a migrated data directory skips both. The database
 * a test gets is the one it got before — the same migrations, applied by the
 * same migrator, to the same Postgres — only made once.
 *
 * A vitest `globalSetup`: it runs once in the main process before any worker
 * starts, and the workers find the file through `inject()`.
 */
export default async function buildDatabaseTemplate(project: TestProject) {
  const client = new PGlite();
  const database = drizzle(client);

  // Migrations run as the owner, before the role exists.
  await migrate(database as never, { migrationsFolder: MIGRATIONS_FOLDER });

  /*
   * The role the suite runs as: not a superuser, and not exempt from
   * row-level security.
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
   *
   * The role and its grants live in the data directory, so they are in the
   * snapshot. Switching to the role is per connection, so
   * `createTestDatabase` does that part.
   */
  // One statement per call: the extended protocol drizzle uses cannot parse
  // multiple commands in a single prepared statement.
  for (const statement of [
    sql`CREATE ROLE obol_app NOSUPERUSER NOBYPASSRLS`,
    sql`GRANT USAGE ON SCHEMA public TO obol_app`,
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO obol_app`,
  ]) {
    await database.execute(statement);
  }

  // Uncompressed: each worker reads it once from local disk, where gunzipping
  // forty megabytes would cost more than reading them.
  const snapshot = await client.dumpDataDir('none');
  await client.close();

  const directory = await mkdtemp(join(tmpdir(), 'obol-pglite-'));
  const path = join(directory, 'template.tar');
  await writeFile(path, new Uint8Array(await snapshot.arrayBuffer()));
  project.provide('databaseTemplate', path);

  return async () => {
    await rm(directory, { recursive: true, force: true });
  };
}

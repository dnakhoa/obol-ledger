import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import * as schema from '@/server/db/schema';
import type { Database } from '@/server/db/types';

/**
 * A real Postgres, with real concurrent connections.
 *
 * PGlite is the right tool for almost everything — it runs the same schema with
 * no service to install — but it is a single connection, so it cannot express
 * two transactions racing. Every claim in this codebase about *concurrency*
 * therefore needs a server: lock ordering, lost updates, and whether an
 * idempotency key actually serialises a duplicate request.
 *
 * Opt-in by design. `CONCURRENCY_DATABASE_URL` points at a throwaway database;
 * without it these suites skip with an explanation rather than failing, so a
 * contributor without Postgres still gets a green `pnpm test`. CI always sets
 * it, so the claims are checked on every push.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const LIVE_DATABASE_URL = process.env['CONCURRENCY_DATABASE_URL'];

export const describeWithPostgres = LIVE_DATABASE_URL ? describeAvailable : describeSkipped;

function describeAvailable() {
  return true;
}
function describeSkipped() {
  return false;
}

export type LivePostgres = {
  /**
   * Backed by a pool of real connections, so transactions opened through it
   * run on separate backends and genuinely race. Bounded deliberately: a
   * connection per concurrent operation exhausts `max_connections` long before
   * it proves anything.
   */
  readonly database: Database;
  readonly orgId: string;
  readonly close: () => Promise<void>;
};

/** Concurrent workers, and the pool that serves them. */
export const CONCURRENCY = 8;

let databaseCounter = 0;

/** The maintenance database to issue CREATE/DROP DATABASE against. */
function maintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

function databaseUrl(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * Each suite gets its own *database*, not merely its own schema.
 *
 * A schema is not enough: the generated migrations create their enum types as
 * `public.account_status`, and the migrations journal is database-wide — so a
 * second schema in an already-migrated database collides on the first and is
 * skipped by the second. A database is the only boundary that isolates both.
 */
export async function createLivePostgres(): Promise<LivePostgres> {
  if (!LIVE_DATABASE_URL) throw new Error('CONCURRENCY_DATABASE_URL is not set');

  const name = `obol_concurrency_${process.pid}_${databaseCounter++}`;
  const admin = new Pool({ connectionString: maintenanceUrl(LIVE_DATABASE_URL), max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = databaseUrl(LIVE_DATABASE_URL, name);

  // Migrations and grants run as the owner.
  const ownerPool = new Pool({ connectionString: url, max: 1 });
  const owner = drizzle(ownerPool, { schema, casing: 'snake_case' }) as unknown as Database;
  await migrate(owner as never, { migrationsFolder: MIGRATIONS_FOLDER });

  for (const statement of [
    sql`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'obol_app') THEN CREATE ROLE obol_app NOSUPERUSER NOBYPASSRLS; END IF; END $$`,
    sql`GRANT USAGE ON SCHEMA public TO obol_app`,
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO obol_app`,
  ]) {
    await owner.execute(statement);
  }

  const orgId = `org_${name}`;
  await owner.execute(
    sql`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, ${name}, ${name})`,
  );
  await ownerPool.end();

  /*
   * The application pool.
   *
   * `-c role=obol_app` is a startup parameter, so every connection the pool
   * opens arrives already dropped to the unprivileged role. Issuing `SET ROLE`
   * after checkout would be racy — a connection could serve one query as the
   * owner before the statement landed — and a superuser connection bypasses
   * row-level security entirely, which would quietly void every assertion here.
   */
  const pool = new Pool({
    connectionString: url,
    max: CONCURRENCY,
    options: '-c role=obol_app',
  });
  const database = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;

  return {
    database,
    orgId,
    async close() {
      await pool.end();
      const cleanup = new Pool({ connectionString: maintenanceUrl(LIVE_DATABASE_URL), max: 1 });
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

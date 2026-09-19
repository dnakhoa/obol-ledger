import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/**
 * Applies pending migrations.
 *
 * A separate step rather than something the application does on boot: a
 * serverless deploy can start dozens of instances at once, and having each of
 * them race to run DDL is how a schema gets corrupted. This runs once, in CI or
 * by hand, before the new code serves traffic.
 */
async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });

  try {
    console.log(`applying migrations to ${describeTarget(url)}`);
    const startedAt = Date.now();
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log(`migrations applied in ${Date.now() - startedAt}ms`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed', error);
  process.exitCode = 1;
});

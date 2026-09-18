import { loadEnvConfig } from '@next/env';

// Load the same .env cascade Next.js uses (.env.local overrides .env, and so
// on), so a script can never see different configuration from the application.
loadEnvConfig(process.cwd());
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Applies pending migrations.
 *
 * A separate step rather than something the application does on boot: a
 * serverless deploy can start dozens of instances at once, and having each of
 * them race to run DDL is how a schema gets corrupted. This runs once, in CI or
 * by hand, before the new code serves traffic.
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required to run migrations.');

  const pool = new Pool({
    connectionString: url,
    ssl: !/^postgres(ql)?:\/\/[^/]*(localhost|127\.0\.0\.1)/u.test(url),
    max: 1,
  });

  try {
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

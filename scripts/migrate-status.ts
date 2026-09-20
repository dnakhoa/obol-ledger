import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { checkSchemaVersion } from '../src/server/db/schema-version';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/** What this checkout expects against what the database has, without changing either. */
async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });

  try {
    const version = await checkSchemaVersion(drizzle(pool) as never);
    console.log(`${describeTarget(url)}`);
    console.log(`  this checkout expects: ${version.expected ?? 'nothing'}`);
    console.log(`  the database has:      ${version.applied ?? 'nothing'}`);
    if (version.pending.length > 0) {
      console.log(`  pending (${version.pending.length}): ${version.pending.join(', ')}`);
      console.log('\n  run `pnpm db:migrate` to apply them.');
      process.exitCode = 1;
    } else if (version.ahead) {
      console.log('  the database is AHEAD of this checkout — somebody rolled the code back.');
      process.exitCode = 1;
    } else {
      console.log('  up to date.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('could not read schema version', error);
  process.exitCode = 1;
});

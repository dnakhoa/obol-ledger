import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/**
 * Creates the least-privilege role the application connects as.
 *
 * Row-level security has a second half that is easy to miss: the policies only
 * apply to a role that is not `SUPERUSER` and does not carry `BYPASSRLS`, and
 * `FORCE ROW LEVEL SECURITY` does not change that — it only subjects the table
 * *owner*. Managed Postgres hands you an owner role by default, so an
 * application wired straight to the connection string it was given has RLS
 * switched off in everything but appearance.
 *
 * We found this the way it deserves to be found: `/api/v1/health` reported
 * `privilegedRole: true, enforced: false` against production minutes after
 * deploying. See `docs/adr/0007-tenant-isolation.md`.
 *
 * So there are two connections, by design:
 *
 *   DATABASE_URL       the owner. Migrations and seeds — they create tables,
 *                      disable triggers for backfills, and TRUNCATE. RLS
 *                      would only be in their way.
 *   APP_DATABASE_URL   this role. Everything the application does at runtime,
 *                      subject to every policy.
 *
 * Run once per environment:
 *
 *   DATABASE_URL=<owner url> pnpm tsx scripts/provision-app-role.ts
 *
 * It prints the connection string to set as APP_DATABASE_URL and nothing else;
 * the password is generated here and never stored in the repository.
 */
const ROLE = process.env['APP_DB_ROLE'] ?? 'obol_app';

async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });

  try {
    const password = randomBytes(24).toString('base64url');
    console.log(`provisioning ${ROLE} on ${describeTarget(url)}`);

    // Idempotent: re-running rotates the password rather than failing, which
    // is what you want from a script that is also the rotation procedure.
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);
    // Password only. A role created with `CREATE ROLE ... LOGIN` is already
    // NOSUPERUSER and NOBYPASSRLS, and restating those attributes needs
    // superuser — which a managed provider's owner role does not have. The
    // verification below checks the attributes rather than assuming them.
    await pool.query(`ALTER ROLE ${ROLE} WITH PASSWORD '${password}'`);

    // Deliberately no DDL rights: the application reads and writes rows, it
    // does not change the schema. A compromised application credential should
    // not be able to DROP a policy.
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
    );
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

    // The migrator keeps its bookkeeping in its own schema, and the health
    // probe reads it to report schema drift. Without these the probe cannot
    // tell "behind" from "not allowed to look", which is how it first shipped.
    await pool.query(`GRANT USAGE ON SCHEMA drizzle TO ${ROLE}`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${ROLE}`);
    await pool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO ${ROLE}`,
    );

    // Tables created by future migrations need the same grants, or the next
    // deploy breaks in a way that looks like a code bug.
    await pool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
    );

    const verification = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ROLE],
    );
    const role = verification.rows[0];
    if (!role || role.rolsuper || role.rolbypassrls) {
      throw new Error(`${ROLE} still bypasses row-level security; refusing to report success`);
    }

    const appUrl = new URL(url);
    appUrl.username = ROLE;
    appUrl.password = password;

    console.log(`\n${ROLE} is NOSUPERUSER and NOBYPASSRLS, so policies apply to it.`);
    console.log('\nSet this as APP_DATABASE_URL:\n');
    console.log(appUrl.toString());
    console.log('\nThen redeploy, and check that /api/v1/health reports');
    console.log('tenantIsolation.enforced = true.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('provisioning failed', error);
  process.exitCode = 1;
});

import { spawnSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';

// The same .env cascade the application and every other script reads, so this
// cannot decide a database is missing that `pnpm db:migrate` would have found.
loadEnvConfig(process.cwd());

/**
 * Migrations, run by the deploy that needs them.
 *
 * Until now `next build` was the whole build command, so merging a schema
 * change shipped code that referenced columns the database did not have. The
 * live site answered every request with a 500 until somebody remembered to run
 * `pnpm db:migrate` by hand. That is not a mistake anybody makes once.
 *
 * ## Why this is guarded rather than just wired in
 *
 * Vercel builds every pull request as a preview, and this project's preview
 * environment carries the *same* `DATABASE_URL` as production — one Neon
 * database, two environments pointed at it. An unguarded `db:migrate` in the
 * build command would therefore apply a schema change to production the moment
 * somebody opened a pull request, days before the code that needs it merges.
 *
 * So: production deploys migrate, and nothing else does. A preview build
 * compiles against the schema as it already stands, which is also the honest
 * test — that is the schema its code will run against.
 *
 * ## What this obliges a migration to be
 *
 * The build command runs *before* the new deployment is promoted, so there is
 * a window where the **old** code is serving traffic against the **new**
 * schema. That is the safe direction for an additive change and the fatal one
 * for a destructive change: dropping a column here breaks the live site
 * immediately rather than at promotion.
 *
 * Migrations are therefore expand-only. Add the column, ship the code that
 * writes it, and remove the old one in a *later* migration once nothing reads
 * it. `drizzle/README.md` has the longer version.
 */

const environment = process.env['VERCEL_ENV'];

if (environment && environment !== 'production') {
  console.log(
    `skipping migrations: VERCEL_ENV is "${environment}", and preview builds share production's database`,
  );
  process.exit(0);
}

const configured = Boolean(
  process.env['DATABASE_URL'] ??
  process.env['DATABASE_URL_UNPOOLED'] ??
  process.env['POSTGRES_URL_NON_POOLING'],
);

if (!configured) {
  if (environment === 'production') {
    // Silently skipping here would build and promote code that cannot reach a
    // database — the exact failure this script exists to prevent, arrived at
    // by a different route.
    console.error('no database is configured for a production build; refusing to build');
    process.exit(1);
  }

  // A local `pnpm build` with nothing configured is a legitimate thing to do:
  // checking that the app compiles needs no schema.
  console.log('skipping migrations: no database is configured');
  process.exit(0);
}

console.log(`running migrations before build (VERCEL_ENV=${environment ?? 'unset'})`);

// A child process rather than an import, so a migration failure is an exit
// code the build command already knows how to fail on.
const result = spawnSync('pnpm', ['run', 'db:migrate'], { stdio: 'inherit', shell: false });

if (result.status !== 0) {
  console.error('migrations failed; refusing to build so the deploy cannot promote');
  process.exit(result.status ?? 1);
}

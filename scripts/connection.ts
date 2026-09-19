import { loadEnvConfig } from '@next/env';

// Load the same .env cascade Next.js uses (.env.local overrides .env, and so
// on), so a script can never see different configuration from the application.
loadEnvConfig(process.cwd());

/**
 * The connection string schema work should use.
 *
 * Managed Postgres providers publish two endpoints: a *pooled* one fronted by
 * PgBouncer, and a *direct* one. The application wants the pooled endpoint —
 * that is what lets many serverless instances share a small number of backend
 * connections.
 *
 * Migrations and seeds want the opposite. PgBouncer runs in transaction mode,
 * where consecutive statements can land on different backends, so anything
 * relying on session state — a `SET`, a session-level advisory lock, a
 * multi-statement script like the seed's `ALTER TABLE ... DISABLE TRIGGER`
 * block — is not guaranteed to see its own effects. A one-shot script also
 * gains nothing from pooling: it opens one connection and exits.
 *
 * So these scripts prefer `DATABASE_URL_UNPOOLED` when the provider publishes
 * it, and fall back to `DATABASE_URL` for a plain Postgres that has only one
 * endpoint.
 */
export function schemaConnectionString(): string {
  const direct = process.env['DATABASE_URL_UNPOOLED'] ?? process.env['POSTGRES_URL_NON_POOLING'];
  const pooled = process.env['DATABASE_URL'];
  const url = direct ?? pooled;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres instance.',
    );
  }
  return url;
}

/**
 * TLS settings for anything that is not loopback.
 *
 * Returned as an explicit object rather than `true`, and rather than leaving it
 * to the connection string. `node-postgres` warns that it is changing what
 * `sslmode=require` means — today it verifies the certificate chain, and for
 * libpq compatibility it will soon encrypt *without* verifying. Stating
 * `rejectUnauthorized: true` here pins the behaviour we actually want, because
 * an unverified TLS connection is encrypted but still open to interception,
 * which is the worst of both worlds. Managed providers present certificates
 * from public CAs, so verification costs nothing.
 */
export function sslFor(url: string): false | { rejectUnauthorized: true } {
  try {
    const { hostname, searchParams } = new URL(url);
    if (searchParams.get('sslmode') === 'disable') return false;
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return loopback ? false : { rejectUnauthorized: true };
  } catch {
    return { rejectUnauthorized: true };
  }
}

/** Host only — safe to log, unlike the string it came from. */
export function describeTarget(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}${pathname}`;
  } catch {
    return 'an unparseable DATABASE_URL';
  }
}

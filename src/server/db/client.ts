import 'server-only';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import type { Database } from './types';

/**
 * The production database handle.
 *
 * Driver choice is a correctness decision here, not a preference. Neon's HTTP
 * driver is cheaper per query but cannot open a transaction, and a journal
 * entry that is half written is a corrupt ledger — so it is out. Between the
 * remaining options, `node-postgres` over TCP was chosen over a
 * WebSocket-specific driver because it speaks to *any* Postgres: a clone of
 * this repository runs against a local server with no account anywhere, and the
 * same code runs against Neon in production. See
 * `docs/adr/0003-database-driver.md`.
 */

declare global {
  var __obolPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres instance.',
    );
  }
  return url;
}

/**
 * TLS is on for anything that is not loopback.
 *
 * Managed Postgres providers present certificates from a public CA, so the
 * chain is verified rather than blindly accepted — `rejectUnauthorized: false`
 * would encrypt the connection while leaving it open to interception, which is
 * the worst of both worlds.
 */
function sslFor(url: string): boolean {
  try {
    const { hostname, searchParams } = new URL(url);
    if (searchParams.get('sslmode') === 'disable') return false;
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  } catch {
    return true;
  }
}

/**
 * One pool per process, cached on `globalThis`.
 *
 * Without the cache, Next.js' dev-server module reloading would leak a new pool
 * on every edit until Postgres refused connections. The pool is deliberately
 * small: a serverless instance serves one request at a time, so a large pool
 * only multiplies idle connections across instances — the pooled endpoint a
 * provider gives you is what handles fan-out.
 */
function pool(): Pool {
  const url = connectionString();
  globalThis.__obolPool ??= new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return globalThis.__obolPool;
}

let cached: Database | undefined;

export function db(): Database {
  cached ??= drizzle(pool(), { schema, casing: 'snake_case' });
  return cached;
}

/**
 * The single seam through which the integration suite points the whole
 * application — routes, services and all — at an embedded Postgres.
 *
 * Deliberately one function over one variable: any broader injection mechanism
 * would have to be threaded through every route for the sake of tests, and any
 * narrower one would leave the HTTP layer untested against a real database.
 */
export function setDatabaseForTesting(database: Database | undefined): void {
  cached = database;
}

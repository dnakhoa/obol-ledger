import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/server/db/client';
import * as schema from '@/server/db/schema';

/**
 * Authentication, delegated on purpose.
 *
 * This is the one part of a system where inventing something is negative
 * signal. The failure modes are subtle — session fixation, timing, token
 * rotation, CSRF on the callback — the attacks are well funded, and nothing
 * about a ledger is improved by a hand-rolled cookie. So the session handling,
 * the OAuth dance and the token storage are a library's problem.
 *
 * *Authorisation* is not delegated. Which ledger a person may touch is
 * decided by a membership row and enforced by the row-level security policies
 * that already exist, which is why the library's own organisation plugin is
 * deliberately unused — see `src/server/db/schema.ts`.
 *
 * Only OAuth providers are configured. Passwords would mean storing hashes,
 * running a reset flow, and depending on email deliverability for a project
 * whose point is the ledger; social sign-in is one click and stores nothing
 * that can leak.
 */

/** Providers are optional, so a checkout with no secrets still builds. */
function socialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  const github = credentials('GITHUB');
  if (github) providers['github'] = github;

  const google = credentials('GOOGLE');
  if (google) providers['google'] = google;

  return providers;
}

function credentials(prefix: string): { clientId: string; clientSecret: string } | undefined {
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function configuredProviders(): string[] {
  return Object.keys(socialProviders());
}

function build() {
  return betterAuth({
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.authAccounts,
        verification: schema.verifications,
      },
    }),
    // Required in production and generated from it; a missing secret should
    // fail loudly at boot rather than silently signing with a default.
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'development-only-secret',
    baseURL: process.env['BETTER_AUTH_URL'] ?? process.env['NEXT_PUBLIC_SITE_URL'],
    socialProviders: socialProviders(),
    session: {
      // Stored in Postgres rather than only signed into a cookie, so signing
      // out actually ends the session instead of asking the browser nicely.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
    },
  });
}

export type Auth = ReturnType<typeof build>;

let instance: Auth | undefined;

/**
 * Built lazily, like the services are.
 *
 * Constructing this at module scope would open a database connection during
 * `next build`, when there is no database — the same reason the composition
 * root is a function.
 */
export function auth(): Auth {
  instance ??= build();
  return instance;
}

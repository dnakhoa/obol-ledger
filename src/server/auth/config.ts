import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client';
import * as schema from '@/server/db/schema';
import { retireSampleLedgers } from './retire-sample';

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

/**
 * The key every session cookie and OAuth state is signed with.
 *
 * Required in production. A fallback there would sign with a string anyone
 * can read in this repository, and better-auth's own check only recognises
 * its built-in default, not ours — so the refusal has to be here.
 */
function authSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`.');
  }
  return 'development-only-secret';
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
    secret: authSecret(),
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
    plugins: [
      /*
       * "Try it with sample data": a session with no identity behind it, so a
       * prospect can have a writable ledger of their own in one click, with
       * no provider to configure and nothing to sign up for.
       *
       * When they then sign in properly, the sample ledger comes with them —
       * unless the account they signed in to already has books, in which
       * case those are kept and the sample is left behind. Nobody's real
       * ledger is ever replaced by a demo.
       */
      anonymous({
        emailDomainName: 'sample.obol-ledger.invalid',
        generateName: () => 'Guest',
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          const database = db();
          const [existing] = await database
            .select({ id: schema.memberships.id })
            .from(schema.memberships)
            .where(eq(schema.memberships.userId, newUser.user.id))
            .limit(1);
          if (existing) {
            await retireSampleLedgers(database, anonymousUser.user.id);
            return;
          }
          await database
            .update(schema.memberships)
            .set({ userId: newUser.user.id })
            .where(eq(schema.memberships.userId, anonymousUser.user.id));
        },
      }),
    ],
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

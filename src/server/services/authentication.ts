import { createHash } from 'node:crypto';
import { and, eq, isNull, or, lt, sql } from 'drizzle-orm';
import { apiKeys, organizations } from '@/server/db/schema';
import type { Database } from '@/server/db/types';

/**
 * Resolves a bearer token to the tenant it belongs to.
 *
 * Tokens are stored as a SHA-256 digest, never in the clear, so a leaked
 * database backup yields nothing usable. Lookup is still a single indexed
 * probe: the digest *is* the search key, which is why this can be a plain
 * `WHERE token_digest = $1` rather than a scan comparing every row in
 * constant time.
 *
 * That also means the comparison is done by the index rather than by us, so
 * there is no string equality here to leak timing. What an attacker learns
 * from a failed lookup is only that some digest does not exist, which they
 * already knew.
 *
 * `organizations` and `api_keys` deliberately carry no row-level security
 * policy: this query has to run *before* a tenant is known, so a policy keyed
 * on the tenant would be circular. Neither table is reachable through a
 * tenant-facing endpoint.
 */
export type Principal = {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly apiKeyId: string;
};

export function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Records that a key was used, at most once a minute.
 *
 * "When was this last used?" is the question that decides whether a key is
 * safe to revoke, and a key nobody can prove is unused is a key nobody dares
 * revoke. But a write on every authenticated request would double the write
 * volume of the whole API to maintain a timestamp nobody reads in real time.
 *
 * The `WHERE` clause is the compromise: the update only matches when the
 * stored value is already a minute stale, so a burst of a thousand requests
 * performs one write and 999 no-ops that touch a single index entry. The
 * resolution loss is a minute, on a value displayed to the nearest minute.
 *
 * Deliberately not awaited. The caller is waiting on an authentication
 * decision that has already been made; a failure here must not fail the
 * request, and its latency must not be added to one.
 */
const STAMP_INTERVAL = sql`interval '1 minute'`;

function stampLastUsed(database: Database, apiKeyId: string): Promise<unknown> {
  return database
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, apiKeyId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - ${STAMP_INTERVAL}`)),
      ),
    )
    .catch(() => undefined);
}

export function createAuthenticationService(database: Database) {
  return {
    async resolve(token: string): Promise<Principal | undefined> {
      const [row] = await database
        .select({
          apiKeyId: apiKeys.id,
          orgId: organizations.id,
          orgSlug: organizations.slug,
        })
        .from(apiKeys)
        .innerJoin(organizations, eq(organizations.id, apiKeys.orgId))
        // A revoked key stays in the table for audit, so revocation has to be
        // part of the predicate rather than implied by the row's absence.
        .where(and(eq(apiKeys.tokenDigest, digestToken(token)), isNull(apiKeys.revokedAt)))
        .limit(1);

      if (row) void stampLastUsed(database, row.apiKeyId);
      return row;
    },

    /** The tenant whose ledger the public dashboard reads. */
    async organizationBySlug(slug: string): Promise<{ id: string; slug: string } | undefined> {
      const [row] = await database
        .select({ id: organizations.id, slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      return row;
    },

    /**
     * Every tenant, for work that is not driven by a request.
     *
     * The delivery worker needs this because row-level security is keyed on a
     * single tenant: there is no connection state from which it could drain
     * every queue at once, and there should not be. It iterates instead, which
     * also buys fairness — one tenant with ten thousand queued deliveries
     * cannot starve the others out of a batch.
     */
    async organizations(): Promise<{ id: string; slug: string }[]> {
      return database
        .select({ id: organizations.id, slug: organizations.slug })
        .from(organizations);
    },
  };
}

export type AuthenticationService = ReturnType<typeof createAuthenticationService>;

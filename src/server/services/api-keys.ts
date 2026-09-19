import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { apiKeys } from '@/server/db/schema';
import type { Database } from '@/server/db/types';
import { digestToken } from './authentication';

/**
 * Issuing and revoking credentials.
 *
 * `api_keys` is the one tenant-scoped table with no row-level security policy,
 * and the reason is structural rather than an oversight: resolving a request's
 * tenant requires reading this table *before* a tenant is known, so a policy
 * keyed on `app.current_org` would be circular and a policy that fails open
 * when the setting is absent would be worse than none.
 *
 * The consequence is that isolation here is the query's responsibility rather
 * than the database's. Every statement below filters on `orgId`, and
 * `tests/integration/api-keys.test.ts` asserts a second tenant's keys are
 * neither listed nor revocable — because a rule the database is not enforcing
 * is a rule that needs a test.
 */

const TOKEN_PREFIX = 'obol_sk_';

/** How much of the token is stored in the clear, for identification. */
const VISIBLE_CHARS = 6;

export type ApiKeyDto = {
  readonly id: string;
  readonly name: string;
  /** `obol_sk_7Kp2xQ…` — enough to tell four keys apart, not enough to use. */
  readonly tokenPrefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
};

/** Returned once, at creation. */
export type IssuedApiKeyDto = ApiKeyDto & { readonly token: string };

type ApiKeyRow = typeof apiKeys.$inferSelect;

function toDto(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * A token, and the two things derived from it.
 *
 * 32 bytes from the CSPRNG, base64url so it survives a header, an env var and
 * a shell without quoting. The `obol_sk_` prefix is not decoration: secret
 * scanners — GitHub's included — match on distinctive prefixes, so a key
 * pasted into a public repository can be found and revoked automatically. A
 * bare random string is indistinguishable from any other blob and is found by
 * nobody until it is used.
 */
export function issueToken(): { token: string; digest: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    token,
    digest: digestToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + VISIBLE_CHARS),
  };
}

export function createApiKeyService(database: Database, orgId: string) {
  return {
    async list(): Promise<ApiKeyDto[]> {
      const rows = await database
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.orgId, orgId))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(toDto);
    },

    async issue(name: string): Promise<IssuedApiKeyDto> {
      const { token, digest, prefix } = issueToken();
      const [row] = await database
        .insert(apiKeys)
        .values({
          id: newId('apiKey'),
          orgId,
          name,
          tokenDigest: digest,
          tokenPrefix: prefix,
        })
        .returning();
      if (!row) throw new Error('INSERT ... RETURNING produced no api key row');

      // The only time the token exists outside the caller's hands. It is not
      // stored, logged or recoverable — a lost key is replaced, not found.
      return { ...toDto(row), token };
    },

    /**
     * Revokes a key, keeping the row.
     *
     * A deleted row answers "who had access?" with silence. Revocation is part
     * of the resolve predicate rather than implied by absence, so the audit
     * trail survives the revocation that makes it interesting.
     */
    async revoke(keyId: string): Promise<ApiKeyDto | undefined> {
      const [row] = await database
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)))
        .returning();
      return row ? toDto(row) : undefined;
    },
  };
}

export type ApiKeyService = ReturnType<typeof createApiKeyService>;

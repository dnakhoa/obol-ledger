import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { createOrganization } from '../helpers/fixtures';
import { createApiKeyService } from '@/server/services/api-keys';
import { createAuthenticationService, digestToken } from '@/server/services/authentication';
import { apiKeys } from '@/server/db/schema';

/**
 * `api_keys` is the one tenant-scoped table with no row-level security policy:
 * resolving a request's tenant means reading it before a tenant is known, so a
 * policy keyed on `app.current_org` would be circular.
 *
 * Isolation there is therefore the *query's* responsibility rather than the
 * database's — which is exactly why it needs a test. Everything else in this
 * codebase is protected by a policy that holds whether or not the query
 * remembers; this is the one place a forgotten `WHERE` would be a silent
 * cross-tenant leak.
 */
describe('api keys', () => {
  let db: TestDatabase;
  let keys: ReturnType<typeof createApiKeyService>;

  beforeEach(async () => {
    db = await createTestDatabase();
    keys = createApiKeyService(db, db.$orgId);
  });

  afterEach(async () => {
    await db.$close();
  });

  it('returns the token once and stores only a digest', async () => {
    const issued = await keys.issue('CI deploy');
    expect(issued.token).toMatch(/^obol_sk_/u);

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    expect(row?.tokenDigest).toBe(digestToken(issued.token));
    // The token itself is nowhere in the row — not in a column, not in the
    // prefix, which is short enough to identify and far too short to use.
    expect(JSON.stringify(row)).not.toContain(issued.token);
    expect(issued.tokenPrefix.length).toBeLessThan(issued.token.length / 2);

    const listed = await keys.list();
    expect(JSON.stringify(listed)).not.toContain(issued.token);
  });

  it('carries a scannable prefix so a leaked key can be found', async () => {
    // GitHub's secret scanning matches on distinctive prefixes. A bare random
    // string is indistinguishable from any other blob and is found by nobody
    // until it is used against the API.
    const issued = await keys.issue('Scannable');
    expect(issued.tokenPrefix.startsWith('obol_sk_')).toBe(true);
    expect(issued.token.startsWith(issued.tokenPrefix)).toBe(true);
  });

  it('issues tokens that actually authenticate', async () => {
    const issued = await keys.issue('Works');
    const principal = await createAuthenticationService(db).resolve(issued.token);
    expect(principal?.orgId).toBe(db.$orgId);
  });

  it('stops authenticating once revoked, and keeps the row', async () => {
    const issued = await keys.issue('Compromised');
    const authentication = createAuthenticationService(db);
    expect(await authentication.resolve(issued.token)).toBeDefined();

    const revoked = await keys.revoke(issued.id);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await authentication.resolve(issued.token)).toBeUndefined();

    // The audit trail survives the revocation that makes it interesting.
    const listed = await keys.list();
    expect(listed.map((key) => key.id)).toContain(issued.id);
  });

  it('refuses to revoke the same key twice', async () => {
    const issued = await keys.issue('Once');
    expect(await keys.revoke(issued.id)).toBeDefined();
    // Not a silent success: the caller believes they are closing a hole that
    // someone else already closed, and during an incident that matters.
    expect(await keys.revoke(issued.id)).toBeUndefined();
  });

  it('records use, without a write on every request', async () => {
    const issued = await keys.issue('Busy');
    const authentication = createAuthenticationService(db);

    await authentication.resolve(issued.token);
    // The stamp is deliberately not awaited by `resolve`, so settle first.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const [first] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    expect(first?.lastUsedAt).not.toBeNull();

    await authentication.resolve(issued.token);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const [second] = await db.select().from(apiKeys).where(eq(apiKeys.id, issued.id));
    // Within the minute window the second request is a no-op: the timestamp
    // is unchanged, which is the whole point of the predicate.
    expect(second?.lastUsedAt?.getTime()).toBe(first?.lastUsedAt?.getTime());
  });

  describe('isolation, enforced by the query rather than a policy', () => {
    it('does not list keys belonging to another tenant', async () => {
      await keys.issue('Mine');
      const otherOrg = await createOrganization(db, 'other');
      const others = createApiKeyService(db, otherOrg);

      expect(await others.list()).toHaveLength(0);
      await others.issue('Theirs');
      expect((await keys.list()).map((key) => key.name)).toEqual(['Mine']);
    });

    it('does not revoke a key belonging to another tenant', async () => {
      const mine = await keys.issue('Mine');
      const otherOrg = await createOrganization(db, 'other');
      const others = createApiKeyService(db, otherOrg);

      expect(await others.revoke(mine.id)).toBeUndefined();
      // And it still works, which is the part that would matter.
      expect(await createAuthenticationService(db).resolve(mine.token)).toBeDefined();
    });
  });
});

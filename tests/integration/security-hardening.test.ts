import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { apiKeys, organizations, users, webhookEndpoints } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import { createLedger } from '@/server/services/onboarding';
import { digestToken } from '@/server/services/authentication';
import { retireSampleLedgers } from '@/server/auth/retire-sample';
import { resetRateLimits } from '@/server/http/rate-limit';
import { GET as listAccounts, POST as createAccount } from '@/app/api/v1/accounts/route';
import { newId } from '@/lib/id';

const noParams = { params: Promise.resolve({} as Record<string, never>) };

describe('security hardening', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  async function createUser(email: string): Promise<string> {
    const id = newId('organization');
    await db.insert(users).values({ id, name: 'Guest', email });
    return id;
  }

  describe('a sample ledger left behind at sign-in', () => {
    it('keeps no working key and no live webhook', async () => {
      const userId = await createUser('guest@sample.test');
      const { orgId } = await createLedger({ userId, name: 'Sample', functionalCurrency: 'USD' });
      await db.insert(apiKeys).values({
        id: newId('apiKey'),
        orgId,
        name: 'left behind',
        tokenDigest: digestToken('orphan-token'),
        tokenPrefix: 'orphan',
      });
      await withTenant(db, orgId, (tx) =>
        tx.insert(webhookEndpoints).values({
          id: newId('webhookEndpoint'),
          orgId,
          url: 'https://hooks.example.com/x',
          secret: 'whsec_test',
        }),
      );

      await retireSampleLedgers(db, userId);

      const keys = await db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId));
      expect(keys.every((key) => key.revokedAt !== null)).toBe(true);
      const endpoints = await withTenant(db, orgId, (tx) => tx.select().from(webhookEndpoints));
      expect(endpoints.every((endpoint) => !endpoint.enabled)).toBe(true);
      // Nobody else's keys are touched.
      const others = await db.select().from(apiKeys).where(eq(apiKeys.orgId, db.$orgId));
      expect(others.every((key) => key.revokedAt === null)).toBe(true);
    });
  });

  describe('the demo slug', () => {
    it('is never handed to a new ledger, even while nobody holds it', async () => {
      const userId = await createUser('demo@example.test');
      const { orgId } = await createLedger({ userId, name: 'Demo', functionalCurrency: 'USD' });
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
      expect(org?.slug).not.toBe('demo');
      expect(org?.slug).toMatch(/^demo-/u);
    });
  });

  describe('the public API', () => {
    it('reads the organisation marked as the demo, not one that took its slug', async () => {
      // Nothing is marked: a ledger whose slug the configuration names is not
      // published by its name.
      const [primary] = await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, db.$orgId));
      process.env['DEMO_ORG_SLUG'] = primary?.slug ?? '';
      const refused = await listAccounts(
        new Request('https://ledger.test/api/v1/accounts'),
        noParams,
      );
      expect(refused.status).toBe(503);

      await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, db.$orgId));
      const served = await listAccounts(
        new Request('https://ledger.test/api/v1/accounts'),
        noParams,
      );
      expect(served.status).toBe(200);
    });

    it('refuses a JSON body over the limit, declared or not', async () => {
      await db.insert(apiKeys).values({
        id: newId('apiKey'),
        orgId: db.$orgId,
        name: 'test key',
        tokenDigest: digestToken('hardening-token'),
        tokenPrefix: 'harden',
      });
      const huge = JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) });
      const response = await createAccount(
        new Request('https://ledger.test/api/v1/accounts', {
          method: 'POST',
          headers: { authorization: 'Bearer hardening-token', 'content-type': 'application/json' },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(huge));
              controller.close();
            },
          }),
          // @ts-expect-error -- required by undici for a streamed body
          duplex: 'half',
        }),
        noParams,
      );
      expect(response.status).toBe(413);
    });
  });
});

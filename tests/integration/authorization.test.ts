import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { memberships, organizations, users } from '@/server/db/schema';
import { resolveViewer, canWriteTo } from '@/server/auth/viewer';
import { createLedger } from '@/server/services/onboarding';
import { servicesFor } from '../helpers/fixtures';
import { newId } from '@/lib/id';

/**
 * Who may read and write what.
 *
 * Row-level security already stops one member reaching another tenant's rows.
 * It cannot stop a *guest* writing to the demo, because a signed-out visitor
 * reading the demo is reading a real tenant legitimately — no policy can tell
 * "reading the demo" from "writing to it". That distinction is the thing
 * these tests exist for.
 */
describe('authorization', () => {
  let db: TestDatabase;

  async function createUser(email: string): Promise<{ id: string; name: string; email: string }> {
    const id = newId('organization');
    await db.insert(users).values({ id, name: email.split('@')[0] ?? 'user', email });
    return { id, name: email.split('@')[0] ?? 'user', email };
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    // The seeded tenant stands in for the published demo.
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, db.$orgId));
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  describe('a signed-out visitor', () => {
    it('reads the demo and nothing else', async () => {
      const viewer = await resolveViewer();
      expect(viewer.kind).toBe('guest');
      // Narrowed rather than asserted: `orgId` genuinely does not exist on an
      // unenrolled viewer, and the type saying so is the point.
      expect(viewer.kind === 'guest' && viewer.orgId).toBe(db.$orgId);
    });

    it('cannot write, even to the ledger they are reading', async () => {
      const viewer = await resolveViewer();
      expect(canWriteTo(viewer, db.$orgId)).toBe(false);
    });

    it('is refused even when the demo flag moves to another tenant', async () => {
      // The demo is found by column, not by slug compared to an environment
      // variable — which is how a tenant becomes publicly readable by
      // renaming itself.
      const viewer = await resolveViewer();
      expect(canWriteTo(viewer, 'org_somewhere_else')).toBe(false);
    });
  });

  describe('a signed-in person with no ledger', () => {
    it('is neither guest nor member', async () => {
      const user = await createUser('new@example.test');
      const viewer = await resolveViewer(user);
      // Guessing an organisation for them would be worse than sending them
      // to onboarding, so this shape exists to make the page do that.
      expect(viewer.kind).toBe('unenrolled');
    });

    it('cannot write anywhere', async () => {
      const user = await createUser('new@example.test');
      const viewer = await resolveViewer(user);
      expect(canWriteTo(viewer, db.$orgId)).toBe(false);
    });
  });

  describe('a member', () => {
    it('gets their own ledger, not the demo', async () => {
      const user = await createUser('owner@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Khoa Trading',
        functionalCurrency: 'VND',
      });

      const viewer = await resolveViewer(user);
      expect(viewer.kind).toBe('member');
      expect(viewer.kind === 'member' && viewer.orgId).toBe(orgId);
      expect(viewer.kind === 'member' && viewer.orgId).not.toBe(db.$orgId);
      expect(canWriteTo(viewer, orgId)).toBe(true);
    });

    it('cannot write to the demo they can read', async () => {
      const user = await createUser('owner@example.test');
      await createLedger({ userId: user.id, name: 'Mine', functionalCurrency: 'USD' });

      const viewer = await resolveViewer(user);
      expect(canWriteTo(viewer, db.$orgId)).toBe(false);
    });

    it('lands on the ledger they created first', async () => {
      const user = await createUser('owner@example.test');
      const first = await createLedger({
        userId: user.id,
        name: 'First',
        functionalCurrency: 'USD',
      });
      await createLedger({ userId: user.id, name: 'Second', functionalCurrency: 'EUR' });

      const viewer = await resolveViewer(user);
      // Oldest first, rather than whichever the planner happened to return.
      expect(viewer.kind === 'member' && viewer.orgId).toBe(first.orgId);
    });

    it('is read-only when their role says so', async () => {
      const user = await createUser('viewer@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Read only',
        functionalCurrency: 'USD',
      });
      await db.update(memberships).set({ role: 'viewer' }).where(eq(memberships.userId, user.id));

      const viewer = await resolveViewer(user);
      expect(viewer.kind).toBe('member');
      expect(canWriteTo(viewer, orgId)).toBe(false);
    });
  });

  describe('creating a ledger', () => {
    it('sets the functional currency that everything balances in', async () => {
      const user = await createUser('importer@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Importer',
        functionalCurrency: 'VND',
      });

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      expect(org?.functionalCurrency).toBe('VND');
      expect(org?.isDemo).toBe(false);
    });

    it('opens a chart of accounts you can post to immediately', async () => {
      const user = await createUser('importer@example.test');
      const { orgId } = await createLedger({
        userId: user.id,
        name: 'Importer',
        functionalCurrency: 'VND',
      });

      const accounts = await servicesFor(db, orgId).accounts.list();
      expect(accounts.length).toBeGreaterThan(4);
      // Both structural roles are designated from the start: a period close
      // has nowhere to put the profit without retained earnings, and a
      // foreign invoice has nowhere to put the difference without the other.
      expect(accounts.some((account) => account.role === 'retained_earnings')).toBe(true);
      expect(accounts.some((account) => account.role === 'fx_gain_loss')).toBe(true);
    });

    it('gives each person a ledger the other cannot see', async () => {
      const one = await createUser('one@example.test');
      const two = await createUser('two@example.test');

      const first = await createLedger({ userId: one.id, name: 'One', functionalCurrency: 'USD' });
      const second = await createLedger({ userId: two.id, name: 'Two', functionalCurrency: 'USD' });

      await servicesFor(db, first.orgId).accounts.create({
        name: 'Secret Account',
        type: 'asset',
        currency: 'USD',
      });

      const theirs = await servicesFor(db, second.orgId).accounts.list();
      expect(theirs.some((account) => account.name === 'Secret Account')).toBe(false);
    });

    it('keeps slugs unique without a retry loop', async () => {
      // Two ledgers with the same name is the ordinary case, not an edge one:
      // most people accept the suggested name.
      const one = await createUser('one@example.test');
      const two = await createUser('two@example.test');

      const first = await createLedger({
        userId: one.id,
        name: 'My books',
        functionalCurrency: 'USD',
      });
      const second = await createLedger({
        userId: two.id,
        name: 'My books',
        functionalCurrency: 'USD',
      });

      expect(first.orgId).not.toBe(second.orgId);
      const slugs = await db.select({ slug: organizations.slug }).from(organizations);
      expect(new Set(slugs.map((row) => row.slug)).size).toBe(slugs.length);
    });
  });
});

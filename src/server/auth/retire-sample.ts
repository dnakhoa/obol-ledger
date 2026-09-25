import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, memberships, webhookEndpoints } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database } from '@/server/db/types';

/**
 * Switches off whatever a left-behind sample ledger could still do on its own.
 *
 * Signing in to an account that already has books leaves the sample behind,
 * and deleting the anonymous user deletes its membership with it — so nobody
 * can see the sample again, let alone revoke a key issued on it. A key or a
 * webhook with no one left to answer for it is revoked and disabled here,
 * before the membership goes.
 */
export async function retireSampleLedgers(database: Database, userId: string): Promise<void> {
  const owned = await database
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  for (const { orgId } of owned) {
    await database
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.orgId, orgId), isNull(apiKeys.revokedAt)));
    await withTenant(database, orgId, (tx) =>
      tx
        .update(webhookEndpoints)
        .set({ enabled: false, disabledAt: new Date() })
        .where(eq(webhookEndpoints.enabled, true)),
    );
  }
}

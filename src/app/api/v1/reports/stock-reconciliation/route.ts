import { defineRoute, json } from '@/server/http/route';

/**
 * Whether each inventory account still equals the lots behind it.
 *
 * Exposed for the same reason as the trial balance: so a monitor can assert
 * on it. Stock movements cannot make the two disagree, but a journal line
 * typed straight onto the inventory account can, and every margin computed
 * from the lots is then out by that amount. `agrees: false` comes with the
 * entries responsible, so the answer is a list to work through rather than a
 * number to hunt for.
 */
export const GET = defineRoute({ name: 'reports.stockReconciliation' }, async ({ services }) => {
  const reconciliation = await services.inventory.reconcile();
  return json({ data: reconciliation, meta: { agrees: reconciliation.agrees } });
});

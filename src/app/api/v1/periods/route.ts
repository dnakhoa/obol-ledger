import { defineRoute, json } from '@/server/http/route';

export const GET = defineRoute({ name: 'periods.list' }, async ({ services }) => {
  // Every month that has entries, plus every month with a period row. A month
  // nobody has closed has no row — the ledger does not accumulate one per
  // month for months nobody looked at.
  return json({ data: await services.periods.list() });
});

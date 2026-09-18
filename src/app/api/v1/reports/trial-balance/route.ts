import { services } from '@/server/container';
import { defineRoute, json } from '@/server/http/route';

/**
 * The ledger's own consistency check, exposed so a monitor can assert on it.
 *
 * `balanced: false` for any currency means the cached balances no longer agree
 * with the postings — the one failure mode that would make every other number
 * in this system a lie.
 */
export const GET = defineRoute({ name: 'reports.trialBalance' }, async () => {
  const rows = await services().reporting.trialBalance();
  return json({
    data: rows,
    meta: { balanced: rows.every((row) => row.balanced) },
  });
});

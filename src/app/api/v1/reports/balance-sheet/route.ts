import { z } from 'zod';
import { defineRoute, json, parseQuery } from '@/server/http/route';
import { currencySchema } from '@/server/http/schemas';

const querySchema = z.object({ currency: currencySchema.default('USD') });

/**
 * Assets = Liabilities + Equity + retained earnings.
 *
 * `balanced` is computed rather than assumed: a balance sheet that does not
 * balance is not a rounding problem, it means the ledger is inconsistent, and a
 * report that quietly hid that would be worse than no report.
 */
export const GET = defineRoute(
  { name: 'reports.balanceSheet' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, querySchema, requestId);
    if (!query.ok) return query.response;

    const sheet = await services.reporting.balanceSheet(query.data.currency);
    return json({ data: sheet, meta: { balanced: sheet.balanced } });
  },
);

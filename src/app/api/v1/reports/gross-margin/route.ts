import { defineRoute, json, parseQuery } from '@/server/http/route';
import { grossMarginQuerySchema } from '@/server/http/schemas';
import { presentMargins } from '@/server/http/stock';

/**
 * What was made on what was sold, by product and by customer, over `[from, to)`.
 *
 * A margin is a flow, like an income statement, so it always has a period.
 * The default is the calendar month rather than a rolling thirty days because
 * that is the period the figure is compared against — last month's, the
 * budget's — and a window that slides daily matches neither. Given one bound,
 * the other is the edge of the month it falls in.
 *
 * Every figure is in the books' own currency: revenue at each invoice's rate,
 * cost at each lot's. Those are the only two that add up across invoices and
 * lots in different currencies, and they are what the revenue and cost of
 * sales accounts carry.
 */
export const GET = defineRoute(
  { name: 'reports.grossMargin' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, grossMarginQuerySchema, requestId);
    if (!query.ok) return query.response;

    const from = query.data.from
      ? startOf(query.data.from)
      : monthStart(query.data.to ? new Date(startOf(query.data.to).getTime() - 1) : new Date());
    const to = query.data.to ? startOf(query.data.to) : monthStart(from, 1);

    const report = await services.sales.margins(from, to);
    return json({ data: presentMargins(report) });
  },
);

/** Midnight UTC: the day boundary every other date in the ledger uses. */
function startOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function monthStart(within: Date, monthsLater = 0): Date {
  return new Date(Date.UTC(within.getUTCFullYear(), within.getUTCMonth() + monthsLater, 1));
}

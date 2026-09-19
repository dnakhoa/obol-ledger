import { z } from 'zod';
import { defineRoute, json, parseQuery } from '@/server/http/route';
import { currencySchema } from '@/server/http/schemas';

/**
 * Revenue and expenses are *flows*, so this endpoint requires a period.
 *
 * The defaults cover the last 30 days rather than all time, because an income
 * statement with no period attached is a meaningless number and a default of
 * "everything" would quietly produce one.
 */
const querySchema = z
  .object({
    currency: currencySchema.default('USD'),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: 'from must not be after to',
    path: ['from'],
  });

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const GET = defineRoute(
  { name: 'reports.incomeStatement' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, querySchema, requestId);
    if (!query.ok) return query.response;

    const to = query.data.to ? new Date(query.data.to) : new Date();
    const from = query.data.from
      ? new Date(query.data.from)
      : new Date(to.getTime() - THIRTY_DAYS_MS);

    const statement = await services.reporting.incomeStatement(query.data.currency, { from, to });
    return json({ data: statement, meta: { profitable: statement.profitable } });
  },
);

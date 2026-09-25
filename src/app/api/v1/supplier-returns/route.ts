import { defineRoute, json, parseQuery } from '@/server/http/route';
import { salesQuerySchema } from '@/server/http/schemas';
import { presentSupplierReturn } from '@/server/http/stock';

/** Most recent first, across every product. */
export const GET = defineRoute(
  { name: 'supplierReturns.list' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, salesQuerySchema, requestId);
    if (!query.ok) return query.response;
    const returns = await services.supplierReturns.list({ limit: query.data.limit });
    return json({ data: returns.map(presentSupplierReturn) });
  },
);

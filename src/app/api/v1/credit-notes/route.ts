import { defineRoute, json, parseQuery } from '@/server/http/route';
import { salesQuerySchema } from '@/server/http/schemas';
import { presentCreditNote } from '@/server/http/stock';

/** Most recent first, across every invoice. */
export const GET = defineRoute(
  { name: 'creditNotes.list' },
  async ({ request, requestId, services }) => {
    const query = parseQuery(request, salesQuerySchema, requestId);
    if (!query.ok) return query.response;
    const notes = await services.creditNotes.list(query.data.limit);
    return json({ data: notes.map(presentCreditNote) });
  },
);

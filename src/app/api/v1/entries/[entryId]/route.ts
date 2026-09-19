import { defineRoute, json } from '@/server/http/route';
import { problem, problemResponse } from '@/server/http/problem';

type Params = { entryId: string };

export const GET = defineRoute<Params>(
  { name: 'entries.get' },
  async ({ params, requestId, services }) => {
    const entry = await services.journal.byId(params.entryId);
    if (!entry) {
      return problemResponse({
        ...problem(
          404,
          'entry-not-found',
          'Entry not found',
          `No journal entry with id ${params.entryId}.`,
        ),
        requestId,
      });
    }
    return json({ data: entry });
  },
);

import { services } from '@/server/container';
import { defineRoute, json, parseQuery } from '@/server/http/route';
import { paginationSchema } from '@/server/http/schemas';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { accountId: string };

export const GET = defineRoute<Params>(
  { name: 'accounts.statement' },
  async ({ request, params, requestId }) => {
    const query = parseQuery(request, paginationSchema, requestId);
    if (!query.ok) return query.response;

    const statement = await services().reporting.statement(params.accountId, query.data);
    if (!statement) {
      return problemResponse(
        problemFor({ code: 'account_not_found', accountId: params.accountId }, requestId),
      );
    }

    return json({
      data: statement.lines.items,
      meta: { account: statement.account, nextCursor: statement.lines.nextCursor },
    });
  },
);

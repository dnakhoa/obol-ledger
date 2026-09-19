import { defineRoute, json, parseQuery } from '@/server/http/route';
import { paginationSchema } from '@/server/http/schemas';
import { problemFor, problemResponse } from '@/server/http/problem';
import { streamCsv } from '@/server/http/export';

type Params = { accountId: string };

/** Rows per page while streaming an export; invisible to the caller. */
const EXPORT_PAGE = 100;

export const GET = defineRoute<Params>(
  { name: 'accounts.statement' },
  async ({ request, params, requestId, services }) => {
    const query = parseQuery(request, paginationSchema, requestId);
    if (!query.ok) return query.response;

    const statement = await services.reporting.statement(params.accountId, query.data);
    if (!statement) {
      return problemResponse(
        problemFor({ code: 'account_not_found', accountId: params.accountId }, requestId),
      );
    }

    if (query.data.format === 'csv') {
      const account = statement.account;
      return streamCsv({
        filename: `${account.name} statement.csv`,
        header: [
          'Date',
          'Entry',
          'Description',
          'Direction',
          'Amount',
          'Currency',
          'Running balance',
        ],
        // Paged from the top rather than continuing this request's cursor: an
        // export is the whole statement, and honouring a cursor would silently
        // hand the reader the file from page four.
        page: async (cursor) => {
          const next = await services.reporting.statement(params.accountId, {
            limit: EXPORT_PAGE,
            cursor,
          });
          return { items: next?.lines.items ?? [], nextCursor: next?.lines.nextCursor ?? null };
        },
        rows: (line) => [
          [
            line.occurredAt,
            line.transactionId,
            line.description,
            line.direction,
            line.amount.amount,
            line.amount.currency,
            line.runningBalance.amount,
          ],
        ],
      });
    }

    return json({
      data: statement.lines.items,
      meta: {
        account: statement.account,
        nextCursor: statement.lines.nextCursor,
        previousCursor: statement.lines.previousCursor,
      },
    });
  },
);

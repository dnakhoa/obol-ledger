import { defineRoute, json } from '@/server/http/route';
import { problem, problemFor, problemResponse } from '@/server/http/problem';
import { readBody } from '@/server/http/body';

type Params = { accountId: string };

/** Half a megabyte of CSV is several years of an ordinary business account. */
const MAX_STATEMENT_BYTES = 512 * 1024;

/**
 * Imports a statement exported from online banking, sent as the CSV body.
 *
 * Every line or none: a row that cannot be read stops the import and is
 * named. Lines already imported are skipped, so importing overlapping
 * statements is safe and needs no idempotency key.
 */
export const POST = defineRoute<Params>(
  { name: 'bankAccounts.statements.import', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readBody(request, MAX_STATEMENT_BYTES);
    const text = body === 'too_large' ? '' : new TextDecoder().decode(body);
    if (!text) {
      return problemResponse({
        ...problem(
          422,
          'unprocessable-statement',
          'Statement could not be read',
          `Send the statement as the request body, text/csv, up to ${MAX_STATEMENT_BYTES / 1024} KB.`,
        ),
        requestId,
      });
    }
    const filename = new URL(request.url).searchParams.get('filename') ?? undefined;
    const result = await services.bank.importFile({
      accountId: params.accountId,
      text,
      filename: filename?.slice(0, 200),
    });
    return result.ok
      ? json({ data: result.value }, { status: 201 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

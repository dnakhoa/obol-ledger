import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { accountId: string };

/**
 * The reconciliation statement: the books' balance, the bank's, and the two
 * lists — on the statement only, in the books only — that explain the gap.
 */
export const GET = defineRoute<Params>(
  { name: 'bankAccounts.reconciliation' },
  async ({ params, requestId, services }) => {
    const result = await services.bank.reconciliation(params.accountId);
    return result.ok
      ? json({ data: result.value })
      : problemResponse(problemFor(result.error, requestId));
  },
);

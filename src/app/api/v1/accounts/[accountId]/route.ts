import { services } from '@/server/container';
import { defineRoute, json } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';

type Params = { accountId: string };

export const GET = defineRoute<Params>({ name: 'accounts.get' }, async ({ params, requestId }) => {
  const result = await services().accounts.byId(params.accountId);
  return result.ok
    ? json({ data: result.value })
    : problemResponse(problemFor(result.error, requestId));
});

import { defineRoute, json, readJson } from '@/server/http/route';
import { createAccountSchema } from '@/server/http/schemas';
import { problem, problemResponse } from '@/server/http/problem';

export const GET = defineRoute({ name: 'accounts.list' }, async ({ services }) => {
  return json({ data: await services.accounts.list() });
});

export const POST = defineRoute(
  { name: 'accounts.create', auth: true },
  async ({ request, requestId, services }) => {
    const body = await readJson(request, createAccountSchema, requestId);
    if (!body.ok) return body.response;

    try {
      const account = await services.accounts.create(body.data);
      return json(
        { data: account },
        { status: 201, headers: { location: `/api/v1/accounts/${account.id}` } },
      );
    } catch (error) {
      // `(name, currency)` is unique so that a ledger cannot end up with two
      // accounts a human would read as the same one.
      if (isUniqueViolation(error)) {
        return problemResponse({
          ...problem(
            409,
            'account-already-exists',
            'Account already exists',
            `An account named "${body.data.name}" already exists in ${body.data.currency}.`,
          ),
          requestId,
        });
      }
      throw error;
    }
  },
);

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if ((current as { code?: string }).code === '23505') return true;
    current = current.cause;
  }
  return false;
}

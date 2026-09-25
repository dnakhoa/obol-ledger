import { defineRoute, json } from '@/server/http/route';

/** Every account a bank statement can be reconciled against, with how much is left to match. */
export const GET = defineRoute({ name: 'bankAccounts.list' }, async ({ services }) =>
  json({ data: await services.bank.accounts() }),
);

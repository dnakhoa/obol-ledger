import { defineRoute, json, readJson } from '@/server/http/route';
import { problemFor, problemResponse } from '@/server/http/problem';
import { bankFeedSchema } from '@/server/http/schemas';
import { amountIn } from '@/server/http/stock';
import type { CurrencyCode } from '@/lib/money';
import type { FeedLine } from '@/server/services/bank';

type Params = { accountId: string };

/** The statement, newest first; an unmatched line carries the entries it probably is. */
export const GET = defineRoute<Params>(
  { name: 'bankAccounts.lines.list' },
  async ({ params, services }) => json({ data: await services.bank.lines(params.accountId) }),
);

/**
 * A bank feed pushes lines here.
 *
 * Each line carries the bank's own id, so sending the same day twice — which
 * every feed eventually does — adds nothing the second time. Amounts are in
 * the account's currency, money in positive.
 */
export const POST = defineRoute<Params>(
  { name: 'bankAccounts.lines.feed', auth: true },
  async ({ params, request, requestId, services }) => {
    const body = await readJson(request, bankFeedSchema, requestId);
    if (!body.ok) return body.response;

    const account = (await services.bank.accounts()).find((a) => a.id === params.accountId);
    if (!account) {
      return problemResponse(
        problemFor(
          { code: 'bank_account_not_reconcilable', accountId: params.accountId },
          requestId,
        ),
      );
    }

    const lines: FeedLine[] = [];
    for (const [index, line] of body.data.lines.entries()) {
      const amount = signed(line.amount, account.currency, `lines.${index}.amount`, requestId);
      if (!amount.ok) return amount.response;
      let balance: bigint | undefined;
      if (line.balance !== undefined) {
        const parsed = signed(line.balance, account.currency, `lines.${index}.balance`, requestId);
        if (!parsed.ok) return parsed.response;
        balance = parsed.value;
      }
      lines.push({
        externalId: line.id,
        occurredOn: line.date,
        amount: amount.value,
        description: line.description,
        reference: line.reference,
        balance,
      });
    }

    const result = await services.bank.feed({ accountId: account.id, lines });
    return result.ok
      ? json({ data: result.value }, { status: 201 })
      : problemResponse(problemFor(result.error, requestId));
  },
);

/** A signed decimal in the account's currency, refused rather than rounded. */
function signed(text: string, currency: CurrencyCode, field: string, requestId: string) {
  const negative = text.startsWith('-');
  const parsed = amountIn(negative ? text.slice(1) : text, currency, field, requestId);
  return parsed.ok ? { ok: true as const, value: negative ? -parsed.value : parsed.value } : parsed;
}

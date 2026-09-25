import { defineRoute, json } from '@/server/http/route';
import { problem, problemResponse } from '@/server/http/problem';
import { normaliseDate } from '@/lib/calendar';

/**
 * Vietnam's statutory statements, in the layout of the circular the books
 * follow: `?form=balance-sheet&asOf=YYYY-MM-DD`, or
 * `?form=income-statement&from=…&to=…`. A 404 for books kept under any other
 * chart, which has no statutory form here.
 */
export const GET = defineRoute(
  { name: 'reports.statutory' },
  async ({ request, requestId, services }) => {
    const url = new URL(request.url);
    const today = new Date().toISOString().slice(0, 10);
    const form = url.searchParams.get('form') ?? 'balance-sheet';
    const read = (name: string, fallback: string) =>
      normaliseDate(url.searchParams.get(name) ?? '') || fallback;

    const statement =
      form === 'income-statement'
        ? await services.statutory.incomeStatement(
            read('from', `${today.slice(0, 4)}-01-01`),
            read('to', today),
          )
        : await services.statutory.balanceSheet(read('asOf', today));
    if (!statement) {
      return problemResponse({
        ...problem(
          404,
          'statutory-not-available',
          'No statutory statements for this chart',
          'Statutory statements are prepared for books kept under Thông tư 200 or Thông tư 133.',
        ),
        requestId,
      });
    }
    return json({ data: statement });
  },
);

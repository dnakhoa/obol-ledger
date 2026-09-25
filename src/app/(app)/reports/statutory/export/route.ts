import { viewerServices } from '@/server/container';
import { attachment, toCsv } from '@/lib/csv';
import { normaliseDate } from '@/lib/calendar';
import { toDecimalString, type MinorUnits } from '@/lib/money';

/**
 * The statement as a spreadsheet: the form's captions and codes, and plain
 * decimals an accountant can paste into the template the tax office takes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const kind = url.searchParams.get('kind') === 'b02' ? 'b02' : 'b01';
  const asOf = normaliseDate(url.searchParams.get('asOf') ?? '') || today;
  const from = normaliseDate(url.searchParams.get('from') ?? '') || `${today.slice(0, 4)}-01-01`;
  const to = normaliseDate(url.searchParams.get('to') ?? '') || today;

  const { services } = await viewerServices();
  const statement =
    kind === 'b01'
      ? await services.statutory.balanceSheet(asOf)
      : await services.statutory.incomeStatement(from, to);
  if (!statement) return new Response('Not available for this chart of accounts', { status: 404 });

  const plain = (value: { minorUnits: string }) =>
    toDecimalString(BigInt(value.minorUnits) as MinorUnits, statement.currency);
  const csv = toCsv(
    kind === 'b01'
      ? ['Chỉ tiêu', 'Mã số', `Số cuối kỳ (${asOf})`, `Số đầu năm (${statement.comparative.to})`]
      : [
          'Chỉ tiêu',
          'Mã số',
          `Kỳ này (${from} – ${to})`,
          `Cùng kỳ năm trước (${statement.comparative.from} – ${statement.comparative.to})`,
        ],
    statement.lines.map((line) => [
      line.vi,
      line.code,
      plain(line.current),
      plain(line.comparative),
    ]),
  );
  const filename = `${statement.form}_${kind === 'b01' ? asOf : `${from}_${to}`}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': attachment(filename),
      'cache-control': 'private, no-store',
    },
  });
}

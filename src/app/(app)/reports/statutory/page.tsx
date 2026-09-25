import type { Metadata } from 'next';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { AlertIcon, ArrowLeftIcon, DownloadIcon } from '@/components/icons';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { normaliseDate } from '@/lib/calendar';
import { cn } from '@/lib/cn';
import type { StatutoryStatement } from '@/server/services/statutory';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.statutory.title };
}
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ kind?: string; asOf?: string; from?: string; to?: string }>;

/**
 * Mẫu B01 and B02, as the circular the books follow lays them out.
 *
 * The form's own line codes, its Vietnamese captions — with the English
 * beside them for a reader who needs it — and the comparative column the
 * form asks for. What the form cannot place is listed under it, so a total
 * that leaves an account out says so.
 */
export default async function StatutoryPage({ searchParams }: { searchParams: SearchParams }) {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const query = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const kind = query.kind === 'b02' ? 'b02' : 'b01';
  const asOf = normaliseDate(query.asOf ?? '') || today;
  const from = normaliseDate(query.from ?? '') || `${today.slice(0, 4)}-01-01`;
  const to = normaliseDate(query.to ?? '') || today;
  const day = (value: string) => DATE.day(new Date(`${value}T12:00:00Z`));

  let statement: StatutoryStatement | null;
  try {
    const { services } = await viewerServices();
    statement =
      kind === 'b01'
        ? await services.statutory.balanceSheet(asOf)
        : await services.statutory.incomeStatement(from, to <= from ? from : to);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const header = (
    <PageHeader
      title={t.statutory.title}
      description={t.statutory.description}
      actions={
        <ButtonLink href="/reports">
          <ArrowLeftIcon />
          {t.reports.title}
        </ButtonLink>
      }
    />
  );
  if (!statement) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardBody>
            <p className="text-ink-secondary text-sm">{t.statutory.notAvailable}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const params =
    kind === 'b01' ? new URLSearchParams({ kind, asOf }) : new URLSearchParams({ kind, from, to });
  const columns =
    kind === 'b01'
      ? [t.statutory.endOfPeriod, t.statutory.startOfYear]
      : [t.statutory.thisPeriod, t.statutory.lastYear];
  const showEnglish = locale !== 'vi';

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <ButtonLink
            href="/reports/statutory?kind=b01"
            variant={kind === 'b01' ? 'primary' : 'secondary'}
          >
            {t.statutory.balanceSheet}
          </ButtonLink>
          <ButtonLink
            href="/reports/statutory?kind=b02"
            variant={kind === 'b02' ? 'primary' : 'secondary'}
          >
            {t.statutory.incomeStatement}
          </ButtonLink>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="kind" value={kind} />
          {kind === 'b01' ? (
            <Field label={t.statutory.asOf} htmlFor="statutory-as-of">
              <Input id="statutory-as-of" name="asOf" type="date" defaultValue={asOf} />
            </Field>
          ) : (
            <>
              <Field label={t.statutory.from} htmlFor="statutory-from">
                <Input id="statutory-from" name="from" type="date" defaultValue={from} />
              </Field>
              <Field label={t.statutory.to} htmlFor="statutory-to">
                <Input id="statutory-to" name="to" type="date" defaultValue={to} />
              </Field>
            </>
          )}
          <Button type="submit" variant="secondary">
            {t.statutory.show}
          </Button>
        </form>
      </div>

      <Card className={statement.balanced === false ? 'border-negative' : ''}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5">
              <CardTitle>
                {statement.titleVi} · {statement.form}
              </CardTitle>
              <CardDescription>
                {statement.organisation} ·{' '}
                {statement.current.from
                  ? `${day(statement.current.from)} – ${day(statement.current.to)}`
                  : day(statement.current.to)}{' '}
                · {t.statutory.amountsIn(statement.currency)}
              </CardDescription>
            </div>
            <ButtonLink href={`/reports/statutory/export?${params.toString()}`} size="sm">
              <DownloadIcon />
              {t.statutory.download}
            </ButtonLink>
          </div>
          {statement.balanced === false ? (
            <p className="text-negative mt-2 flex items-center gap-1.5 text-xs">
              <AlertIcon width={12} height={12} />
              {t.statutory.unbalanced}
            </p>
          ) : null}
        </CardHeader>
        <TableScroll>
          <Table caption={statement.titleVi}>
            <thead>
              <tr>
                <Th>{t.statutory.item}</Th>
                <Th align="right">{t.statutory.code}</Th>
                <Th align="right">{columns[0]}</Th>
                <Th hideBelow="sm" align="right">
                  {columns[1]}
                </Th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <Tr key={line.code}>
                  <Td>
                    <span
                      className={cn(
                        'block',
                        line.level === 0 && 'font-semibold',
                        line.level === 1 && 'font-medium',
                        line.level === 2 && 'pl-4',
                      )}
                    >
                      {line.vi}
                    </span>
                    {showEnglish ? (
                      <span
                        className={cn('text-ink-muted block text-xs', line.level === 2 && 'pl-4')}
                      >
                        {line.en}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" numeric className="text-ink-muted">
                    {line.code}
                  </Td>
                  <Td align="right" numeric className={cn(line.level === 0 && 'font-semibold')}>
                    <Money value={line.current} />
                  </Td>
                  <Td hideBelow="sm" align="right" numeric className="text-ink-secondary">
                    <Money value={line.comparative} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
        <CardBody>
          <p className="text-ink-muted text-xs">{t.statutory.review}</p>
        </CardBody>
      </Card>

      {statement.unplaced.length > 0 ? (
        <Card className="border-negative">
          <CardHeader>
            <CardTitle>{t.statutory.unplacedTitle}</CardTitle>
            <CardDescription>{t.statutory.unplacedHint}</CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm">
              {statement.unplaced.map((account) => (
                <li key={`${account.code}-${account.name}`} className="flex justify-between gap-3">
                  <span>{account.code ? `${account.code} — ${account.name}` : account.name}</span>
                  <Money value={account.amount} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

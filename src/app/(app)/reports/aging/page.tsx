import type { Metadata } from 'next';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { ArrowLeftIcon } from '@/components/icons';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats, type Messages } from '@/lib/i18n';
import { AGING_BUCKETS, DEFAULT_TERMS_DAYS } from '@/server/domain/aging';
import type { AgedReport } from '@/server/services/aging';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.aging.title };
}
export const dynamic = 'force-dynamic';

/**
 * Aged receivables and payables.
 *
 * Every package has this and it is the first thing a finance person looks for,
 * because "we are owed 4.8 billion" and "we are owed 4.8 billion and a third
 * of it is over ninety days" are different businesses.
 *
 * Each account totals in its own currency and there is no grand total across
 * them. Adding a dollar receivable to a dong one needs each open item
 * converted at the rate on its own day, and a total that quietly used today's
 * would be wrong in a way nobody could see.
 */
export default async function AgingPage() {
  const { locale, t } = await translations();
  const format = dateFormats(locale);

  let receivables: AgedReport;
  let payables: AgedReport;
  try {
    const { services } = await viewerServices();
    [receivables, payables] = await Promise.all([
      services.aging.report('asset'),
      services.aging.report('liability'),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const empty = receivables.accounts.length === 0 && payables.accounts.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.aging.title}
        description={t.aging.description}
        actions={
          <ButtonLink href="/reports">
            <ArrowLeftIcon />
            {t.reports.title}
          </ButtonLink>
        }
      />

      {empty ? (
        <Card>
          <EmptyState title={t.aging.emptyTitle} description={t.aging.emptyBody} />
        </Card>
      ) : (
        <>
          <Section title={t.aging.receivables} report={receivables} t={t} format={format} />
          <Section title={t.aging.payables} report={payables} t={t} format={format} />
        </>
      )}

      <Card>
        <CardBody className="text-ink-muted space-y-2 text-xs">
          <p>{t.aging.dueConvention}</p>
          <p>{t.aging.convention}</p>
        </CardBody>
      </Card>
    </div>
  );
}

function Section({
  title,
  report,
  t,
  format,
}: {
  title: string;
  report: AgedReport;
  t: Messages;
  format: ReturnType<typeof dateFormats>;
}) {
  if (report.accounts.length === 0) return null;

  return (
    <>
      {report.accounts.map((account) => (
        <Card key={account.accountId}>
          <CardHeader>
            <div className="space-y-0.5">
              <CardTitle>
                {account.accountCode ? `${account.accountCode} — ` : ''}
                {account.accountName}
              </CardTitle>
              <CardDescription>
                {title} ·{' '}
                {account.paymentTermsDays === null
                  ? t.aging.termsAssumed(DEFAULT_TERMS_DAYS)
                  : t.aging.terms(account.paymentTermsDays)}
              </CardDescription>
            </div>
            <div className="text-right">
              <p className="numeric text-sm font-semibold">
                <Money value={account.total} showCurrency />
              </p>
              {account.overdueBasisPoints > 0 ? (
                <Badge tone={account.overdueBasisPoints > 5000 ? 'caution' : 'neutral'}>
                  {t.aging.overdue((account.overdueBasisPoints / 100).toFixed(0))}
                </Badge>
              ) : null}
            </div>
          </CardHeader>

          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {AGING_BUCKETS.map((bucket) => (
              <div key={bucket} className="border-line bg-surface-sunken rounded-lg border p-3">
                <p className="text-ink-muted text-[11px]">{t.aging[bucket]}</p>
                <p className="numeric text-sm font-medium">
                  <Money value={account.byBucket[bucket]} />
                </p>
              </div>
            ))}
          </CardBody>

          <TableScroll>
            <Table caption={t.aging.caption(account.accountName)}>
              <thead>
                <tr>
                  <Th>{t.aging.invoice}</Th>
                  <Th>{t.aging.dated}</Th>
                  <Th>{t.aging.due}</Th>
                  <Th align="right">{t.aging.late}</Th>
                  <Th align="right">{t.aging.outstanding}</Th>
                </tr>
              </thead>
              <tbody>
                {account.items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      {item.reference ?? item.description}
                      {item.outstanding.amount.startsWith('-') ? (
                        <Badge tone="neutral" className="ml-2">
                          {t.aging.credit}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td numeric>{format.day(item.occurredAt)}</Td>
                    <Td numeric>{format.day(item.dueOn)}</Td>
                    <Td align="right" numeric>
                      {item.daysOverdue > 0 ? (
                        <span className={item.daysOverdue > 60 ? 'text-negative font-medium' : ''}>
                          {t.aging.lateDays(item.daysOverdue)}
                        </span>
                      ) : (
                        <span className="text-ink-muted text-xs">{t.aging.notYetDue}</span>
                      )}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={item.outstanding} signed />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ))}
    </>
  );
}

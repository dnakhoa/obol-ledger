import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { MarginPercent } from '@/components/margin';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { toQuantityString, unitLabel } from '@/lib/quantity';
import type { MarginReport } from '@/server/services/sales';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.margins.title };
}
export const dynamic = 'force-dynamic';

type PageProps = { searchParams: Promise<{ month?: string }> };

/** `2026-01` → the first instants of that month and the next, in UTC. */
function monthRange(month: string | undefined): { from: Date; to: Date; key: string } {
  const now = new Date();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(month ?? '');
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const index = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const from = new Date(Date.UTC(year, index, 1));
  const to = new Date(Date.UTC(year, index + 1, 1));
  return { from, to, key: from.toISOString().slice(0, 7) };
}

function shift(key: string, months: number): string {
  const [year = 0, month = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7);
}

/**
 * What was made on what was sold.
 *
 * Two tables over the same invoices, and they are meant to be read together:
 * the product that pays the rent, and the customer who does. Their costs
 * differ by exactly the late freight, which is stated rather than hidden —
 * a report whose two views silently disagree is a report nobody trusts.
 */
export default async function MarginsPage({ searchParams }: PageProps) {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);
  const { from, to, key } = monthRange((await searchParams).month);

  let report: MarginReport;
  try {
    const { services } = await viewerServices();
    report = await services.sales.margins(from, to);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const empty = report.byItem.length === 0 && report.byCustomer.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.margins.title}
        description={t.margins.description}
        actions={
          <>
            <ButtonLink href={`/reports/margins?month=${shift(key, -1)}`}>
              <ArrowLeftIcon />
              {t.margins.previous}
            </ButtonLink>
            <ButtonLink href={`/reports/margins?month=${shift(key, 1)}`}>
              {t.margins.next}
              <ArrowRightIcon />
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          [t.margins.month, <span key="m">{DATE.month(from)}</span>],
          [t.margins.revenue, <Money key="r" value={report.total.revenue} showCurrency />],
          [t.margins.cost, <Money key="c" value={report.total.cost} showCurrency />],
          [
            t.margins.margin,
            <span key="g">
              <Money value={report.total.margin} signed showCurrency />
              <MarginPercent basisPoints={report.total.marginBasisPoints} />
            </span>,
          ],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <div className="space-y-1 p-4">
              <p className="text-ink-muted text-xs">{label}</p>
              <p className="numeric text-xl font-semibold">{value}</p>
            </div>
          </Card>
        ))}
      </div>

      {empty ? (
        <Card>
          <EmptyState title={t.margins.emptyTitle} description={t.margins.emptyBody} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t.margins.byProduct}</CardTitle>
              <CardDescription>{t.margins.byProductHint}</CardDescription>
            </CardHeader>
            <TableScroll>
              <Table caption={t.margins.byProductCaption}>
                <thead>
                  <tr>
                    <Th>{t.margins.product}</Th>
                    <Th align="right">{t.margins.sold}</Th>
                    <Th align="right">{t.margins.revenue}</Th>
                    <Th align="right">{t.margins.lateCharges}</Th>
                    <Th align="right">{t.margins.cost}</Th>
                    <Th align="right">{t.margins.margin}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.byItem.map((row) => (
                    <Tr key={row.itemId}>
                      <Td>
                        <Link
                          href={`/stock/${row.itemId}`}
                          className="hover:text-action font-medium underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <span className="text-ink-muted ml-2 text-xs">{row.sku}</span>
                      </Td>
                      <Td align="right" numeric>
                        {toQuantityString(BigInt(row.quantitySoldMinor), row.quantityPrecision)}
                        <span className="text-ink-muted ml-1 text-[11px]">
                          {unitLabel(row.unit)}
                        </span>
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.revenue} />
                      </Td>
                      <Td align="right" numeric>
                        {row.lateCharges.minorUnits === '0' ? (
                          <span className="text-ink-muted text-xs">—</span>
                        ) : (
                          <Money value={row.lateCharges} />
                        )}
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.cost} />
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.margin} signed />
                        <MarginPercent basisPoints={row.marginBasisPoints} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
                <tfoot>
                  <Tr>
                    <Td colSpan={2} className="font-medium">
                      {t.margins.total}
                    </Td>
                    <Td align="right" numeric className="font-semibold">
                      <Money value={report.total.revenue} />
                    </Td>
                    <Td align="right" numeric className="font-semibold">
                      <Money value={report.total.lateCharges} />
                    </Td>
                    <Td align="right" numeric className="font-semibold">
                      <Money value={report.total.cost} />
                    </Td>
                    <Td align="right" numeric className="font-semibold">
                      <Money value={report.total.margin} signed />
                      <MarginPercent basisPoints={report.total.marginBasisPoints} />
                    </Td>
                  </Tr>
                </tfoot>
              </Table>
            </TableScroll>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t.margins.byCustomer}</CardTitle>
              <CardDescription>{t.margins.byCustomerHint}</CardDescription>
            </CardHeader>
            <TableScroll>
              <Table caption={t.margins.byCustomerCaption}>
                <thead>
                  <tr>
                    <Th>{t.margins.customer}</Th>
                    <Th align="right">{t.margins.invoices}</Th>
                    <Th align="right">{t.margins.revenue}</Th>
                    <Th align="right">{t.margins.cost}</Th>
                    <Th align="right">{t.margins.margin}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.byCustomer.map((row) => (
                    <Tr key={row.accountId}>
                      <Td>
                        <Link
                          href={`/accounts/${row.accountId}`}
                          className="hover:text-action font-medium underline-offset-4 hover:underline"
                        >
                          {row.code ? `${row.code} — ${row.name}` : row.name}
                        </Link>
                      </Td>
                      <Td align="right" numeric>
                        {row.invoices}
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.revenue} />
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.cost} />
                      </Td>
                      <Td align="right" numeric>
                        <Money value={row.margin} signed />
                        <MarginPercent basisPoints={row.marginBasisPoints} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
        </>
      )}
    </div>
  );
}

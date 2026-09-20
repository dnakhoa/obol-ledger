import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { AddProductForm, type AccountOption } from '@/components/stock-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { toQuantityString, unitLabel } from '@/lib/quantity';
import { minorUnits, toDecimalString, type CurrencyCode } from '@/lib/money';
import type { ItemSummary } from '@/server/services/inventory';
import type { AccountDto } from '@/server/services/dto';
import type { Messages } from '@/lib/i18n';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.stock.title };
}
export const dynamic = 'force-dynamic';

/**
 * What is in the yard, and what it is worth.
 *
 * This page answers the question the spreadsheet was built to answer, and the
 * one an ordinary ledger cannot: an inventory account balance is a single
 * number covering every product, and it cannot tell you that the granite is
 * moving while the marble has not shifted since March.
 */

/**
 * The costing methods, named the way each language names them.
 *
 * The Vietnamese is not a translation of the English. `Nhập trước, xuất trước`
 * is the phrase Thông tư 200 uses, and an accountant recognises it instantly
 * where a literal rendering of "oldest delivery first" would read as something
 * a foreign system invented. See `src/lib/i18n/messages/vi.ts`.
 */
function methodLabel(method: string, t: Messages): string {
  switch (method) {
    case 'fifo':
      return t.stock.methodFifo;
    case 'lifo':
      return t.stock.methodLifo;
    case 'weighted_average':
      return t.stock.methodAverage;
    case 'specific':
      return t.stock.methodSpecific;
    default:
      return method;
  }
}

export default async function StockPage() {
  const { t } = await translations();
  let items: readonly ItemSummary[];
  let accounts: AccountDto[];
  try {
    const { services } = await viewerServices();
    [items, accounts] = await Promise.all([services.inventory.list(), services.accounts.list()]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const options = (type: AccountDto['type']): AccountOption[] =>
    accounts
      .filter((account) => account.type === type && account.status === 'open')
      .map((account) => ({
        id: account.id,
        label: account.code ? `${account.code} — ${account.name}` : account.name,
      }));

  // Summed from the functional-currency figures, which is the only measure
  // that can be added across lots bought in different currencies.
  const total = items.reduce((sum, item) => sum + BigInt(item.valueMinor), 0n);
  const currency = (items[0]?.currency ?? 'USD') as CurrencyCode;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.stock.title}
        description={t.stock.description}
        actions={
          <ButtonLink href="/stock/import" variant="primary">
            {t.stock.importButton}
            <ArrowRightIcon />
          </ButtonLink>
        }
      />

      {items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.stock.inTheYard}</CardTitle>
            <CardDescription>{t.stock.inTheYardHint}</CardDescription>
          </CardHeader>
          <TableScroll>
            <Table caption={t.stock.tableCaption}>
              <thead>
                <tr>
                  <Th>{t.stock.product}</Th>
                  <Th align="right">{t.stock.onHand}</Th>
                  <Th align="right">{t.stock.deliveriesOpen}</Th>
                  <Th>{t.stock.costedBy}</Th>
                  <Th align="right">{t.stock.value}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <Link
                        href={`/stock/${item.id}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="text-ink-muted ml-2 text-xs">{item.sku}</span>
                    </Td>
                    <Td align="right" numeric>
                      {toQuantityString(BigInt(item.onHandMinor), item.quantityPrecision)}
                      <span className="text-ink-muted ml-1 text-[11px]">
                        {unitLabel(item.unit)}
                      </span>
                    </Td>
                    <Td align="right" numeric>
                      {item.openLayers}
                    </Td>
                    <Td>
                      <span className="text-ink-secondary text-xs">
                        {methodLabel(item.costingMethod, t)}
                      </span>
                      {item.costingInherited ? null : (
                        <Badge className="ml-2">{t.stock.justThisProduct}</Badge>
                      )}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={item.value} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <Tr>
                  <Td colSpan={4} className="font-medium">
                    {t.stock.totalValue}
                  </Td>
                  <Td align="right" numeric className="font-semibold">
                    <Money
                      value={{
                        amount: toDecimalString(minorUnits(total), currency),
                        minorUnits: String(total),
                        currency,
                      }}
                      showCurrency
                    />
                  </Td>
                </Tr>
              </tfoot>
            </Table>
          </TableScroll>
        </Card>
      ) : (
        <Card>
          <EmptyState title={t.stock.emptyTitle} description={t.stock.emptyBody} />
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.stock.addProduct}</CardTitle>
          <CardDescription>{t.stock.addProductHint}</CardDescription>
        </CardHeader>
        <CardBody>
          {options('asset').length === 0 || options('expense').length === 0 ? (
            <p className="text-ink-secondary text-sm">
              {t.stock.needAccounts}{' '}
              <Link href="/accounts" className="underline underline-offset-4">
                {t.stock.chartOfAccountsLink}
              </Link>{' '}
              {t.stock.firstSuffix}
            </p>
          ) : (
            <AddProductForm
              assetAccounts={options('asset')}
              expenseAccounts={options('expense')}
              labels={t.stock}
              working={t.common.working}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

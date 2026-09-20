import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { AddProductForm, type AccountOption } from '@/components/stock-forms';
import { viewerServices } from '@/server/container';
import { toQuantityString, unitLabel } from '@/lib/quantity';
import { minorUnits, toDecimalString, type CurrencyCode } from '@/lib/money';
import type { ItemSummary } from '@/server/services/inventory';
import type { AccountDto } from '@/server/services/dto';

export const metadata: Metadata = { title: 'Stock' };
export const dynamic = 'force-dynamic';

/**
 * What is in the yard, and what it is worth.
 *
 * This page answers the question the spreadsheet was built to answer, and the
 * one an ordinary ledger cannot: an inventory account balance is a single
 * number covering every product, and it cannot tell you that the granite is
 * moving while the marble has not shifted since March.
 */

const METHOD_LABEL: Record<string, string> = {
  fifo: 'Oldest delivery first',
  lifo: 'Newest delivery first',
  weighted_average: 'Average across deliveries',
  specific: 'Delivery picked by hand',
};

export default async function StockPage() {
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
        title="Stock"
        description="Every delivery is kept as its own lot with its own price. When something ships, the ledger works out what it cost from the lots it came from — and tells you which ones."
      />

      {items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What is in the yard</CardTitle>
            <CardDescription>
              Values are what you paid, not what you will sell it for.
            </CardDescription>
          </CardHeader>
          <TableScroll>
            <Table caption="Products held, with quantity on hand and cost value">
              <thead>
                <tr>
                  <Th>Product</Th>
                  <Th align="right">On hand</Th>
                  <Th align="right">Deliveries open</Th>
                  <Th>Costed by</Th>
                  <Th align="right">Value</Th>
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
                        {METHOD_LABEL[item.costingMethod] ?? item.costingMethod}
                      </span>
                      {item.costingInherited ? null : (
                        <Badge className="ml-2">just this product</Badge>
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
                    Total stock value
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
          <EmptyState
            title="No products yet"
            description="Add the things you buy and sell. Once a product exists you can book deliveries against it, and the ledger will work out what each shipment cost."
          />
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a product</CardTitle>
          <CardDescription>
            A product is anything you buy in and sell on. You need one before you can book a
            delivery.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {options('asset').length === 0 || options('expense').length === 0 ? (
            <p className="text-ink-secondary text-sm">
              You need an asset account for the stock to sit in and an expense account for the cost
              of sales. Open them on the{' '}
              <Link href="/accounts" className="underline underline-offset-4">
                chart of accounts
              </Link>{' '}
              first.
            </p>
          ) : (
            <AddProductForm assetAccounts={options('asset')} expenseAccounts={options('expense')} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

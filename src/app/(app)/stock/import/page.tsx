import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { ArrowLeftIcon } from '@/components/icons';
import { StockImportForm } from '@/components/stock-import-form';
import type { AccountOption } from '@/components/stock-forms';
import { viewerServices } from '@/server/container';
import type { AccountDto } from '@/server/services/dto';

export const metadata: Metadata = { title: 'Import deliveries' };
export const dynamic = 'force-dynamic';

/**
 * The page that replaces the workbook.
 *
 * Nothing on it is clever. It takes a paste, shows every row as the ledger
 * read it, and then writes all of them or none. The care is all in the
 * reading: a block copied out of Excel is tab separated, a file exported in a
 * Vietnamese locale is semicolon separated, and `10/01/2026` is the tenth of
 * January. Getting any of those wrong is how an import that should have worked
 * becomes a reason to go back to the spreadsheet.
 */
export default async function ImportPage() {
  let accounts: AccountDto[];
  try {
    accounts = await (await viewerServices()).services.accounts.list();
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const label = (account: AccountDto): AccountOption => ({
    id: account.id,
    label: account.code ? `${account.code} — ${account.name}` : account.name,
  });

  const open = accounts.filter((account) => account.status === 'open');
  const assetAccounts = open.filter((a) => a.type === 'asset' && !a.monetary).map(label);
  const expenseAccounts = open.filter((a) => a.type === 'expense').map(label);
  // Non-monetary assets are excluded for the same reason as on the product
  // page: you cannot settle an invoice with stock or with a cutting machine.
  const creditAccounts = open
    .filter((a) => a.type === 'liability' || (a.type === 'asset' && a.monetary))
    .map(label);

  const ready = assetAccounts.length > 0 && expenseAccounts.length > 0 && creditAccounts.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import deliveries"
        description="Paste the purchase history you already keep. Each row becomes a delivery with its own price, and the purchase is posted to the ledger at the same time."
        actions={
          <ButtonLink href="/stock">
            <ArrowLeftIcon />
            All stock
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>What the file needs</CardTitle>
          <CardDescription>
            A header row and four columns. Everything else is optional, and any column that is not
            one of these is ignored rather than rejected.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ['Product code', 'sku, code, product code, mã hàng'],
              ['Date received', 'date, received, arrived, ngày — 10/01/2026 is 10 January'],
              ['Quantity', 'quantity, qty, số lượng'],
              ['Total cost', 'cost, total, amount, thành tiền — the whole delivery, not per unit'],
              ['Name and unit', 'Only needed for a product that does not exist yet'],
              ['Currency', 'Defaults to the currency the books are kept in'],
              ['Reference', 'reference, container, invoice, lot — what the costing report shows'],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-ink text-xs font-semibold">{term}</dt>
                <dd className="text-ink-secondary text-xs">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-muted text-xs">
            Tab, comma and semicolon separators are all read — pasting straight out of Excel works,
            and so does a file exported on a machine that uses the comma as a decimal mark.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your rows</CardTitle>
          <CardDescription>
            Nothing is written until you have seen every row and pressed import. If one row is
            wrong, none of them are imported — a half-imported set of books is worse than none.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {ready ? (
            <StockImportForm
              assetAccounts={assetAccounts}
              expenseAccounts={expenseAccounts}
              creditAccounts={creditAccounts}
            />
          ) : (
            <p className="text-ink-secondary text-sm">
              You need a stock asset account, a cost-of-sales expense account and something to
              charge the deliveries to. Open them on the{' '}
              <Link href="/accounts" className="underline underline-offset-4">
                chart of accounts
              </Link>{' '}
              first.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

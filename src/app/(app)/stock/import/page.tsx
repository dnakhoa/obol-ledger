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
import { translations } from '@/server/i18n';
import type { AccountDto } from '@/server/services/dto';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.stockImport.title };
}
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
  const { t } = await translations();
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
        title={t.stockImport.title}
        description={t.stockImport.description}
        actions={
          <ButtonLink href="/stock">
            <ArrowLeftIcon />
            {t.product.allStock}
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t.stockImport.requirementsTitle}</CardTitle>
          <CardDescription>{t.stockImport.requirementsHint}</CardDescription>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              [t.stockImport.colProductCode, t.stockImport.colProductCodeHint],
              [t.stockImport.colDate, t.stockImport.colDateHint],
              [t.stockImport.colQuantity, t.stockImport.colQuantityHint],
              [t.stockImport.colCost, t.stockImport.colCostHint],
              [t.stockImport.colNameUnit, t.stockImport.colNameUnitHint],
              [t.stockImport.colCurrency, t.stockImport.colCurrencyHint],
              [t.stockImport.colReference, t.stockImport.colReferenceHint],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="text-ink text-xs font-semibold">{term}</dt>
                <dd className="text-ink-secondary text-xs">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="text-ink-muted text-xs">{t.stockImport.separatorsNote}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.stockImport.yourRows}</CardTitle>
          <CardDescription>{t.stockImport.yourRowsHint}</CardDescription>
        </CardHeader>
        <CardBody>
          {ready ? (
            <StockImportForm
              assetAccounts={assetAccounts}
              expenseAccounts={expenseAccounts}
              creditAccounts={creditAccounts}
              labels={{
                pasteLabel: t.stockImport.pasteLabel,
                pasteHint: t.stockImport.pasteHint,
                pastePlaceholder: t.stockImport.pastePlaceholder,
                chargeTo: t.stockImport.chargeTo,
                chargeToHint: t.stockImport.chargeToHint,
                stockAccount: t.stock.stockAccount,
                stockAccountHint: t.stockImport.stockAccountHint,
                cogsAccount: t.stock.cogsAccount,
                cogsAccountHint: t.stockImport.cogsAccountHint,
                checkButton: t.stockImport.checkButton,
                checking: t.stockImport.checking,
                importing: t.stockImport.importing,
                previewCaption: t.stockImport.previewCaption,
                row: t.stockImport.row,
                product: t.stock.product,
                arrived: t.product.arrived,
                quantity: t.product.quantity,
                cost: t.product.cost,
                reference: t.product.reference,
                status: t.stockImport.status,
                ready: t.stockImport.ready,
                newBadge: t.stockImport.newBadge,
                fixFirst: t.stockImport.fixFirst,
              }}
            />
          ) : (
            <p className="text-ink-secondary text-sm">
              {t.stockImport.needAccounts}{' '}
              <Link href="/accounts" className="underline underline-offset-4">
                {t.stock.chartOfAccountsLink}
              </Link>{' '}
              {t.stock.firstSuffix}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableScroll, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ButtonLink } from '@/components/ui/button';
import { ArrowRightIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { Money } from '@/components/money';
import { MarginPercent } from '@/components/margin';
import { SetupNotice } from '@/components/setup-notice';
import { SaleForm, MAX_LINES, type SaleItemOption, type SaleOption } from '@/components/sale-form';
import { SetupRequiredError } from '@/server/setup-error';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@/lib/money';
import { SUPPORTED_UNITS, toQuantityString, unitLabel } from '@/lib/quantity';
import { formatRate } from '@/server/domain/tax';
import type { SaleSummary } from '@/server/services/sales';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.sales.title };
}
export const dynamic = 'force-dynamic';

/**
 * Invoices, and what each one made.
 *
 * The margin column is the reason the page exists. Before sales carried their
 * own cost, a distributor's ledger could say what was invoiced and, separately,
 * what stock had left — and the question every owner asks of every invoice
 * was answered in a spreadsheet that matched the two up by hand.
 */
export default async function SalesPage() {
  const { locale, t } = await translations();
  const DATE = dateFormats(locale);

  let sales: readonly SaleSummary[];
  let customers: SaleOption[];
  let revenueAccounts: SaleOption[];
  let taxCodes: SaleOption[];
  let taxRates: Record<string, number>;
  let items: SaleItemOption[];
  let functional: CurrencyCode;
  try {
    const { services } = await viewerServices();
    const [recent, accounts, codes, stock] = await Promise.all([
      services.sales.list(),
      services.accounts.list(),
      services.tax.list(),
      services.inventory.list(),
    ]);
    sales = recent;
    const label = (account: { code: string | null; name: string }) =>
      account.code ? `${account.code} — ${account.name}` : account.name;
    // The same derivation month end uses: every account carries its balance
    // in the books' own currency as well as its own.
    functional = (accounts[0]?.baseBalance.currency ?? 'USD') as CurrencyCode;

    // Receivables first — they are who the business sells to — then any other
    // monetary asset, for a sale paid on the spot. Stock and fixed assets are
    // non-monetary and cannot be what a customer pays with.
    const open = accounts.filter((account) => account.status === 'open');
    customers = [
      ...open.filter((a) => a.type === 'asset' && a.openItems),
      ...open.filter((a) => a.type === 'asset' && !a.openItems && a.monetary),
    ].map((account) => ({ id: account.id, label: label(account) }));
    revenueAccounts = open
      .filter((a) => a.type === 'revenue' && a.balance.currency === functional)
      .map((account) => ({ id: account.id, label: label(account) }));
    // What each code charges *on a sale*: the seller under a reverse charge
    // charges nothing, and the running total has to say so.
    taxRates = Object.fromEntries(
      codes.map((code) => [
        code.id,
        code.treatment === 'reverse_charge' ? 0 : code.rateBasisPoints,
      ]),
    );
    taxCodes = codes.map((code) => ({
      id: code.id,
      label: `${code.name} (${formatRate(code.rateBasisPoints)})`,
    }));

    const onHand = stock.filter((item) => item.status === 'active' && item.onHandMinor !== '0');
    items = await Promise.all(
      onHand.map(async (item): Promise<SaleItemOption> => {
        const specific = item.costingMethod === 'specific';
        const lots = specific ? await services.inventory.layers(item.id) : [];
        return {
          id: item.id,
          label: `${item.name} · ${item.sku} (${toQuantityString(BigInt(item.onHandMinor), item.quantityPrecision)} ${unitLabel(item.unit)})`,
          unit: unitLabel(item.unit),
          specific,
          lots: lots.map((lot) => ({
            id: lot.id,
            label: t.product.lotOption(
              lot.reference ?? DATE.day(lot.acquiredAt),
              `${toQuantityString(BigInt(lot.remainingQuantityMinor), item.quantityPrecision)} ${unitLabel(item.unit)}`,
            ),
          })),
        };
      }),
    );
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const currencies = [functional, ...SUPPORTED_CURRENCIES.filter((code) => code !== functional)];
  const lineNumbers = Array.from({ length: MAX_LINES }, (_, index) => index + 1);
  const labels = {
    invoiceNumber: t.sales.invoiceNumber,
    invoiceNumberHint: t.sales.invoiceNumberHint,
    customerAccount: t.sales.customerAccount,
    customerAccountHint: t.sales.customerAccountHint,
    revenueAccount: t.sales.revenueAccount,
    currency: t.sales.currency,
    currencyHint: t.sales.currencyHint,
    taxCode: t.sales.taxCode,
    noTax: t.sales.noTax,
    invoiceDate: t.sales.invoiceDate,
    dueDate: t.sales.dueDate,
    dueDateHint: t.sales.dueDateHint,
    linesLegend: t.sales.linesLegend,
    product: t.sales.product,
    // Resolved per unit here, because the dictionary entry is a function and a
    // function cannot cross to the client.
    quantity: Object.fromEntries(
      SUPPORTED_UNITS.map((unit) => [unitLabel(unit), t.sales.quantity(unitLabel(unit))]),
    ),
    quantityFallback: t.product.quantity,
    lineTotal: t.sales.lineTotal,
    lot: t.sales.lot,
    byMethod: t.sales.byMethod,
    addLine: t.sales.addLine,
    removeLine: lineNumbers.map((line) => t.sales.removeLine(line)),
    lineLabel: lineNumbers.map((line) => t.sales.lineLabel(line)),
    submit: t.sales.submit,
    working: t.common.working,
    openInvoice: t.entry.openSale,
    remove: t.sales.remove,
    net: t.sales.net,
    tax: t.sales.tax,
    gross: t.sales.gross,
  };
  const ready = items.length > 0 && customers.length > 0 && revenueAccounts.length > 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.sales.title}
        description={t.sales.description}
        actions={
          <ButtonLink href="/reports/margins" variant="primary">
            {t.sales.marginsButton}
            <ArrowRightIcon />
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t.sales.recentTitle}</CardTitle>
          <CardDescription>{t.sales.recentHint}</CardDescription>
        </CardHeader>
        {sales.length === 0 ? (
          <EmptyState title={t.sales.emptyTitle} description={t.sales.emptyBody} />
        ) : (
          <TableScroll>
            <Table caption={t.sales.tableCaption}>
              <thead>
                <tr>
                  <Th>{t.sales.invoice}</Th>
                  <Th hideBelow="md">{t.sales.customer}</Th>
                  <Th hideBelow="md">{t.sales.date}</Th>
                  <Th hideBelow="lg">{t.sales.due}</Th>
                  <Th hideBelow="sm" align="right">
                    {t.sales.invoiced}
                  </Th>
                  <Th hideBelow="lg" align="right">
                    {t.sales.revenue}
                  </Th>
                  <Th hideBelow="lg" align="right">
                    {t.sales.cost}
                  </Th>
                  <Th align="right">{t.sales.margin}</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <Tr key={sale.id}>
                    <Td className="whitespace-nowrap">
                      <Link
                        href={`/sales/${sale.id}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {sale.reference}
                      </Link>
                      {/* Who and when, for the screens that drop those columns. */}
                      <span className="text-ink-muted block text-xs whitespace-normal md:hidden">
                        {sale.customerName} · {DATE.day(sale.occurredAt)}
                      </span>
                    </Td>
                    <Td hideBelow="md" className="min-w-40">
                      {sale.customerName}
                    </Td>
                    <Td hideBelow="md" className="whitespace-nowrap">
                      {DATE.day(sale.occurredAt)}
                    </Td>
                    <Td hideBelow="lg" className="whitespace-nowrap">
                      {sale.dueOn ? (
                        DATE.day(new Date(`${sale.dueOn}T12:00:00Z`))
                      ) : (
                        <span className="text-ink-muted text-xs">{t.sales.onReceipt}</span>
                      )}
                    </Td>
                    <Td hideBelow="sm" align="right" numeric>
                      <Money value={sale.gross} showCurrency={sale.currency !== functional} />
                    </Td>
                    <Td hideBelow="lg" align="right" numeric>
                      <Money value={sale.revenue} />
                    </Td>
                    <Td hideBelow="lg" align="right" numeric>
                      <Money value={sale.cost} />
                    </Td>
                    <Td align="right" numeric className="whitespace-nowrap">
                      <Money value={sale.margin} />
                      <MarginPercent basisPoints={sale.marginBasisPoints} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.sales.newTitle}</CardTitle>
          <CardDescription>{t.sales.newHint}</CardDescription>
        </CardHeader>
        <CardBody>
          {ready ? (
            <SaleForm
              customers={customers}
              revenueAccounts={revenueAccounts}
              taxCodes={taxCodes}
              items={items}
              currencies={currencies}
              today={today}
              labels={labels}
              taxRates={taxRates}
              locale={locale}
            />
          ) : (
            <p className="text-ink-secondary text-sm">
              {t.sales.needSetup}{' '}
              <Link href="/stock" className="underline underline-offset-4">
                {t.sales.stockLink}
              </Link>{' '}
              {t.sales.andThe}{' '}
              <Link href="/accounts" className="underline underline-offset-4">
                {t.stock.chartOfAccountsLink}
              </Link>
              .
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

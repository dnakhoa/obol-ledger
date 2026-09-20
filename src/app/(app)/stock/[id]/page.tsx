import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { IssueForm, ReceiveForm, type AccountOption } from '@/components/stock-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { toQuantityString, unitLabel } from '@/lib/quantity';

export const metadata: Metadata = { title: 'Product' };
export const dynamic = 'force-dynamic';

/**
 * One product: what is left of each delivery, and where every shipment's cost
 * came from.
 *
 * The movement table is the reason the feature exists. A shipment shows the
 * lots it drew from by the reference the business already uses — a container
 * number — so the answer can be checked against the yard rather than taken on
 * trust. That is the audit trail a spreadsheet loses the first time someone
 * sorts a column.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await translations();

  let item, lots, movements, accounts, functional;
  try {
    const { services } = await viewerServices();
    item = await services.inventory.item(id);
    if (!item) notFound();
    [lots, movements, accounts] = await Promise.all([
      services.inventory.layers(id),
      services.inventory.movements(id),
      services.accounts.list(),
    ]);
    functional = item.currency;
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const today = new Date().toISOString().slice(0, 10);
  // The books' own currency first: most deliveries are local, and a form that
  // defaults to dollars on a dong ledger is a form that gets it wrong quietly.
  const currencies = [functional, ...SUPPORTED_CURRENCIES.filter((code) => code !== functional)];
  const quantity = (value: string) => toQuantityString(BigInt(value), item.quantityPrecision);

  // What a delivery can be paid from: a supplier you now owe, or money.
  //
  // Non-monetary assets are excluded, which is not a cosmetic filter — stock,
  // work in progress and machinery are IAS 21 non-monetary items, and you
  // cannot settle an invoice with them. That one flag removes every entry in
  // the list that would have been nonsense, without anyone having to maintain
  // a list of which accounts count as cash.
  const creditAccounts: AccountOption[] = accounts
    .filter(
      (account) =>
        account.status === 'open' &&
        (account.type === 'liability' || (account.type === 'asset' && account.monetary)) &&
        account.id !== item.inventoryAccountId,
    )
    .map((account) => ({
      id: account.id,
      label: account.code ? `${account.code} — ${account.name}` : account.name,
    }));

  const lotOptions = lots.map((lot) => ({
    id: lot.id,
    label: t.product.lotOption(
      lot.reference ?? DATE.format(lot.acquiredAt),
      `${quantity(lot.remainingQuantityMinor)} ${unitLabel(item.unit)}`,
    ),
  }));

  // Resolved here rather than in the form: several of these take the unit or
  // the number of decimal places, so in the dictionary they are functions, and
  // a function cannot be serialised across the server/client boundary.
  const unitName = unitLabel(item.unit);
  const receiveLabels = {
    quantity: t.product.howMuchArrived(unitName),
    quantityHint: t.product.decimalHint(item.quantityPrecision),
    cost: t.product.paidInTotal,
    costHint: t.product.paidInTotalHint,
    currency: t.product.paidIn,
    creditAccount: t.product.paidFrom,
    creditAccountHint: t.product.paidFromHint,
    date: t.product.dateArrived,
    reference: t.product.reference,
    referenceHint: t.product.referenceHint,
    submit: t.product.receiveButton,
    working: t.common.working,
  };
  const requiresLot = item.costingMethod === 'specific';
  const issueLabels = {
    quantity: t.product.howMuchWentOut(unitName),
    date: t.product.dateShipped,
    reference: t.product.reference,
    referenceHint: t.product.issueReferenceHint,
    lot: requiresLot ? t.product.whichDelivery : t.product.whichDeliveryOptional,
    lotHint: requiresLot
      ? t.product.whichDeliveryRequiredHint
      : t.product.whichDeliveryOptionalHint,
    lotPlaceholder: requiresLot ? t.product.chooseDelivery : t.product.oldestFirst,
    submit: t.product.issueButton,
    working: t.common.working,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={`${item.sku} · ${t.product.measuredInSuffix(unitLabel(item.unit))}`}
        actions={
          <ButtonLink href="/stock">
            <ArrowLeftIcon />
            {t.product.allStock}
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.product.onHand}</p>
            <p className="numeric text-2xl font-semibold">
              {quantity(item.onHandMinor)}
              <span className="text-ink-muted ml-1.5 text-sm font-normal">
                {unitLabel(item.unit)}
              </span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.product.whatItCost}</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={item.value} showCurrency />
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.product.deliveriesStillOpen}</p>
            <p className="numeric text-2xl font-semibold">{item.openLayers}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.product.lotsTitle}</CardTitle>
          <CardDescription>{t.product.lotsHint}</CardDescription>
        </CardHeader>
        {lots.length === 0 ? (
          <EmptyState title={t.product.nothingOnHand} description={t.product.nothingOnHandBody} />
        ) : (
          <TableScroll>
            <Table caption={t.product.lotsCaption}>
              <thead>
                <tr>
                  <Th>{t.product.reference}</Th>
                  <Th>{t.product.arrived}</Th>
                  <Th align="right">{t.product.left}</Th>
                  <Th align="right">{t.product.paidForLot}</Th>
                  <Th align="right">{t.product.valueOfRemainder}</Th>
                </tr>
              </thead>
              <tbody>
                {lots.map((lot) => (
                  <Tr key={lot.id}>
                    <Td>
                      {lot.transactionId ? (
                        <Link
                          href={`/journal/${lot.transactionId}`}
                          className="hover:text-action font-medium underline-offset-4 hover:underline"
                        >
                          {lot.reference ?? t.product.delivery}
                        </Link>
                      ) : (
                        (lot.reference ?? t.product.openingBalance)
                      )}
                    </Td>
                    <Td>{DATE.format(lot.acquiredAt)}</Td>
                    <Td align="right" numeric>
                      {quantity(lot.remainingQuantityMinor)}
                      <span className="text-ink-muted ml-1 text-[11px]">
                        {t.product.ofTotal(quantity(lot.quantityMinor))}
                      </span>
                    </Td>
                    <Td align="right" numeric>
                      <Money value={lot.cost} showCurrency={lot.currency !== functional} />
                    </Td>
                    <Td align="right" numeric>
                      <Money value={lot.remainingValue} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.product.receiveTitle}</CardTitle>
            <CardDescription>{t.product.receiveHint}</CardDescription>
          </CardHeader>
          <CardBody>
            {creditAccounts.length === 0 ? (
              <p className="text-ink-secondary text-sm">
                {t.product.needCreditAccount}{' '}
                <Link href="/accounts" className="underline underline-offset-4">
                  {t.stock.chartOfAccountsLink}
                </Link>{' '}
                {t.stock.firstSuffix}
              </p>
            ) : (
              <ReceiveForm
                itemId={item.id}
                unit={item.unit}
                precision={item.quantityPrecision}
                currencies={currencies}
                creditAccounts={creditAccounts}
                today={today}
                labels={receiveLabels}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.product.issueTitle}</CardTitle>
            <CardDescription>{t.product.issueHint}</CardDescription>
          </CardHeader>
          <CardBody>
            {lots.length === 0 ? (
              <p className="text-ink-secondary text-sm">{t.product.nothingToShip}</p>
            ) : (
              <IssueForm
                itemId={item.id}
                unit={item.unit}
                precision={item.quantityPrecision}
                today={today}
                lots={lotOptions}
                requiresLot={requiresLot}
                labels={issueLabels}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.product.movementsTitle}</CardTitle>
          <CardDescription>{t.product.movementsHint}</CardDescription>
        </CardHeader>
        {movements.length === 0 ? (
          <EmptyState title={t.product.nothingMoved} description={t.product.nothingMovedBody} />
        ) : (
          <TableScroll>
            <Table caption={t.product.movementsCaption}>
              <thead>
                <tr>
                  <Th>{t.product.date}</Th>
                  <Th>{t.product.whatHappened}</Th>
                  <Th align="right">{t.product.quantity}</Th>
                  <Th>{t.product.costedFrom}</Th>
                  <Th align="right">{t.product.cost}</Th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <Tr key={movement.id}>
                    <Td>{DATE.format(movement.occurredAt)}</Td>
                    <Td>
                      <Link
                        href={`/journal/${movement.transactionId}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {movement.kind === 'receipt' ? t.product.deliveryIn : t.product.shippedOut}
                      </Link>
                      {movement.reference ? (
                        <span className="text-ink-muted ml-2 text-xs">{movement.reference}</span>
                      ) : null}
                    </Td>
                    <Td align="right" numeric>
                      {movement.kind === 'receipt' ? '+' : '−'}
                      {quantity(movement.quantityMinor)}
                    </Td>
                    <Td>
                      {movement.drawnFrom.length === 0 ? (
                        <span className="text-ink-muted text-xs">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {movement.drawnFrom.map((draw) => (
                            <Badge key={draw.layerId}>
                              {draw.layerReference ?? t.product.delivery} ·{' '}
                              {quantity(draw.quantityMinor)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={movement.cost} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>
    </div>
  );
}

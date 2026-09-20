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
    label: `${lot.reference ?? DATE.format(lot.acquiredAt)} — ${quantity(lot.remainingQuantityMinor)} ${unitLabel(item.unit)} left`,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={item.name}
        description={`${item.sku} · measured in ${unitLabel(item.unit)}`}
        actions={
          <ButtonLink href="/stock">
            <ArrowLeftIcon />
            All stock
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">On hand</p>
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
            <p className="text-ink-muted text-xs">What it cost you</p>
            <p className="numeric text-2xl font-semibold">
              <Money value={item.value} showCurrency />
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">Deliveries still open</p>
            <p className="numeric text-2xl font-semibold">{item.openLayers}</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deliveries you still hold</CardTitle>
          <CardDescription>
            Oldest first — the order they will be used in unless you say otherwise.
          </CardDescription>
        </CardHeader>
        {lots.length === 0 ? (
          <EmptyState
            title="Nothing on hand"
            description="Book in a delivery below and it will appear here as its own lot, with its own price."
          />
        ) : (
          <TableScroll>
            <Table caption="Open deliveries, oldest first">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Arrived</Th>
                  <Th align="right">Left</Th>
                  <Th align="right">Paid for the lot</Th>
                  <Th align="right">Value of what is left</Th>
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
                          {lot.reference ?? 'Delivery'}
                        </Link>
                      ) : (
                        (lot.reference ?? 'Opening balance')
                      )}
                    </Td>
                    <Td>{DATE.format(lot.acquiredAt)}</Td>
                    <Td align="right" numeric>
                      {quantity(lot.remainingQuantityMinor)}
                      <span className="text-ink-muted ml-1 text-[11px]">
                        of {quantity(lot.quantityMinor)}
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
            <CardTitle>Book in a delivery</CardTitle>
            <CardDescription>
              This opens a new lot and posts the purchase to the ledger in one go, so the stock
              records and the accounts cannot disagree.
            </CardDescription>
          </CardHeader>
          <CardBody>
            {creditAccounts.length === 0 ? (
              <p className="text-ink-secondary text-sm">
                Open a bank account or a supplier payable on the{' '}
                <Link href="/accounts" className="underline underline-offset-4">
                  chart of accounts
                </Link>{' '}
                first.
              </p>
            ) : (
              <ReceiveForm
                itemId={item.id}
                unit={item.unit}
                precision={item.quantityPrecision}
                currencies={currencies}
                creditAccounts={creditAccounts}
                today={today}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ship it out</CardTitle>
            <CardDescription>
              The ledger works out what it cost from the lots it came from, and refuses if there is
              not enough.
            </CardDescription>
          </CardHeader>
          <CardBody>
            {lots.length === 0 ? (
              <p className="text-ink-secondary text-sm">
                There is nothing on hand to ship. Book in a delivery first.
              </p>
            ) : (
              <IssueForm
                itemId={item.id}
                unit={item.unit}
                precision={item.quantityPrecision}
                today={today}
                lots={lotOptions}
                requiresLot={item.costingMethod === 'specific'}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Everything that has moved</CardTitle>
          <CardDescription>
            Each shipment shows which deliveries it was costed from. This is the working you would
            otherwise keep in a spreadsheet.
          </CardDescription>
        </CardHeader>
        {movements.length === 0 ? (
          <EmptyState
            title="Nothing has moved yet"
            description="Deliveries and shipments will be listed here."
          />
        ) : (
          <TableScroll>
            <Table caption="Stock movements, most recent first">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>What happened</Th>
                  <Th align="right">Quantity</Th>
                  <Th>Costed from</Th>
                  <Th align="right">Cost</Th>
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
                        {movement.kind === 'receipt' ? 'Delivery in' : 'Shipped out'}
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
                              {draw.layerReference ?? 'lot'} · {quantity(draw.quantityMinor)}
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

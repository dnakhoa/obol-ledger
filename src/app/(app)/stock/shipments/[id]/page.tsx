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
import { AddChargeForm } from '@/components/shipment-forms';
import type { AccountOption } from '@/components/stock-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import { toQuantityString, unitLabel, type Unit } from '@/lib/quantity';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const shipment = await (await viewerServices()).services.landedCost.shipment(id);
    if (shipment) return { title: shipment.reference };
  } catch {
    // The page renders the setup notice; a title is not worth failing on.
  }
  const { t } = await translations();
  return { title: t.shipments.title };
}

export const dynamic = 'force-dynamic';

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, t } = await translations();
  const format = dateFormats(locale);

  let shipment, accounts;
  try {
    const { services } = await viewerServices();
    shipment = await services.landedCost.shipment(id);
    if (!shipment) notFound();
    accounts = await services.accounts.list();
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const label = (account: (typeof accounts)[number]): AccountOption => ({
    id: account.id,
    label: account.code ? `${account.code} — ${account.name}` : account.name,
  });
  const open = accounts.filter((account) => account.status === 'open');
  const creditAccounts = open
    .filter((a) => a.type === 'liability' || (a.type === 'asset' && a.monetary))
    .map(label);
  // Reclaimable tax is an asset against the revenue authority, so that is what
  // the list offers — a monetary asset, never the stock account itself.
  const assetAccounts = open.filter((a) => a.type === 'asset' && a.monetary).map(label);

  const quantity = (value: string, unit: string) =>
    `${toQuantityString(BigInt(value), unit === 'piece' ? 0 : 2)} ${unitLabel(unit as Unit)}`;

  const KINDS: Record<string, string> = {
    freight: t.shipments.kindFreight,
    duty: t.shipments.kindDuty,
    insurance: t.shipments.kindInsurance,
    handling: t.shipments.kindHandling,
    tax: t.shipments.kindTax,
    other: t.shipments.kindOther,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={shipment.reference}
        description={shipment.notes ?? format.full(shipment.arrivedAt)}
        actions={
          <ButtonLink href="/stock/shipments">
            <ArrowLeftIcon />
            {t.shipments.title}
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          [t.shipments.goods, shipment.goods, false],
          [t.shipments.charges, shipment.charges, false],
          [t.shipments.landed, shipment.landed, true],
        ].map(([title, value, emphasis]) => (
          <Card key={String(title)}>
            <CardBody className="space-y-1">
              <p className="text-ink-muted text-xs">{String(title)}</p>
              <p className={emphasis ? 'numeric text-xl font-semibold' : 'numeric text-xl'}>
                <Money value={value as never} />
              </p>
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardBody className="space-y-1">
            <p className="text-ink-muted text-xs">{t.shipments.uplift}</p>
            <p className="numeric text-xl font-semibold">
              {(shipment.upliftBasisPoints / 100).toFixed(1)}%
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.shipments.lotsTitle}</CardTitle>
        </CardHeader>
        <TableScroll>
          <Table caption={t.shipments.lotsTitle}>
            <thead>
              <tr>
                <Th>{t.product.reference}</Th>
                <Th>{t.stock.product}</Th>
                <Th align="right">{t.product.quantity}</Th>
                <Th align="right">{t.product.left}</Th>
                <Th align="right">{t.shipments.landed}</Th>
              </tr>
            </thead>
            <tbody>
              {shipment.lots.map((lot) => (
                <Tr key={lot.id}>
                  <Td>{lot.reference ?? '—'}</Td>
                  <Td>{lot.itemName}</Td>
                  <Td align="right" numeric>
                    {quantity(lot.quantityMinor, lot.unit)}
                  </Td>
                  <Td align="right" numeric>
                    {quantity(lot.remainingQuantityMinor, lot.unit)}
                  </Td>
                  <Td align="right" numeric>
                    <Money value={lot.carrying} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.shipments.chargesTitle}</CardTitle>
          <CardDescription>{t.shipments.chargesHint}</CardDescription>
        </CardHeader>
        {shipment.charges_.length === 0 ? (
          <EmptyState title={t.shipments.noCharges} description={t.shipments.noChargesBody} />
        ) : (
          <TableScroll>
            <Table caption={t.shipments.chargesCaption}>
              <thead>
                <tr>
                  <Th>{t.shipments.kind}</Th>
                  <Th>{t.shipments.chargeDescription}</Th>
                  <Th align="right">{t.shipments.amount}</Th>
                  <Th align="right">{t.shipments.toStock}</Th>
                  <Th align="right">{t.shipments.toCogs}</Th>
                </tr>
              </thead>
              <tbody>
                {shipment.charges_.map((charge) => (
                  <Tr key={charge.id}>
                    <Td>{KINDS[charge.kind] ?? charge.kind}</Td>
                    <Td>
                      <Link
                        href={`/journal/${charge.transactionId}`}
                        className="hover:text-action underline-offset-4 hover:underline"
                      >
                        {charge.description}
                      </Link>
                      {charge.capitalise ? null : (
                        <Badge tone="neutral" className="ml-2">
                          {t.shipments.notCapitalised}
                        </Badge>
                      )}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={charge.amount} showCurrency />
                    </Td>
                    <Td align="right" numeric>
                      <Money value={charge.toInventory} />
                    </Td>
                    <Td align="right" numeric>
                      <Money value={charge.toCogs} />
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
          <CardTitle>{t.shipments.addCharge}</CardTitle>
        </CardHeader>
        <CardBody>
          {shipment.lots.length === 0 ? (
            <p className="text-ink-secondary text-sm">{t.shipments.emptyBody}</p>
          ) : (
            <AddChargeForm
              shipmentId={shipment.id}
              currencies={SUPPORTED_CURRENCIES}
              creditAccounts={creditAccounts}
              assetAccounts={assetAccounts}
              today={new Date().toISOString().slice(0, 10)}
              labels={{
                kind: t.shipments.kind,
                description: t.shipments.chargeDescription,
                descriptionPlaceholder: t.shipments.kindFreight,
                amount: t.shipments.amount,
                currency: t.product.paidIn,
                basis: t.shipments.basis,
                basisHint: t.shipments.basisHint,
                creditAccount: t.shipments.creditAccount,
                capitalise: t.shipments.capitalise,
                capitaliseHint: t.shipments.capitaliseHint,
                capitaliseYes: t.shipments.capitaliseYes,
                capitaliseNo: t.shipments.capitaliseNo,
                debitAccount: t.shipments.debitAccount,
                date: t.shipments.chargeDate,
                submit: t.shipments.submit,
                working: t.common.working,
                kinds: KINDS,
                bases: {
                  value: t.shipments.basisValue,
                  quantity: t.shipments.basisQuantity,
                  weight: t.shipments.basisWeight,
                },
              }}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

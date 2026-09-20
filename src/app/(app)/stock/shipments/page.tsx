import type { Metadata } from 'next';
import Link from 'next/link';
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
import { RecordShipmentForm } from '@/components/shipment-forms';
import { viewerServices } from '@/server/container';
import { translations } from '@/server/i18n';
import { dateFormats } from '@/lib/i18n';
import type { ShipmentSummary } from '@/server/services/landed-cost';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await translations();
  return { title: t.shipments.title };
}
export const dynamic = 'force-dynamic';

/**
 * What each container actually cost to land.
 *
 * The uplift column is the point of the page. A business that has only ever
 * seen the supplier invoice does not know whether freight and duty add 3% or
 * 30%, and the answer decides whether a shipment was worth taking.
 */
export default async function ShipmentsPage() {
  const { locale, t } = await translations();
  const format = dateFormats(locale);

  let shipments: readonly ShipmentSummary[];
  try {
    shipments = await (await viewerServices()).services.landedCost.shipments();
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.shipments.title}
        description={t.shipments.description}
        actions={
          <ButtonLink href="/stock">
            <ArrowLeftIcon />
            {t.product.allStock}
          </ButtonLink>
        }
      />

      <Card>
        {shipments.length === 0 ? (
          <EmptyState title={t.shipments.emptyTitle} description={t.shipments.emptyBody} />
        ) : (
          <TableScroll>
            <Table caption={t.shipments.caption}>
              <thead>
                <tr>
                  <Th>{t.shipments.reference}</Th>
                  <Th>{t.shipments.arrived}</Th>
                  <Th align="right">{t.shipments.lots}</Th>
                  <Th align="right">{t.shipments.goods}</Th>
                  <Th align="right">{t.shipments.charges}</Th>
                  <Th align="right">{t.shipments.landed}</Th>
                  <Th align="right">{t.shipments.uplift}</Th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((shipment) => (
                  <Tr key={shipment.id}>
                    <Td>
                      <Link
                        href={`/stock/shipments/${shipment.id}`}
                        className="hover:text-action font-medium underline-offset-4 hover:underline"
                      >
                        {shipment.reference}
                      </Link>
                    </Td>
                    <Td numeric>{format.day(shipment.arrivedAt)}</Td>
                    <Td align="right" numeric>
                      {shipment.layerCount}
                    </Td>
                    <Td align="right" numeric>
                      <Money value={shipment.goods} />
                    </Td>
                    <Td align="right" numeric>
                      <Money value={shipment.charges} />
                    </Td>
                    <Td align="right" numeric className="font-medium">
                      <Money value={shipment.landed} />
                    </Td>
                    <Td align="right" numeric>
                      {/*
                        Basis points divided at the last moment: a percentage
                        of an integer should not become a float any earlier
                        than the string it is about to be printed as.
                      */}
                      <Badge tone={shipment.upliftBasisPoints > 1500 ? 'caution' : 'neutral'}>
                        {(shipment.upliftBasisPoints / 100).toFixed(1)}%
                      </Badge>
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
          <CardTitle>{t.shipments.newShipment}</CardTitle>
          <CardDescription>{t.shipments.newShipmentHint}</CardDescription>
        </CardHeader>
        <CardBody>
          <RecordShipmentForm
            today={today}
            labels={{
              reference: t.shipments.reference,
              referenceHint: t.shipments.newShipmentHint,
              arrived: t.shipments.arrived,
              create: t.shipments.create,
              working: t.common.working,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}

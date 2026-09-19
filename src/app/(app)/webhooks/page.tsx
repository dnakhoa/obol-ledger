import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableScroll, Td, Th } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { EndpointForm } from '@/components/endpoint-form';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { demoServices } from '@/server/container';
import { MAX_ATTEMPTS } from '@/server/domain/webhook';
import type { DeliveryDto, EndpointDto } from '@/server/services/webhooks';
import {
  dispatchNowAction,
  registerEndpointAction,
  removeEndpointAction,
  replayDeliveryAction,
  setEndpointEnabledAction,
} from './actions';

export const metadata: Metadata = { title: 'Webhooks' };
export const dynamic = 'force-dynamic';

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

const STATUS_TONE = {
  succeeded: 'positive',
  failed: 'negative',
  pending: 'caution',
  delivering: 'neutral',
} as const;

export default async function WebhooksPage() {
  let endpoints: EndpointDto[];
  let deliveries: DeliveryDto[];

  try {
    const services = await demoServices();
    [endpoints, deliveries] = await Promise.all([
      services.webhooks.list(),
      services.webhooks.deliveries({ limit: 30 }),
    ]);
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const queued = deliveries.filter((row) => row.status === 'pending').length;

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Every ledger change is announced from inside the transaction that caused it, so a subscriber can never miss an entry that actually posted."
        actions={
          <form action={dispatchNowAction}>
            <Button type="submit" variant="secondary" disabled={queued === 0}>
              {queued === 0 ? 'Nothing queued' : `Deliver ${queued} now`}
            </Button>
          </form>
        }
      />

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>
              An endpoint that fails repeatedly is disabled automatically; re-enabling clears the
              count.
            </CardDescription>
          </div>
        </CardHeader>

        {endpoints.length === 0 ? (
          <EmptyState
            title="No subscribers yet"
            description="Register an https endpoint below and post an entry — the delivery, its signature and every retry show up in the log."
          />
        ) : (
          <TableScroll>
            <Table caption="Registered webhook endpoints">
              <thead>
                <tr>
                  <Th>Endpoint</Th>
                  {/*
                    Dropped on a phone, where four columns would squeeze the
                    URL into a one-character-per-line ribbon. Nothing is lost:
                    "All events" is the common case and the subscription is
                    visible as soon as the table has room.
                  */}
                  <Th className="hidden sm:table-cell">Events</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <Td className="font-medium">
                      <span className="block max-w-[14rem] truncate sm:max-w-[26rem]">
                        {endpoint.url}
                      </span>
                      {endpoint.description ? (
                        <span className="text-ink-muted text-[11px] font-normal">
                          {endpoint.description}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-ink-secondary hidden text-xs sm:table-cell">
                      {endpoint.eventTypes.length === 0
                        ? 'All events'
                        : endpoint.eventTypes.join(', ')}
                    </Td>
                    <Td>
                      {endpoint.enabled ? (
                        <Badge tone="positive">Enabled</Badge>
                      ) : (
                        <Badge tone="caution">Disabled</Badge>
                      )}
                      {endpoint.consecutiveFailures > 0 ? (
                        <span className="text-ink-muted ml-2 text-[11px]">
                          {endpoint.consecutiveFailures} failing
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <form action={setEndpointEnabledAction}>
                          <input type="hidden" name="endpointId" value={endpoint.id} />
                          <input
                            type="hidden"
                            name="enabled"
                            value={endpoint.enabled ? 'false' : 'true'}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {endpoint.enabled ? 'Disable' : 'Enable'}
                          </Button>
                        </form>
                        <form action={removeEndpointAction}>
                          <input type="hidden" name="endpointId" value={endpoint.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Remove
                          </Button>
                        </form>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Delivery log</CardTitle>
            <CardDescription>
              Every attempt, with the subscriber&rsquo;s own status code and response. Failures
              retry with full jitter, up to {MAX_ATTEMPTS} times.
            </CardDescription>
          </div>
        </CardHeader>

        {deliveries.length === 0 ? (
          <EmptyState
            title="Nothing delivered yet"
            description="Post an entry once an endpoint is registered. The delivery row is written in the same transaction as the entry."
          />
        ) : (
          <TableScroll>
            <Table caption="Recent webhook deliveries">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Event</Th>
                  <Th className="hidden md:table-cell">Endpoint</Th>
                  <Th align="right" className="hidden sm:table-cell">
                    Attempts
                  </Th>
                  <Th>Result</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <Td className="text-ink-muted text-xs whitespace-nowrap">
                      {WHEN.format(new Date(delivery.createdAt))}
                    </Td>
                    <Td className="font-mono text-xs">{delivery.eventType}</Td>
                    <Td className="text-ink-secondary hidden max-w-[18rem] truncate text-xs md:table-cell">
                      {byId.get(delivery.endpointId)?.url ?? delivery.endpointId}
                    </Td>
                    <Td align="right" numeric className="hidden sm:table-cell">
                      {delivery.attempts}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[delivery.status as keyof typeof STATUS_TONE]}>
                        {delivery.status}
                      </Badge>
                      {delivery.lastStatusCode ? (
                        <span className="text-ink-muted ml-2 text-[11px]">
                          HTTP {delivery.lastStatusCode}
                        </span>
                      ) : null}
                      {delivery.lastError ? (
                        <span className="text-ink-muted block max-w-[22rem] truncate text-[11px]">
                          {delivery.lastError}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {delivery.status === 'failed' ? (
                        <form action={replayDeliveryAction}>
                          <input type="hidden" name="deliveryId" value={delivery.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Replay
                          </Button>
                        </form>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </Card>

      <EndpointForm action={registerEndpointAction} />
    </>
  );
}

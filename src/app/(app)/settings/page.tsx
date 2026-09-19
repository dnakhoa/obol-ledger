import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableScroll, Td, Th } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { ApiKeyForm } from '@/components/api-key-form';
import { SetupNotice } from '@/components/setup-notice';
import { SetupRequiredError } from '@/server/setup-error';
import { demoServices } from '@/server/container';
import type { ApiKeyDto } from '@/server/services/api-keys';
import { issueApiKeyAction, revokeApiKeyAction } from './actions';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

export default async function SettingsPage() {
  let keys: ApiKeyDto[];
  try {
    keys = await (await demoServices()).apiKeys.list();
  } catch (error) {
    if (error instanceof SetupRequiredError) return <SetupNotice detail={error.message} />;
    throw error;
  }

  const active = keys.filter((key) => key.revokedAt === null);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Credentials for the published demo tenant. Tokens are stored as SHA-256 digests, so a leaked database backup yields nothing usable."
      />

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              {active.length} active of {keys.length}. Revoked keys stay listed — a deleted row
              answers &ldquo;who had access, and until when?&rdquo; with silence.
            </CardDescription>
          </div>
        </CardHeader>

        {keys.length === 0 ? (
          <EmptyState
            title="No keys yet"
            description="Issue one below, then use it as a bearer token against /api/v1."
          />
        ) : (
          <TableScroll>
            <Table caption="API keys for this tenant">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Key</Th>
                  <Th className="hidden sm:table-cell">Last used</Th>
                  <Th>Status</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <Td className="font-medium">{key.name}</Td>
                    <Td className="text-ink-secondary font-mono text-xs whitespace-nowrap">
                      {key.tokenPrefix}
                      <span className="text-ink-muted">…</span>
                    </Td>
                    <Td className="text-ink-muted hidden text-xs whitespace-nowrap sm:table-cell">
                      {key.lastUsedAt ? WHEN.format(new Date(key.lastUsedAt)) : 'Never'}
                    </Td>
                    <Td>
                      {key.revokedAt ? (
                        <Badge tone="neutral">Revoked</Badge>
                      ) : (
                        <Badge tone="positive">Active</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      {key.revokedAt ? null : (
                        <form action={revokeApiKeyAction}>
                          <input type="hidden" name="keyId" value={key.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Revoke
                          </Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}

        <CardBody className="border-line border-t">
          <ApiKeyForm action={issueApiKeyAction} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="space-y-0.5">
            <CardTitle>Using a key</CardTitle>
            <CardDescription>
              Reads are open on this demo; every write needs a bearer token.
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <pre className="border-line bg-surface-sunken text-ink-secondary overflow-x-auto rounded-lg border p-4 text-xs">
            <code>{`curl -X POST https://obol-ledger.vercel.app/api/v1/transfers \\
  -H "authorization: Bearer $OBOL_KEY" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: $(uuidgen)" \\
  -d '{
    "description": "Coffee beans",
    "currency": "USD",
    "fromAccountId": "acct_…",
    "toAccountId": "acct_…",
    "amount": "42.50"
  }'`}</code>
          </pre>
        </CardBody>
      </Card>
    </>
  );
}

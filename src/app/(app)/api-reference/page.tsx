import type { Metadata } from 'next';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { openApiDocument } from '@/server/http/openapi';

export const metadata: Metadata = { title: 'API reference' };

/**
 * The API reference, rendered from the live OpenAPI document.
 *
 * Nothing on this page is written by hand. The document is assembled from the
 * same zod schemas the routes validate against, so the reference cannot drift
 * from the implementation the way a hand-maintained page always eventually
 * does. It is a static render — the spec only changes on deploy.
 */
type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  responses?: Record<string, { description?: string }>;
};

const METHOD_TONE: Record<string, 'positive' | 'neutral'> = { get: 'neutral', post: 'positive' };

export default function ApiReferencePage() {
  const document = openApiDocument();
  const paths = document['paths'] as Record<string, Record<string, Operation>>;
  const info = document['info'] as { title: string; version: string; description: string };

  const operations = Object.entries(paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
  );

  const byTag = new Map<string, typeof operations>();
  for (const entry of operations) {
    const tag = entry.operation.tags?.[0] ?? 'Other';
    byTag.set(tag, [...(byTag.get(tag) ?? []), entry]);
  }

  return (
    <>
      <PageHeader
        title="API reference"
        description={info.description}
        actions={
          <a
            href="/api/openapi.json"
            className="border-line hover:bg-surface-hover inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors duration-150"
          >
            openapi.json
          </a>
        }
      />

      <Card>
        <CardBody className="text-ink-secondary grid gap-4 text-xs sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-ink font-medium">Amounts are strings</p>
            <p>
              A JSON number is a double, so <code className="font-mono">12.10</code> is already
              <code className="font-mono"> 12.099999999999999</code> before the server sees it.
              Amounts are sent as exact decimal strings and stored as integer minor units.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-ink font-medium">Retries are safe</p>
            <p>
              Send an <code className="font-mono">Idempotency-Key</code> on any write. The same key
              with the same body replays the stored response; with a different body it is a 409.
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-ink font-medium">Errors are machine-readable</p>
            <p>
              Failures are RFC 9457 problem documents. Branch on{' '}
              <code className="font-mono">type</code>; the figures you need are extension members,
              so nothing has to be parsed out of prose.
            </p>
          </div>
        </CardBody>
      </Card>

      {[...byTag.entries()].map(([tag, entries]) => (
        <Card key={tag}>
          <CardHeader>
            <CardTitle>{tag}</CardTitle>
            <CardDescription>
              {entries.length} {entries.length === 1 ? 'operation' : 'operations'}
            </CardDescription>
          </CardHeader>
          <ul className="divide-line divide-y">
            {entries.map(({ path, method, operation }) => (
              <li key={`${method}-${path}`} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={METHOD_TONE[method] ?? 'neutral'} className="font-mono uppercase">
                    {method}
                  </Badge>
                  <code className="font-mono text-sm font-medium">/api/v1{path}</code>
                  {operation.security ? (
                    <Badge tone="caution">Bearer token</Badge>
                  ) : (
                    <Badge>Public</Badge>
                  )}
                </div>
                {operation.summary ? (
                  <p className="text-ink-secondary mt-1.5 text-sm">{operation.summary}</p>
                ) : null}
                {operation.description ? (
                  <p className="text-ink-muted mt-1 text-xs">{operation.description}</p>
                ) : null}
                {operation.responses ? (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(operation.responses).map(([status, response]) => (
                      <span
                        key={status}
                        title={response.description ?? ''}
                        className="numeric border-line text-ink-muted rounded border px-1.5 py-0.5 text-[11px]"
                      >
                        {status}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

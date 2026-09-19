import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '@/server/http/openapi';

type Operation = {
  summary?: string;
  description?: string;
  security?: unknown[];
  responses?: Record<string, unknown>;
  requestBody?: unknown;
};

const document = openApiDocument();
const paths = document['paths'] as Record<string, Record<string, Operation>>;
const components = document['components'] as { schemas: Record<string, unknown> };

const operations = Object.entries(paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
);

const API_ROOT = fileURLToPath(new URL('../../src/app/api/v1', import.meta.url));

/** Every `route.ts` under `/api/v1`, as the OpenAPI path it serves. */
function routesOnDisk(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'route.ts') {
        // `src/app/api/v1/accounts/[accountId]/route.ts` -> `/accounts/{accountId}`
        const segment = relative(API_ROOT, directory).replaceAll('\\', '/');
        found.push(`/${segment}`.replace(/\[(\w+)\]/gu, '{$1}'));
      }
    }
  };
  walk(API_ROOT);
  return found.sort();
}

/**
 * The published contract is generated, so these assert the *generator* — that
 * it produces a document a client can actually consume, and that it keeps
 * agreeing with the routes as both change.
 */
describe('OpenAPI document', () => {
  it('declares a version tools recognise', () => {
    expect(document['openapi']).toBe('3.1.0');
    expect(document['info']).toMatchObject({ title: 'Obol Ledger API' });
  });

  it('covers every route the application serves', () => {
    // Read off the filesystem rather than compared with a list written by
    // hand. A hand-written list is a second copy of the same mistake: someone
    // adding a route forgets the document *and* the list, and the test passes
    // while the published contract silently omits an endpoint.
    expect(routesOnDisk()).toEqual(Object.keys(paths).sort());
  });

  it('gives every operation a summary and a success response', () => {
    for (const { path, method, operation } of operations) {
      expect(operation.summary, `${method} ${path} has no summary`).toBeTruthy();
      const statuses = Object.keys(operation.responses ?? {});
      expect(
        statuses.some((status) => status.startsWith('2')),
        `${method} ${path}`,
      ).toBe(true);
    }
  });

  it('requires a bearer token on every write, and on reads that return credentials', () => {
    const WRITE_METHODS = new Set(['post', 'patch', 'put', 'delete']);

    // The scheduler's endpoint is the one write that is not client-facing: it
    // authenticates with CRON_SECRET, so documenting bearerAuth on it would
    // tell an integrator to try a credential that will never work.
    const NOT_BEARER = ['/webhooks/dispatch'];

    // The demo publishes one tenant's *ledger* for anyone to read. Its
    // credentials are a different kind of data: listing keys reveals what
    // access exists and when it was last exercised, which is reconnaissance
    // rather than accounting.
    const PROTECTED_READS = ['/api-keys'];

    for (const { path, method, operation } of operations) {
      const secured = Array.isArray(operation.security);
      const expected = WRITE_METHODS.has(method)
        ? !NOT_BEARER.includes(path)
        : PROTECTED_READS.includes(path);
      expect(secured, `${method} ${path} security`).toBe(expected);
    }
  });

  it('documents a request body for every write that takes one', () => {
    // State transitions are the exception: `/entries/{id}/post` and
    // `/archive` identify everything they need from the path, so a body would
    // be ceremony. They must still be documented as taking none, rather than
    // leaving a client to guess.
    const TRANSITIONS = [
      '/entries/{entryId}/post',
      '/entries/{entryId}/archive',
      // Replay names the delivery in the path and copies everything else from
      // the original; a body could only contradict it.
      '/webhook-deliveries/{deliveryId}/replay',
      // Triggered by the scheduler with nothing to say.
      '/webhooks/dispatch',
    ];

    for (const { path, method, operation } of operations) {
      if (method !== 'post') continue;
      if (TRANSITIONS.includes(path)) {
        expect(operation.requestBody, `${path} should take no body`).toBeUndefined();
        expect(operation.description, `${path} needs a description`).toBeTruthy();
        continue;
      }
      expect(operation.requestBody, `${method} ${path} has no request body`).toBeTruthy();
    }
  });

  it('derives request schemas from the zod validators', () => {
    // If this drifts, the published contract would describe a body the server
    // rejects — the exact failure generating the document is meant to prevent.
    const createEntry = components.schemas['CreateEntry'] as {
      type: string;
      required: string[];
      properties: Record<string, unknown>;
    };

    expect(createEntry.type).toBe('object');
    expect(createEntry.required).toEqual(
      expect.arrayContaining(['description', 'currency', 'postings']),
    );
    expect(Object.keys(createEntry.properties).sort()).toEqual([
      'currency',
      'description',
      'expectedVersions',
      'occurredAt',
      'postings',
      'status',
    ]);
  });

  it('constrains amounts to strings, never JSON numbers', () => {
    const transfer = components.schemas['CreateTransfer'] as {
      properties: { amount: { type: string } };
    };
    expect(transfer.properties.amount.type).toBe('string');
  });

  it('resolves every $ref it emits', () => {
    const refs = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        if (key === '$ref' && typeof nested === 'string') refs.add(nested);
        else walk(nested);
      }
    };
    walk(document);

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '');
      expect(components.schemas, `dangling $ref ${ref}`).toHaveProperty(name);
    }
  });

  it('serialises to JSON without throwing', () => {
    // zod's output can carry symbols or bigints if the schemas grow carelessly;
    // the route stringifies this on every request.
    expect(() => JSON.stringify(document)).not.toThrow();
  });
});

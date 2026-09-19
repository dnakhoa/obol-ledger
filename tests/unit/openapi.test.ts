import { describe, expect, it } from 'vitest';
import { openApiDocument } from '@/server/http/openapi';

type Operation = {
  summary?: string;
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
    expect(Object.keys(paths).sort()).toEqual([
      '/accounts',
      '/accounts/{accountId}',
      '/accounts/{accountId}/statement',
      '/entries',
      '/entries/{entryId}',
      '/entries/{entryId}/reverse',
      '/health',
      '/reports/balance-sheet',
      '/reports/income-statement',
      '/reports/trial-balance',
      '/transfers',
    ]);
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

  it('requires a bearer token on every write and on no read', () => {
    for (const { path, method, operation } of operations) {
      const secured = Array.isArray(operation.security);
      expect(secured, `${method} ${path} security`).toBe(method === 'post');
    }
  });

  it('documents a request body for every write', () => {
    for (const { path, method, operation } of operations) {
      if (method !== 'post') continue;
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
      'occurredAt',
      'postings',
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

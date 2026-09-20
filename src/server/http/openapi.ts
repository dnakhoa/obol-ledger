import { z } from 'zod';
import {
  createAccountSchema,
  createApiKeySchema,
  createEndpointSchema,
  createEntrySchema,
  createTransferSchema,
  paginationSchema,
  updateEndpointSchema,
} from './schemas';

/**
 * The OpenAPI document, built from the same zod schemas the routes validate
 * with.
 *
 * Hand-written API documentation is wrong the moment someone adds a field.
 * Deriving the request schemas from the validators means the published contract
 * cannot describe a body the server would reject — the two are the same object.
 * OpenAPI 3.1 is a superset of JSON Schema 2020-12, which is exactly what
 * `z.toJSONSchema` emits, so no translation layer is needed.
 */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<
    string,
    unknown
  >;
}

const moneySchema = {
  type: 'object',
  required: ['amount', 'minorUnits', 'currency'],
  properties: {
    amount: {
      type: 'string',
      description: 'Exact decimal, e.g. "1234.56".',
      examples: ['1234.56'],
    },
    minorUnits: {
      type: 'string',
      description:
        'The same value as an integer count of minor units, sent as a string so that values beyond 2^53 survive JSON.',
      examples: ['123456'],
    },
    currency: { type: 'string', examples: ['USD'] },
  },
} as const;

const problemSchema = {
  type: 'object',
  description: 'RFC 9457 Problem Details. Extension members carry the specifics of the failure.',
  required: ['type', 'title', 'status', 'detail'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    code: { type: 'string' },
    requestId: { type: 'string' },
  },
} as const;

const accountSchema = {
  type: 'object',
  required: ['id', 'name', 'type', 'status', 'overdraftAllowed', 'balance', 'createdAt'],
  properties: {
    id: { type: 'string', examples: ['acct_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    name: { type: 'string' },
    type: { enum: ['asset', 'liability', 'equity', 'revenue', 'expense'] },
    status: { enum: ['open', 'closed'] },
    overdraftAllowed: { type: 'boolean' },
    balance: {
      allOf: [{ $ref: '#/components/schemas/Money' }],
      description: 'The settled balance. Only posted entries count.',
    },
    pendingBalance: {
      allOf: [{ $ref: '#/components/schemas/Money' }],
      description:
        'Settled plus in-flight: what the balance becomes if every pending entry settles.',
    },
    availableBalance: {
      allOf: [{ $ref: '#/components/schemas/Money' }],
      description:
        'Settled minus in-flight outflows: what can still be spent. This is the balance the overdraft rule consults, so an authorisation reserves funds the moment it is made.',
    },
    version: {
      type: 'integer',
      description:
        'Optimistic-concurrency token, incremented on every balance change. Pass it back in `expectedVersions` to apply a write only if the account has not moved.',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const transactionSchema = {
  type: 'object',
  required: ['id', 'description', 'currency', 'occurredAt', 'createdAt', 'postings'],
  properties: {
    id: { type: 'string', examples: ['txn_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    description: { type: 'string' },
    currency: { type: 'string' },
    status: {
      enum: ['pending', 'posted', 'archived'],
      description:
        'pending reserves funds without moving them; posted has settled; archived was cancelled before settling. Posted and archived are immutable.',
    },
    postedAt: { type: ['string', 'null'], format: 'date-time' },
    archivedAt: { type: ['string', 'null'], format: 'date-time' },
    occurredAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    postings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'accountId', 'accountName', 'direction', 'amount', 'sequence'],
        properties: {
          id: { type: 'string' },
          accountId: { type: 'string' },
          accountName: { type: 'string' },
          direction: { enum: ['debit', 'credit'] },
          amount: { $ref: '#/components/schemas/Money' },
          sequence: { type: 'integer' },
        },
      },
    },
  },
} as const;

function envelope(schema: unknown, withCursor = false): Record<string, unknown> {
  return {
    type: 'object',
    required: ['data'],
    properties: {
      data: schema,
      ...(withCursor
        ? {
            meta: {
              type: 'object',
              properties: {
                nextCursor: { type: ['string', 'null'] },
                previousCursor: { type: ['string', 'null'] },
              },
            },
          }
        : {}),
    },
  };
}

function problemResponses(...statuses: number[]): Record<string, unknown> {
  const titles: Record<number, string> = {
    400: 'Validation failed',
    401: 'Authentication required',
    404: 'Not found',
    409: 'Conflict',
    422: 'The request was understood but cannot be applied to the ledger',
    429: 'Rate limited',
    503: 'Dependency unavailable',
  };
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      {
        description: titles[status] ?? 'Error',
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
    ]),
  );
}

const paginationParameters = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    description: 'Opaque keyset cursor taken from a previous response’s meta.nextCursor.',
    schema: { type: 'string' },
  },
  {
    name: 'format',
    in: 'query',
    required: false,
    description:
      'csv streams a download instead of JSON — RFC 4180, CRLF, a UTF-8 BOM so Excel reads it correctly, and cells beginning = + - @ neutralised against spreadsheet formula injection. An export is the whole listing; limit and cursor apply to the JSON view only.',
    schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
  },
];

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description:
    'Replays a previous response instead of posting twice. Reusing a key with a different body is a 409.',
  schema: { type: 'string', maxLength: 255 },
};

export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Obol Ledger API',
      version: '1.0.0',
      description:
        'A double-entry ledger. Every entry is balanced, append-only, and enforced by the database as well as the application. Amounts are exchanged as exact decimal strings, never as JSON numbers.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'Accounts' },
      { name: 'Journal' },
      { name: 'Reports' },
      { name: 'Webhooks' },
      { name: 'Credentials' },
      { name: 'Operations' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Required for all writes.' },
      },
      schemas: {
        Money: moneySchema,
        Problem: problemSchema,
        Account: accountSchema,
        Transaction: transactionSchema,
        CreateAccount: jsonSchema(createAccountSchema),
        CreateEntry: jsonSchema(createEntrySchema),
        CreateTransfer: jsonSchema(createTransferSchema),
        Pagination: jsonSchema(paginationSchema),
        CreateEndpoint: jsonSchema(createEndpointSchema),
        UpdateEndpoint: jsonSchema(updateEndpointSchema),
        CreateApiKey: jsonSchema(createApiKeySchema),
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Operations'],
          summary: 'Liveness and database readiness',
          description:
            'Runs a trivial query against the database. A 503 body reports whether DATABASE_URL is configured and the driver error code, so the cause is visible without reading logs.',
          responses: {
            '200': { description: 'Healthy' },
            '503': {
              description: 'The database is unreachable',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { const: 'degraded' },
                      database: {
                        type: 'object',
                        properties: {
                          configured: { type: 'boolean' },
                          reachable: { const: false },
                          code: {
                            type: 'string',
                            description: 'Driver or Postgres error code, e.g. ENOTFOUND or 28P01.',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/accounts': {
        get: {
          tags: ['Accounts'],
          summary: 'List every account with its current balance',
          responses: {
            '200': {
              description: 'Accounts, ordered by name',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/Account' },
                  }),
                },
              },
            },
            ...problemResponses(429),
          },
        },
        post: {
          tags: ['Accounts'],
          summary: 'Open an account',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateAccount' } },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': { schema: envelope({ $ref: '#/components/schemas/Account' }) },
              },
            },
            ...problemResponses(400, 401, 409, 429),
          },
        },
      },
      '/accounts/{accountId}': {
        get: {
          tags: ['Accounts'],
          summary: 'Fetch one account',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'The account',
              content: {
                'application/json': { schema: envelope({ $ref: '#/components/schemas/Account' }) },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/accounts/{accountId}/statement': {
        get: {
          tags: ['Accounts'],
          summary: 'Paginated statement with a running balance',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
            ...paginationParameters,
          ],
          responses: {
            '200': { description: 'Statement lines, newest first' },
            ...problemResponses(400, 404, 429),
          },
        },
      },
      '/entries': {
        get: {
          tags: ['Journal'],
          summary: 'List journal entries, newest first',
          parameters: [
            ...paginationParameters,
            {
              name: 'accountId',
              in: 'query',
              required: false,
              description: 'Only entries with a posting touching this account.',
              schema: { type: 'string' },
            },
            {
              name: 'search',
              in: 'query',
              required: false,
              description: 'Case-insensitive substring of the description.',
              schema: { type: 'string' },
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              description: 'Restrict to one lifecycle state.',
              schema: { type: 'string', enum: ['pending', 'posted', 'archived'] },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description:
                'csv streams a download instead of JSON: one row per posting, RFC 4180, UTF-8 BOM, and cells beginning = + - @ neutralised against spreadsheet formula injection.',
              schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
            },
            {
              name: 'metadataKey',
              in: 'query',
              required: false,
              description:
                'With metadataValue, an exact match on one metadata pair — e.g. metadataKey=invoice&metadataValue=INV-42. Answered by a GIN index.',
              schema: { type: 'string' },
            },
            {
              name: 'metadataValue',
              in: 'query',
              required: false,
              description: 'The value metadataKey must equal. Both are required together.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'A page of entries',
              content: {
                'application/json': {
                  schema: envelope(
                    { type: 'array', items: { $ref: '#/components/schemas/Transaction' } },
                    true,
                  ),
                },
              },
            },
            ...problemResponses(400, 429),
          },
        },
        post: {
          tags: ['Journal'],
          summary: 'Record a balanced journal entry',
          description:
            'Postings must sum to zero. The entry is written in a single database transaction and a deferred constraint verifies the balance at COMMIT.',
          security: [{ bearerAuth: [] }],
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateEntry' } },
            },
          },
          responses: {
            '201': {
              description: 'Recorded',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 409, 422, 429),
          },
        },
      },
      '/entries/{entryId}': {
        get: {
          tags: ['Journal'],
          summary: 'Fetch one entry with its postings',
          parameters: [{ name: 'entryId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The entry',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/transfers': {
        post: {
          tags: ['Journal'],
          summary: 'Move money between two accounts',
          description: 'Sugar for a two-legged journal entry; identical guarantees.',
          security: [{ bearerAuth: [] }],
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateTransfer' } },
            },
          },
          responses: {
            '201': {
              description: 'Recorded',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 409, 422, 429),
          },
        },
      },
      '/entries/{entryId}/post': {
        post: {
          tags: ['Journal'],
          summary: 'Settle a pending entry',
          description:
            'Moves the entry from pending to posted: its amounts stop being reserved and start counting toward the posted balance. The overdraft rule is re-checked, because funds available at authorisation may be gone by settlement.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'entryId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The settled entry',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            ...problemResponses(401, 404, 409, 422, 429),
          },
        },
      },
      '/entries/{entryId}/archive': {
        post: {
          tags: ['Journal'],
          summary: 'Cancel a pending entry before it settles',
          description:
            'Releases the reservation; nothing moves. Distinct from a reversal, which cancels money that did move by posting an opposite entry — here there is nothing to mirror.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'entryId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The archived entry',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            ...problemResponses(401, 404, 409, 429),
          },
        },
      },
      '/entries/{entryId}/reverse': {
        post: {
          tags: ['Journal'],
          summary: 'Undo an entry by posting its mirror image',
          description:
            'A POST that creates a new entry rather than a DELETE that removes one, because that is what happens: the original stays on the record and a second entry cancels it. An entry can be reversed at most once.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'entryId', in: 'path', required: true, schema: { type: 'string' } },
            idempotencyHeader,
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Defaults to "Reversal of <original>".',
                    },
                    occurredAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'The reversing entry',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Transaction' }),
                },
              },
            },
            ...problemResponses(401, 404, 409, 422, 429),
          },
        },
      },
      '/reports/balance-sheet': {
        get: {
          tags: ['Reports'],
          summary: 'Assets, liabilities and equity at a point in time',
          description:
            '`balanced` is computed rather than assumed: a balance sheet that does not balance means the ledger is inconsistent.',
          parameters: [
            {
              name: 'currency',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'USD' },
            },
          ],
          responses: {
            '200': { description: 'The balance sheet' },
            ...problemResponses(400, 429),
          },
        },
      },
      '/reports/income-statement': {
        get: {
          tags: ['Reports'],
          summary: 'Revenue and expenses over a period',
          description:
            'Revenue and expenses are flows, so a period is required. Defaults to the last 30 days rather than all time, because an income statement with no period attached is meaningless.',
          parameters: [
            {
              name: 'currency',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'USD' },
            },
            {
              name: 'from',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: {
            '200': { description: 'The income statement' },
            ...problemResponses(400, 429),
          },
        },
      },
      '/api-keys': {
        get: {
          tags: ['Credentials'],
          summary: 'List this tenant\u2019s keys',
          description:
            'Digests are never returned. Each key carries an identifying prefix and the time it was last used, which is what makes revoking the right one possible.',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'Keys, newest first' },
            ...problemResponses(401, 429),
          },
        },
        post: {
          tags: ['Credentials'],
          summary: 'Issue a key',
          description:
            'Returns the token exactly once; only its SHA-256 digest is stored. Minting a key requires an existing key, so the first one comes from the seed rather than from an open endpoint.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateApiKey' } },
            },
          },
          responses: {
            '201': { description: 'Issued, with the token' },
            ...problemResponses(400, 401, 429),
          },
        },
      },
      '/api-keys/{keyId}': {
        delete: {
          tags: ['Credentials'],
          summary: 'Revoke a key',
          description:
            'The row is kept and `revoked_at` is set, because a deleted row answers "who had access, and until when?" with silence. Revoking twice is a 404, not a silent success.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'keyId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'The revoked key' },
            ...problemResponses(401, 404, 429),
          },
        },
      },
      '/webhook-endpoints': {
        get: {
          tags: ['Webhooks'],
          summary: 'List registered endpoints',
          description: 'Signing secrets are never included; they are returned once, at creation.',
          responses: {
            '200': { description: 'Endpoints, newest first' },
            ...problemResponses(429),
          },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Register an endpoint',
          description:
            'Returns the signing secret exactly once. Store it: it cannot be read back, only rotated. An empty eventTypes subscribes to everything.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateEndpoint' } },
            },
          },
          responses: {
            '201': { description: 'Registered, with the signing secret' },
            ...problemResponses(400, 401, 409, 429),
          },
        },
      },
      '/webhook-endpoints/{endpointId}': {
        get: {
          tags: ['Webhooks'],
          summary: 'Fetch one endpoint',
          parameters: [
            { name: 'endpointId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'The endpoint' },
            ...problemResponses(404, 429),
          },
        },
        patch: {
          tags: ['Webhooks'],
          summary: 'Enable or disable an endpoint',
          description:
            'Re-enabling clears the consecutive-failure count, so the circuit breaker does not trip again on the next single failure.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'endpointId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UpdateEndpoint' } },
            },
          },
          responses: {
            '200': { description: 'The updated endpoint' },
            ...problemResponses(400, 401, 404, 429),
          },
        },
        delete: {
          tags: ['Webhooks'],
          summary: 'Remove an endpoint and its delivery history',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'endpointId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Removed' },
            ...problemResponses(401, 404, 429),
          },
        },
      },
      '/webhook-deliveries': {
        get: {
          tags: ['Webhooks'],
          summary: 'The delivery log',
          description:
            'Every attempt, with its status code, response excerpt and next retry time — so a subscriber can diagnose its own failures without a support thread.',
          parameters: [
            { name: 'endpointId', in: 'query', required: false, schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'delivering', 'succeeded', 'failed'] },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
          ],
          responses: {
            '200': { description: 'Deliveries, newest first' },
            ...problemResponses(400, 429),
          },
        },
      },
      '/webhook-deliveries/{deliveryId}/replay': {
        post: {
          tags: ['Webhooks'],
          summary: 'Queue the same event again',
          description:
            'Creates a new delivery rather than resetting the old one, so the record of the original failure survives. The payload carries a replayOf link for deduplication.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'deliveryId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '202': { description: 'Queued' },
            ...problemResponses(401, 404, 429),
          },
        },
      },
      '/webhooks/dispatch': {
        post: {
          tags: ['Operations'],
          summary: 'Drain the delivery queue',
          description:
            'Triggered by the scheduler, authenticated with CRON_SECRET. Documented because an operator needs to know it exists, not because clients should call it.',
          responses: {
            '200': { description: 'What the run claimed, sent and abandoned' },
            ...problemResponses(401),
          },
        },
      },
      '/metrics': {
        get: {
          tags: ['Operations'],
          summary: 'Prometheus metrics',
          description:
            'Text exposition format. obol_ledger_residual_minor is the one worth alerting on: it has exactly one correct value, zero, in every currency.',
          responses: { '200': { description: 'Metrics in Prometheus text format' } },
        },
      },
      '/reports/trial-balance': {
        get: {
          tags: ['Reports'],
          summary: 'Debits, credits and residual per currency',
          description: 'A residual other than zero means the ledger is inconsistent.',
          responses: {
            '200': { description: 'One row per currency' },
            ...problemResponses(429),
          },
        },
      },
    },
  };
}

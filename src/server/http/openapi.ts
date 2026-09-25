import { z } from 'zod';
import { WRITE_OFF_REASONS } from '@/server/domain/costing';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
} from '@/server/domain/document';
import {
  createAccountSchema,
  createApiKeySchema,
  createItemSchema,
  createSaleSchema,
  createCreditNoteSchema,
  createSupplierReturnSchema,
  bankFeedSchema,
  bankMatchSchema,
  bankRecordSchema,
  recordRateSchema,
  createEndpointSchema,
  createEntrySchema,
  createTransferSchema,
  issueStockSchema,
  paginationSchema,
  receiveStockSchema,
  updateEndpointSchema,
  writeOffStockSchema,
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

const money = { $ref: '#/components/schemas/Money' } as const;
const nullableMoney = { oneOf: [money, { type: 'null' }] } as const;

/**
 * A quantity comes back twice, like money: exact scaled integer and decimal.
 * `name` is the decimal field; `${name}Minor` is the integer.
 */
function quantityPair(name: string, what: string): Record<string, unknown> {
  return {
    [name]: {
      type: 'string',
      description: `${what}, as a decimal string to the item’s precision.`,
      examples: ['24.687'],
    },
    [`${name}Minor`]: {
      type: 'string',
      description: `${what}, as an integer scaled by 10^quantityPrecision. Exact; store this one.`,
      examples: ['24687'],
    },
  };
}

const itemSchema = {
  type: 'object',
  required: ['id', 'sku', 'name', 'unit', 'quantityPrecision', 'costingMethod', 'onHand', 'value'],
  properties: {
    id: { type: 'string', examples: ['item_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    sku: { type: 'string' },
    name: { type: 'string' },
    unit: { type: 'string', examples: ['m2', 'tonne', 'piece'] },
    quantityPrecision: {
      type: 'integer',
      minimum: 0,
      maximum: 6,
      description: 'How many decimal places a quantity of this item may have.',
    },
    costingMethod: { enum: ['fifo', 'weighted_average', 'specific', 'lifo'] },
    costingInherited: {
      type: 'boolean',
      description: 'True when the method is the organisation’s rather than the item’s own.',
    },
    status: { enum: ['active', 'archived'] },
    ...quantityPair('onHand', 'What is on hand'),
    value: {
      allOf: [money],
      description:
        'What the open lots are carried at, in the functional currency — the figure the inventory account holds.',
    },
    valueMinor: { type: 'string' },
    currency: { type: 'string' },
    openLayers: { type: 'integer' },
    inventoryAccountId: { type: 'string' },
    cogsAccountId: { type: 'string' },
  },
} as const;

const layerSchema = {
  type: 'object',
  description: 'A lot: one delivery, at the price it was bought for.',
  properties: {
    id: { type: 'string', examples: ['layer_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    reference: { type: ['string', 'null'] },
    acquiredAt: { type: 'string', format: 'date-time' },
    currency: { type: 'string', description: 'What the lot was paid in.' },
    ...quantityPair('quantity', 'What arrived'),
    ...quantityPair('remainingQuantity', 'What is left'),
    cost: { allOf: [money], description: 'What was paid, in the currency it was paid in.' },
    remainingValue: {
      allOf: [money],
      description: 'What is left of it, in the functional currency.',
    },
    transactionId: { type: ['string', 'null'] },
  },
} as const;

const movementSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['move_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    kind: { enum: ['receipt', 'issue', 'writeoff', 'return', 'supplier_return'] },
    ...quantityPair('quantity', 'How much moved'),
    cost: { allOf: [money], description: 'In the functional currency.' },
    occurredAt: { type: 'string', format: 'date-time' },
    reference: { type: ['string', 'null'] },
    costingMethod: { enum: ['fifo', 'weighted_average', 'specific', 'lifo'] },
    transactionId: { type: 'string' },
    reason: { enum: [...WRITE_OFF_REASONS, null], description: 'Set on a write-off only.' },
    saleId: { type: ['string', 'null'] },
    revenue: nullableMoney,
    drawnFrom: {
      type: 'array',
      description: 'The lots this movement was costed from, oldest first. Empty for a receipt.',
      items: {
        type: 'object',
        properties: {
          layerId: { type: 'string' },
          layerReference: { type: ['string', 'null'] },
          ...quantityPair('quantity', 'How much came from this lot'),
          cost: money,
        },
      },
    },
  },
} as const;

const marginFields = {
  revenue: money,
  cost: money,
  margin: money,
  marginBasisPoints: {
    type: ['integer', 'null'],
    description: 'Margin over revenue, in hundredths of a percent. Null when there is no revenue.',
  },
} as const;

const saleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['sale_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    reference: { type: 'string', description: 'The invoice number.' },
    customerAccountId: { type: 'string' },
    customerName: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    dueOn: { type: ['string', 'null'], format: 'date' },
    currency: { type: 'string', description: 'What the invoice is in.' },
    net: { allOf: [money], description: 'As invoiced, in the invoice currency.' },
    tax: money,
    gross: money,
    ...marginFields,
    transactionId: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          movementId: { type: 'string' },
          itemId: { type: 'string' },
          sku: { type: 'string' },
          itemName: { type: 'string' },
          unit: { type: 'string' },
          quantityPrecision: { type: 'integer' },
          ...quantityPair('quantity', 'How much was sold'),
          ...marginFields,
          amount: { allOf: [money], description: 'The line’s net total as invoiced.' },
          ...quantityPair('creditedQuantity', 'How much has come back on credit notes'),
          creditedAmount: money,
          creditedRevenue: money,
          returnedCost: money,
          drawnFrom: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layerReference: { type: ['string', 'null'] },
                ...quantityPair('quantity', 'How much came from this lot'),
              },
            },
          },
        },
      },
    },
  },
  description:
    'Revenue, cost and margin are in the functional currency; net, tax and gross are as invoiced. The invoiced figures never change; credited says what credit notes took back, and netRevenue, netCost and netMargin are what the sale is worth after them.',
} as const;

const creditNoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['cn_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    reference: { type: 'string', description: 'The credit note number.' },
    saleId: { type: 'string' },
    saleReference: { type: 'string', description: 'The invoice it corrects.' },
    customerAccountId: { type: 'string' },
    customerName: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    reason: { type: ['string', 'null'] },
    currency: { type: 'string', description: 'Always the invoice’s currency.' },
    net: money,
    tax: money,
    gross: money,
    revenue: { allOf: [money], description: 'Net credited, in the functional currency.' },
    cost: { allOf: [money], description: 'What the returned goods cost, put back into stock.' },
    revenueAccountId: { type: 'string' },
    transactionId: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          saleMovementId: { type: 'string' },
          itemId: { type: 'string' },
          sku: { type: 'string' },
          itemName: { type: 'string' },
          unit: { type: 'string' },
          quantityPrecision: { type: 'integer' },
          ...quantityPair('quantity', 'How much came back; zero for a price allowance'),
          amount: money,
          revenue: money,
          cost: money,
        },
      },
    },
  },
} as const;

const supplierReturnSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', examples: ['sret_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'] },
    reference: { type: 'string', description: 'The debit note or return authorisation number.' },
    itemId: { type: 'string' },
    sku: { type: 'string' },
    itemName: { type: 'string' },
    unit: { type: 'string' },
    quantityPrecision: { type: 'integer' },
    layerId: { type: 'string', description: 'The delivery the goods went back from.' },
    layerReference: { type: ['string', 'null'] },
    counterpartyAccountId: { type: 'string', description: 'Who gives the money back.' },
    counterpartyName: { type: 'string' },
    expenseAccountId: {
      type: ['string', 'null'],
      description: 'Where unrefunded cost went; null when there was none.',
    },
    occurredAt: { type: 'string', format: 'date-time' },
    reason: { type: ['string', 'null'] },
    ...quantityPair('quantity', 'How much went back'),
    refund: { allOf: [money], description: 'Given back, net, in the lot’s currency.' },
    tax: { allOf: [money], description: 'Input tax reversed with it.' },
    gross: money,
    carrying: {
      allOf: [money],
      description:
        'What the lot carried the goods at, landed cost included, in the functional currency.',
    },
    unrecovered: {
      allOf: [money],
      description: 'Carrying less refund: landed cost nobody refunds. Negative is a gain.',
    },
    transactionId: { type: 'string' },
  },
} as const;

const attachmentSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'The attachment. Removing it takes the file off the entry.',
      examples: ['dlink_01JBQZ8Q2N7K3F5M9R1T4V6X8Z'],
    },
    documentId: { type: 'string', description: 'The file, stored once per tenant.' },
    filename: { type: 'string' },
    contentType: { enum: [...DOCUMENT_CONTENT_TYPES], description: 'Decided from the bytes.' },
    sizeBytes: { type: 'integer' },
    sha256: { type: 'string', description: 'Hex SHA-256 of the content.' },
    kind: { enum: [...DOCUMENT_KINDS] },
    note: { type: ['string', 'null'] },
    transactionId: { type: ['string', 'null'] },
    shipmentId: { type: ['string', 'null'] },
    attachedAt: { type: 'string', format: 'date-time' },
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
    413: 'The file is larger than the limit',
    415: 'That kind of file is not accepted',
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

const itemIdParameter = {
  name: 'itemId',
  in: 'path',
  required: true,
  schema: { type: 'string' },
} as const;

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
      { name: 'Stock' },
      { name: 'Sales' },
      { name: 'Bank' },
      { name: 'Webhooks' },
      { name: 'Periods' },
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
        RecordRate: jsonSchema(recordRateSchema),
        Item: itemSchema,
        Layer: layerSchema,
        Movement: movementSchema,
        Sale: saleSchema,
        CreditNote: creditNoteSchema,
        CreateCreditNote: jsonSchema(createCreditNoteSchema),
        SupplierReturn: supplierReturnSchema,
        Attachment: attachmentSchema,
        BankFeed: jsonSchema(bankFeedSchema),
        BankMatch: jsonSchema(bankMatchSchema),
        BankEntry: jsonSchema(bankRecordSchema),
        CreateSupplierReturn: jsonSchema(createSupplierReturnSchema),
        CreateItem: jsonSchema(createItemSchema),
        ReceiveStock: jsonSchema(receiveStockSchema),
        IssueStock: jsonSchema(issueStockSchema),
        WriteOffStock: jsonSchema(writeOffStockSchema),
        CreateSale: jsonSchema(createSaleSchema),
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
      '/entries/{entryId}/documents': {
        get: {
          tags: ['Journal'],
          summary: 'What an entry is supported by',
          parameters: [{ name: 'entryId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Attachments, in the order they were attached',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/Attachment' },
                  }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
        post: {
          tags: ['Journal'],
          summary: 'Attach a supplier invoice, customs declaration or receipt',
          description: `multipart/form-data with file, kind (one of ${DOCUMENT_KINDS.join(', ')}) and an optional note. The type is decided from the content: PDF, PNG, JPEG, WebP or plain XML, and nothing else — a file that is not one of those is a 415, over ${MAX_DOCUMENT_BYTES / 1048576} MiB a 413. The same file is stored once per tenant, and attaching it twice to one entry returns the attachment it already has, so a retried upload is safe.`,
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'entryId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file', 'kind'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    kind: { enum: [...DOCUMENT_KINDS] },
                    note: { type: 'string', maxLength: 280 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'The attachment',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/Attachment' }),
                },
              },
            },
            ...problemResponses(400, 401, 404, 413, 415, 422, 429),
          },
        },
      },
      '/entries/{entryId}/documents/{linkId}': {
        delete: {
          tags: ['Journal'],
          summary: 'Take an attachment off an entry',
          description:
            'The file and the record that it was attached both stay; the attachment is marked removed.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'entryId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '204': { description: 'Removed' },
            ...problemResponses(401, 404, 429),
          },
        },
      },
      '/documents/{documentId}/content': {
        get: {
          tags: ['Journal'],
          summary: 'Download a document exactly as it was uploaded',
          description:
            'Served with the type decided at upload and nosniff. XML is always sent as an attachment; ?download=1 sends anything as one.',
          parameters: [
            { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'download',
              in: 'query',
              required: false,
              schema: { enum: ['1'] },
            },
          ],
          responses: {
            '200': {
              description: 'The file',
              content: {
                'application/pdf': { schema: { type: 'string', format: 'binary' } },
                'image/*': { schema: { type: 'string', format: 'binary' } },
                'application/xml': { schema: { type: 'string', format: 'binary' } },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/bank-accounts': {
        get: {
          tags: ['Bank'],
          summary: 'Accounts a bank statement can be reconciled against',
          description:
            'Monetary asset and liability accounts that are not customer or supplier ledgers: bank accounts, cards, loans. Each with how many statement lines it has and how many are still unmatched.',
          responses: {
            '200': { description: 'Reconcilable accounts' },
            ...problemResponses(429),
          },
        },
      },
      '/bank-accounts/{accountId}/lines': {
        get: {
          tags: ['Bank'],
          summary: 'The statement, newest first',
          description:
            'Each unmatched line carries candidates — postings on the account for the same amount within two weeks, nearest first — and suggested, set only when the line and the posting are each other’s nearest.',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Statement lines' }, ...problemResponses(429) },
        },
        post: {
          tags: ['Bank'],
          summary: 'Push lines from a bank feed',
          description:
            'Each line carries the bank’s own id; a line already received is skipped, so resending a day is harmless. Amounts are signed decimals in the account’s currency, money in positive.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BankFeed' } } },
          },
          responses: {
            '201': { description: 'How many lines were added and how many were already there' },
            ...problemResponses(400, 401, 422, 429),
          },
        },
      },
      '/bank-accounts/{accountId}/statements': {
        post: {
          tags: ['Bank'],
          summary: 'Import a statement file exported from online banking',
          description:
            'The CSV as the request body (comma, semicolon or tab). Column names are recognised in English, Vietnamese and Japanese; an amount may be one signed column or separate money-in and money-out columns; dates may be day-first or year-first. Every line or none: a row that cannot be read is a 422 naming it. Lines already imported are skipped.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'filename', in: 'query', required: false, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
          responses: {
            '201': { description: 'How many lines were added and how many were already there' },
            ...problemResponses(401, 422, 429),
          },
        },
      },
      '/bank-accounts/{accountId}/reconciliation': {
        get: {
          tags: ['Bank'],
          summary: 'The reconciliation statement',
          description:
            'The books’ balance, the bank’s latest reported balance, and the two lists that explain the gap: lines on the statement not yet in the books, and postings in the books not yet on the statement. difference is zero when those explain it all.',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'The reconciliation' },
            ...problemResponses(404, 422, 429),
          },
        },
      },
      '/bank-lines/{lineId}/match': {
        post: {
          tags: ['Bank'],
          summary: 'Match a statement line to the posting that records it',
          description:
            'The posting must be on the statement’s account and for the same amount to the unit; each line and each posting is matched at most once. The database enforces both.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'lineId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BankMatch' } } },
          },
          responses: {
            '201': { description: 'Matched' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
          },
        },
        delete: {
          tags: ['Bank'],
          summary: 'Undo a match',
          description: 'The match is marked undone; the record that it was made stays.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'lineId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'Undone' }, ...problemResponses(401, 404, 409, 429) },
        },
      },
      '/bank-lines/{lineId}/entry': {
        post: {
          tags: ['Bank'],
          summary: 'Book a statement line the books have nothing for, and match it',
          description:
            'For a fee, interest or a transfer nobody booked: posts the line’s own amount between the account and counterAccountId, dated the day the bank moved the money, and matches the line to it.',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'lineId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BankEntry' } } },
          },
          responses: {
            '201': { description: 'The entry written and the line it matches' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
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
      '/rates': {
        get: {
          tags: ['Periods'],
          summary: 'Exchange rates on file',
          description:
            'Point-in-time facts, never updated. A lookup asks for the most recent rate at or before a date, so re-running last quarter\u2019s reports uses last quarter\u2019s rates.',
          responses: {
            '200': { description: 'Rates, newest first' },
            ...problemResponses(429),
          },
        },
        post: {
          tags: ['Periods'],
          summary: 'Record a rate',
          description:
            'Re-recording the same pair, day and source is a correction rather than a second opinion. A rate is a decimal string with up to ten places \u2014 never a JSON number, which would already have lost precision.',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RecordRate' } },
            },
          },
          responses: {
            '201': { description: 'Recorded' },
            ...problemResponses(400, 401, 422, 429),
          },
        },
      },
      '/periods/{periodMonth}/revalue': {
        post: {
          tags: ['Periods'],
          summary: 'Retranslate foreign monetary balances at the closing rate',
          description:
            'IAS 21 remeasurement: cash, receivables and payables held in a foreign currency are restated at the month-end rate and the difference goes to profit or loss. Inventory and fixed assets are not \u2014 they stay at the rate they were bought at. Cumulative rather than reversing, so running it twice posts nothing the second time. `?preview=true` computes the adjustment without posting it.',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'periodMonth',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            },
            {
              name: 'preview',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['true', 'false'], default: 'false' },
            },
          ],
          responses: {
            '200': { description: 'The retranslation, posted or previewed' },
            ...problemResponses(400, 401, 409, 422, 429),
          },
        },
      },
      '/periods': {
        get: {
          tags: ['Periods'],
          summary: 'Months, and whether they still accept entries',
          description:
            'A month with entries but no period row is open; the row is created when it is closed.',
          responses: {
            '200': { description: 'Months, newest first' },
            ...problemResponses(429),
          },
        },
      },
      '/periods/{periodMonth}/close': {
        post: {
          tags: ['Periods'],
          summary: 'Close a month',
          description:
            'Posts a closing entry that zeroes revenue and expense into retained earnings, then locks the month against any entry dated inside it. The closing entry goes through the journal like any other, so it obeys the same balance rule. Periods close in order, and the current month cannot be closed.',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'periodMonth',
              in: 'path',
              required: true,
              description: 'The month, as YYYY-MM.',
              schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            },
          ],
          responses: {
            '200': { description: 'The closed period' },
            ...problemResponses(400, 401, 409, 422, 429),
          },
        },
      },
      '/periods/{periodMonth}/reopen': {
        post: {
          tags: ['Periods'],
          summary: 'Reopen a closed month',
          description:
            'Reverses the closing entry, dated inside the month rather than today, and unlocks it. The original close stays on the record.',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'periodMonth',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            },
          ],
          responses: {
            '200': { description: 'The reopened period' },
            ...problemResponses(400, 401, 409, 429),
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
      '/items': {
        get: {
          tags: ['Stock'],
          summary: 'List products with what is on hand and its value',
          responses: {
            '200': {
              description: 'Products, ordered by SKU',
              content: {
                'application/json': {
                  schema: envelope({ type: 'array', items: { $ref: '#/components/schemas/Item' } }),
                },
              },
            },
            ...problemResponses(429),
          },
        },
        post: {
          tags: ['Stock'],
          summary: 'Add a product',
          description:
            'Both accounts must be in the functional currency: stock is non-monetary and is never retranslated. Without costingMethod the item follows the organisation’s. LIFO is refused outside a US GAAP chart.',
          security: [{ bearerAuth: [] }],
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateItem' } },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': { schema: envelope({ $ref: '#/components/schemas/Item' }) },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
          },
        },
      },
      '/items/{itemId}': {
        get: {
          tags: ['Stock'],
          summary: 'Fetch one product with its open lots and recent movements',
          description:
            'Lots are oldest first — the order FIFO takes them in. Movements are the 50 most recent, newest first.',
          parameters: [itemIdParameter],
          responses: {
            '200': {
              description: 'The product',
              content: {
                'application/json': {
                  schema: envelope({
                    allOf: [
                      { $ref: '#/components/schemas/Item' },
                      {
                        type: 'object',
                        properties: {
                          layers: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Layer' },
                          },
                          movements: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/Movement' },
                          },
                        },
                      },
                    ],
                  }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/items/{itemId}/receipts': movementWrite({
        summary: 'Book a delivery',
        description:
          'Posts the purchase and opens a lot in one transaction, or does neither. quantity is to the item’s precision — a digit more is a 422, never a rounding. cost is the whole delivery in currency; a foreign cost is converted at the rate on the day it arrived and frozen there. The supplier’s leg is in the credit account’s own currency.',
        schema: 'ReceiveStock',
      }),
      '/items/{itemId}/issues': movementWrite({
        summary: 'Ship stock without a sale',
        description:
          'Costed from the lots by the item’s method and posted to its cost of goods sold. For stock that is sold, use POST /sales, which posts the revenue beside the cost so the margin exists. Shipping more than is on hand is a 409 insufficient_stock and nothing is written.',
        schema: 'IssueStock',
      }),
      '/items/{itemId}/write-offs': movementWrite({
        summary: 'Write off stock that was not sold',
        description: `Costed from the lots like a sale, and posted to the expense account given rather than cost of sales, so shrinkage stays visible. reason is one of ${WRITE_OFF_REASONS.join(', ')}.`,
        schema: 'WriteOffStock',
      }),
      '/sales': {
        get: {
          tags: ['Sales'],
          summary: 'Recent invoices, newest first',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Invoices, with their lines and margins',
              content: {
                'application/json': {
                  schema: envelope({ type: 'array', items: { $ref: '#/components/schemas/Sale' } }),
                },
              },
            },
            ...problemResponses(400, 429),
          },
        },
        post: {
          tags: ['Sales'],
          summary: 'Invoice a customer and ship the goods',
          description:
            'One entry carries the receivable (in the invoice currency), the revenue and any output tax (in the functional currency) and the cost of goods sold drawn from the lots. Each line’s amount is its net total in the invoice currency, not a unit price; its quantity is to that item’s precision. Two lines of one product draw successive lots. Selling more than is on hand is a 409 insufficient_stock with the figure on hand, and nothing is written. The reference is unique.',
          security: [{ bearerAuth: [] }],
          parameters: [idempotencyHeader],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateSale' } },
            },
          },
          responses: {
            '201': {
              description: 'The sale and the entry it posted',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'object',
                    required: ['sale', 'entry'],
                    properties: {
                      sale: { $ref: '#/components/schemas/Sale' },
                      entry: { $ref: '#/components/schemas/Transaction' },
                    },
                  }),
                },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
          },
        },
      },
      '/sales/{saleId}': {
        get: {
          tags: ['Sales'],
          summary: 'Fetch one invoice with its lines, cost and margin',
          parameters: [{ name: 'saleId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'The invoice',
              content: {
                'application/json': { schema: envelope({ $ref: '#/components/schemas/Sale' }) },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/sales/{saleId}/credit-notes': {
        get: {
          tags: ['Sales'],
          summary: 'The credit notes issued against one invoice',
          parameters: [{ name: 'saleId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Oldest first',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/CreditNote' },
                  }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
        post: {
          tags: ['Sales'],
          summary: 'Take back part of a sale: returned goods, a price allowance, or both',
          description:
            'Each line names an invoice line by its movementId. Returned goods go back into the lots they left from, at the cost they left at. Revenue, output tax and the receivable are credited at the invoice’s own rate, and the tax lands on the return for the month the credit note is dated. Returning more than a line shipped, or crediting more than it charged, is a 409 credit_exceeds_sale with what is left; nothing is written. The final credit against an invoice takes exactly what is left, so a sale credited in instalments ends at zero.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'saleId', in: 'path', required: true, schema: { type: 'string' } },
            idempotencyHeader,
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateCreditNote' } },
            },
          },
          responses: {
            '201': {
              description: 'The credit note and the entry it posted',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'object',
                    required: ['creditNote', 'entry'],
                    properties: {
                      creditNote: { $ref: '#/components/schemas/CreditNote' },
                      entry: { $ref: '#/components/schemas/Transaction' },
                    },
                  }),
                },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
          },
        },
      },
      '/credit-notes': {
        get: {
          tags: ['Sales'],
          summary: 'Recent credit notes, newest first',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Credit notes, with their lines',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/CreditNote' },
                  }),
                },
              },
            },
            ...problemResponses(400, 429),
          },
        },
      },
      '/credit-notes/{creditNoteId}': {
        get: {
          tags: ['Sales'],
          summary: 'Fetch one credit note',
          parameters: [
            { name: 'creditNoteId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'The credit note',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/CreditNote' }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/items/{itemId}/supplier-returns': {
        get: {
          tags: ['Stock'],
          summary: 'What went back to suppliers from one product',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Newest first',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/SupplierReturn' },
                  }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
        post: {
          tags: ['Stock'],
          summary: 'Send part of a delivery back to the supplier',
          description:
            'The goods leave the named lot at what it carries them at, landed cost included. The supplier’s account comes down by the refund — its own price for the goods unless refund says otherwise — at the rate the delivery was bought at. Landed cost the refund does not cover goes to expenseAccountId, or the product’s cost of sales. With taxCodeId, the input tax on the refund is reversed and lands on the return for the month of the return; only for a delivery bought in the functional currency. More than is left of the lot is a 409 supplier_return_exceeds_lot; a refund above what was paid for the delivery is a 409 supplier_refund_exceeds_lot. Nothing is written either way.',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
            idempotencyHeader,
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateSupplierReturn' },
              },
            },
          },
          responses: {
            '201': {
              description: 'The return and the entry it posted',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'object',
                    required: ['supplierReturn', 'entry'],
                    properties: {
                      supplierReturn: { $ref: '#/components/schemas/SupplierReturn' },
                      entry: { $ref: '#/components/schemas/Transaction' },
                    },
                  }),
                },
              },
            },
            '200': { description: 'Idempotent replay of an earlier request' },
            ...problemResponses(400, 401, 404, 409, 422, 429),
          },
        },
      },
      '/supplier-returns': {
        get: {
          tags: ['Stock'],
          summary: 'Recent returns to suppliers, newest first',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            '200': {
              description: 'Returns to suppliers',
              content: {
                'application/json': {
                  schema: envelope({
                    type: 'array',
                    items: { $ref: '#/components/schemas/SupplierReturn' },
                  }),
                },
              },
            },
            ...problemResponses(400, 429),
          },
        },
      },
      '/supplier-returns/{supplierReturnId}': {
        get: {
          tags: ['Stock'],
          summary: 'Fetch one return to a supplier',
          parameters: [
            { name: 'supplierReturnId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'The return',
              content: {
                'application/json': {
                  schema: envelope({ $ref: '#/components/schemas/SupplierReturn' }),
                },
              },
            },
            ...problemResponses(404, 429),
          },
        },
      },
      '/reports/gross-margin': {
        get: {
          tags: ['Reports', 'Sales'],
          summary: 'Revenue, cost and margin by product and by customer',
          description:
            'Over [from, to): to is exclusive, so consecutive periods tile. With neither, the current calendar month; with one, the other is the edge of the month it falls in. Everything is in the functional currency — revenue at each invoice’s rate, cost at each lot’s. Freight and duty that arrived after the goods were sold appear per product as lateCharges.',
          parameters: [
            {
              name: 'from',
              in: 'query',
              required: false,
              description: 'First day included, YYYY-MM-DD.',
              schema: { type: 'string', format: 'date' },
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              description: 'First day excluded, YYYY-MM-DD.',
              schema: { type: 'string', format: 'date' },
            },
          ],
          responses: {
            '200': { description: 'byItem, byCustomer and a total' },
            ...problemResponses(400, 429),
          },
        },
      },
      '/reports/stock-reconciliation': {
        get: {
          tags: ['Reports', 'Stock'],
          summary: 'Each inventory account against the lots behind it',
          description:
            'difference is ledger less lots, and zero is the only healthy value. A difference comes from an entry that moved the account without moving a lot — a hand-typed journal line — and those entries are listed under unexplained. meta.agrees is false if any account disagrees.',
          responses: {
            '200': { description: 'One row per inventory account' },
            ...problemResponses(429),
          },
        },
      },
    },
  };
}

/** Receipts, issues and write-offs answer alike: the movement and the entry it posted. */
function movementWrite(operation: {
  summary: string;
  description: string;
  schema: string;
}): Record<string, unknown> {
  return {
    post: {
      tags: ['Stock'],
      summary: operation.summary,
      description: operation.description,
      security: [{ bearerAuth: [] }],
      parameters: [itemIdParameter, idempotencyHeader],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${operation.schema}` } },
        },
      },
      responses: {
        '201': {
          description: 'The movement, and the entry it posted. Location names the entry.',
          content: {
            'application/json': {
              schema: envelope({
                type: 'object',
                required: ['movement', 'entry'],
                properties: {
                  movement: { $ref: '#/components/schemas/Movement' },
                  entry: { $ref: '#/components/schemas/Transaction' },
                },
              }),
            },
          },
        },
        '200': { description: 'Idempotent replay of an earlier request' },
        ...problemResponses(400, 401, 404, 409, 422, 429),
      },
    },
  };
}

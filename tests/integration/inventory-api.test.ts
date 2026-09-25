import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../helpers/database';
import { setDatabaseForTesting } from '@/server/db/client';
import { resetRateLimits } from '@/server/http/rate-limit';
import { apiKeys, organizations } from '@/server/db/schema';
import { digestToken } from '@/server/services/authentication';
import { newId } from '@/lib/id';
import { POST as createAccount } from '@/app/api/v1/accounts/route';
import { GET as getAccount } from '@/app/api/v1/accounts/[accountId]/route';
import { GET as listItems, POST as createItem } from '@/app/api/v1/items/route';
import { GET as getItem } from '@/app/api/v1/items/[itemId]/route';
import { POST as receive } from '@/app/api/v1/items/[itemId]/receipts/route';
import { POST as issue } from '@/app/api/v1/items/[itemId]/issues/route';
import { POST as writeOff } from '@/app/api/v1/items/[itemId]/write-offs/route';
import { GET as listSales, POST as sell } from '@/app/api/v1/sales/route';
import { GET as getSale } from '@/app/api/v1/sales/[saleId]/route';
import { GET as grossMargin } from '@/app/api/v1/reports/gross-margin/route';
import { GET as stockReconciliation } from '@/app/api/v1/reports/stock-reconciliation/route';

/**
 * Stock and sales over HTTP, against a real Postgres.
 *
 * The services have their own suites; what is proved here is the transport:
 * that a quantity is scaled by *its item's* precision and refused rather than
 * rounded, that a refusal from the yard arrives as the ordinary problem
 * document, that writes need a key, and that an idempotent retry of a sale
 * replays rather than shipping the goods twice.
 */

const TOKEN = 'test-token';
const noParams = { params: Promise.resolve({} as Record<string, never>) };
const itemParams = (itemId: string) => ({ params: Promise.resolve({ itemId }) });

type Money = { amount: string; minorUnits: string; currency: string };
type Problem = { type: string; status: number; code?: string; detail: string };

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ledger.test${path}`, init);
}

function authed(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return request(path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('stock and sales API', () => {
  let db: TestDatabase;
  let accounts: Record<
    'stock' | 'cogs' | 'payable' | 'customer' | 'revenue' | 'breakage',
    { id: string }
  >;
  let pavers: string;
  let tiles: string;

  async function openAccount(name: string, type: string, overdraftAllowed = false) {
    const response = await createAccount(
      authed('/api/v1/accounts', { name, type, currency: 'USD', overdraftAllowed }),
      noParams,
    );
    expect(response.status).toBe(201);
    return (await body<{ data: { id: string } }>(response)).data;
  }

  async function addItem(sku: string, unit: string): Promise<string> {
    const response = await createItem(
      authed('/api/v1/items', {
        sku,
        name: sku,
        unit,
        inventoryAccountId: accounts.stock.id,
        cogsAccountId: accounts.cogs.id,
      }),
      noParams,
    );
    expect(response.status).toBe(201);
    return (await body<{ data: { id: string } }>(response)).data.id;
  }

  async function book(itemId: string, quantity: string, cost: string, day: string) {
    const response = await receive(
      authed(`/api/v1/items/${itemId}/receipts`, {
        quantity,
        cost,
        currency: 'USD',
        creditAccountId: accounts.payable.id,
        occurredAt: `${day}T09:00:00Z`,
        reference: `CONT-${day}`,
      }),
      itemParams(itemId),
    );
    expect(response.status).toBe(201);
    return response;
  }

  function sale(overrides: Record<string, unknown> = {}) {
    return {
      reference: 'INV-1',
      customerAccountId: accounts.customer.id,
      revenueAccountId: accounts.revenue.id,
      currency: 'USD',
      occurredAt: '2026-03-10T10:00:00Z',
      dueOn: '2026-04-09',
      lines: [
        { itemId: pavers, quantity: '120.50', amount: '3615.00' },
        { itemId: tiles, quantity: '5', amount: '100.00' },
      ],
      ...overrides,
    };
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    setDatabaseForTesting(db);
    resetRateLimits();
    await db.update(organizations).set({ isDemo: true }).where(eq(organizations.id, db.$orgId));
    await db.insert(apiKeys).values({
      id: newId('apiKey'),
      orgId: db.$orgId,
      name: 'test key',
      tokenDigest: digestToken(TOKEN),
      tokenPrefix: TOKEN.slice(0, 6),
    });

    accounts = {
      stock: await openAccount('Inventory', 'asset'),
      cogs: await openAccount('Cost of goods sold', 'expense'),
      payable: await openAccount('Payable to quarry', 'liability', true),
      customer: await openAccount('Receivable from builder', 'asset'),
      revenue: await openAccount('Sales', 'revenue', true),
      breakage: await openAccount('Breakage', 'expense'),
    };

    // Measured to two places and counted whole: the precision that decides
    // whether "1.5" is a quantity is the item's, not the request's.
    pavers = await addItem('PAV-400', 'm2');
    tiles = await addItem('TIL-600', 'piece');

    // Two containers of pavers at two prices, so FIFO has a choice to get right.
    await book(pavers, '100.00', '2000.00', '2026-03-02');
    await book(pavers, '100.00', '2500.00', '2026-03-03');
    await book(tiles, '50', '500.00', '2026-03-03');
  });

  afterEach(async () => {
    setDatabaseForTesting(undefined);
    await db.$close();
  });

  it('sells two lines and the margin report agrees with the invoice and the ledger', async () => {
    const response = await sell(authed('/api/v1/sales', sale()), noParams);
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toMatch(/^\/api\/v1\/sales\/sale_/u);

    const created = await body<{
      data: {
        sale: {
          id: string;
          revenue: Money;
          cost: Money;
          margin: Money;
          lines: { sku: string; quantity: string; quantityMinor: string; cost: Money }[];
        };
        entry: { id: string };
      };
    }>(response);
    const { sale: invoice } = created.data;

    // 100 m² from the first container at 20, then 20.5 from the second at 25.
    expect(invoice.lines.map((line) => [line.sku, line.quantity, line.cost.amount])).toEqual([
      ['PAV-400', '120.50', '2512.50'],
      ['TIL-600', '5', '50.00'],
    ]);
    expect(invoice.lines[0]?.quantityMinor).toBe('12050');
    expect(invoice.revenue.amount).toBe('3715.00');
    expect(invoice.cost.amount).toBe('2562.50');
    expect(invoice.margin.amount).toBe('1152.50');

    const fetched = await getSale(request(`/api/v1/sales/${invoice.id}`), {
      params: Promise.resolve({ saleId: invoice.id }),
    });
    expect(fetched.status).toBe(200);

    const report = await grossMargin(
      request('/api/v1/reports/gross-margin?from=2026-03-01&to=2026-04-01'),
      noParams,
    );
    expect(report.status).toBe(200);
    const margins = await body<{
      data: {
        byItem: { sku: string; quantitySold: string; margin: Money }[];
        byCustomer: { accountId: string; invoices: number; margin: Money }[];
        total: { revenue: Money; cost: Money; margin: Money; invoices: number };
      };
    }>(report);

    expect(margins.data.total.revenue.amount).toBe(invoice.revenue.amount);
    expect(margins.data.total.cost.amount).toBe(invoice.cost.amount);
    expect(margins.data.total.margin.amount).toBe(invoice.margin.amount);
    expect(margins.data.total.invoices).toBe(1);
    expect(
      margins.data.byItem.map((row) => [row.sku, row.quantitySold, row.margin.amount]),
    ).toEqual([
      ['PAV-400', '120.50', '1102.50'],
      ['TIL-600', '5', '50.00'],
    ]);
    expect(margins.data.byCustomer).toEqual([
      expect.objectContaining({ accountId: accounts.customer.id, invoices: 1 }),
    ]);

    // And the report is the ledger's figure, not a parallel one.
    const cogs = await body<{ data: { balance: Money } }>(
      await getAccount(request(`/api/v1/accounts/${accounts.cogs.id}`), {
        params: Promise.resolve({ accountId: accounts.cogs.id }),
      }),
    );
    expect(cogs.data.balance.amount).toBe(margins.data.total.cost.amount);

    // The month after has nothing in it: `to` is exclusive.
    const april = await body<{ data: { total: { invoices: number } } }>(
      await grossMargin(request('/api/v1/reports/gross-margin?from=2026-04-01'), noParams),
    );
    expect(april.data.total.invoices).toBe(0);

    const reconciliation = await body<{ meta: { agrees: boolean } }>(
      await stockReconciliation(request('/api/v1/reports/stock-reconciliation'), noParams),
    );
    expect(reconciliation.meta.agrees).toBe(true);
  });

  it('defaults the margin report to the current calendar month', async () => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const report = await body<{ data: { from: string; to: string } }>(
      await grossMargin(request('/api/v1/reports/gross-margin'), noParams),
    );
    expect(report.data.from).toBe(first.toISOString());
    expect(report.data.to).toBe(next.toISOString());
  });

  it('refuses a margin period that ends before it starts', async () => {
    const response = await grossMargin(
      request('/api/v1/reports/gross-margin?from=2026-04-01&to=2026-03-01'),
      noParams,
    );
    expect(response.status).toBe(400);
  });

  it('answers a sale larger than the stock with a 409 insufficient_stock problem', async () => {
    const response = await sell(
      authed(
        '/api/v1/sales',
        sale({ lines: [{ itemId: tiles, quantity: '51', amount: '1020.00' }] }),
      ),
      noParams,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    const problem = await body<Problem & { available: string; requested: string }>(response);
    expect(problem.code).toBe('insufficient_stock');
    expect(problem.type).toContain('insufficient-stock');
    expect(problem).toMatchObject({ available: '50', requested: '51' });

    const sales = await body<{ data: unknown[] }>(
      await listSales(request('/api/v1/sales'), noParams),
    );
    expect(sales.data).toHaveLength(0);
  });

  it('refuses a quantity with more decimals than the item is counted to, as a 422', async () => {
    // Two places is fine for pavers; three is not.
    const tooFine = await sell(
      authed(
        '/api/v1/sales',
        sale({ lines: [{ itemId: pavers, quantity: '1.005', amount: '30.00' }] }),
      ),
      noParams,
    );
    expect(tooFine.status).toBe(422);
    expect(tooFine.headers.get('content-type')).toContain('application/problem+json');
    expect(await body<Problem>(tooFine)).toMatchObject({
      type: expect.stringContaining('unprocessable-quantity') as unknown,
      field: 'lines.0.quantity',
      precision: 2,
    });

    // Half a tile, on the receipt route this time.
    const halfTile = await receive(
      authed(`/api/v1/items/${tiles}/receipts`, {
        quantity: '1.5',
        cost: '15.00',
        currency: 'USD',
        creditAccountId: accounts.payable.id,
      }),
      itemParams(tiles),
    );
    expect(halfTile.status).toBe(422);
    expect(await body<Problem>(halfTile)).toMatchObject({ precision: 0, unit: 'piece' });

    // Nor is a zero quantity, which the database would otherwise refuse as a 500.
    const nothing = await issue(
      authed(`/api/v1/items/${tiles}/issues`, { quantity: '0' }),
      itemParams(tiles),
    );
    expect(nothing.status).toBe(422);
  });

  it('refuses an amount with more decimals than the invoice currency has', async () => {
    const response = await sell(
      authed(
        '/api/v1/sales',
        sale({ lines: [{ itemId: tiles, quantity: '1', amount: '20.005' }] }),
      ),
      noParams,
    );
    expect(response.status).toBe(422);
    expect(await body<Problem>(response)).toMatchObject({ field: 'lines.0.amount' });
  });

  it('requires a bearer token to write', async () => {
    for (const [handler, path, params] of [
      [sell, '/api/v1/sales', noParams],
      [createItem, '/api/v1/items', noParams],
      [receive, `/api/v1/items/${tiles}/receipts`, itemParams(tiles)],
      [issue, `/api/v1/items/${tiles}/issues`, itemParams(tiles)],
      [writeOff, `/api/v1/items/${tiles}/write-offs`, itemParams(tiles)],
    ] as const) {
      const response = await (
        handler as (request: Request, context: typeof params) => Promise<Response>
      )(
        request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sale()),
        }),
        params,
      );
      expect(response.status, path).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    }

    // Reads stay open, as every other read on this deployment does.
    expect((await listItems(request('/api/v1/items'), noParams)).status).toBe(200);
  });

  it('replays an idempotent retry of a sale instead of selling twice', async () => {
    const key = { 'idempotency-key': 'sale-INV-1-attempt' };

    const first = await sell(authed('/api/v1/sales', sale(), key), noParams);
    expect(first.status).toBe(201);
    const original = await body<{ data: { sale: { id: string }; entry: { id: string } } }>(first);

    const retry = await sell(authed('/api/v1/sales', sale(), key), noParams);
    expect(retry.status).toBe(200);
    expect(retry.headers.get('idempotent-replay')).toBe('true');
    expect(retry.headers.get('location')).toBe(`/api/v1/sales/${original.data.sale.id}`);
    const replayed = await body<typeof original>(retry);
    expect(replayed.data.sale.id).toBe(original.data.sale.id);
    expect(replayed.data.entry.id).toBe(original.data.entry.id);

    const sales = await body<{ data: unknown[] }>(
      await listSales(request('/api/v1/sales'), noParams),
    );
    expect(sales.data).toHaveLength(1);

    // The stock left once: 50 tiles less the 5 sold.
    const item = await body<{ data: { onHand: string } }>(
      await getItem(request(`/api/v1/items/${tiles}`), itemParams(tiles)),
    );
    expect(item.data.onHand).toBe('45');

    // The same key on a different request is a client bug, and says so.
    const reused = await sell(authed('/api/v1/sales', sale({ reference: 'INV-2' }), key), noParams);
    expect(reused.status).toBe(409);
    expect((await body<Problem>(reused)).code).toBe('idempotency_key_reused');
  });

  it('does not remember a refusal, so a corrected retry with the same key succeeds', async () => {
    const key = { 'idempotency-key': 'sale-too-early' };
    const big = sale({ lines: [{ itemId: tiles, quantity: '60', amount: '1200.00' }] });

    expect((await sell(authed('/api/v1/sales', big, key), noParams)).status).toBe(409);
    await book(tiles, '10', '100.00', '2026-03-04');
    expect((await sell(authed('/api/v1/sales', big, key), noParams)).status).toBe(201);
  });

  it('shows an item with its lots and movements, as decimals and scaled integers', async () => {
    const response = await getItem(request(`/api/v1/items/${pavers}`), itemParams(pavers));
    expect(response.status).toBe(200);
    const item = await body<{
      data: {
        onHand: string;
        onHandMinor: string;
        value: Money;
        layers: { reference: string; remainingQuantity: string }[];
        movements: { kind: string; quantity: string }[];
      };
    }>(response);

    expect(item.data.onHand).toBe('200.00');
    expect(item.data.onHandMinor).toBe('20000');
    expect(item.data.value.amount).toBe('4500.00');
    expect(item.data.layers.map((layer) => layer.reference)).toEqual([
      'CONT-2026-03-02',
      'CONT-2026-03-03',
    ]);
    expect(item.data.movements).toHaveLength(2);
    expect(item.data.movements[0]).toMatchObject({ kind: 'receipt', quantity: '100.00' });

    const missing = await getItem(
      request('/api/v1/items/item_missing'),
      itemParams('item_missing'),
    );
    expect(missing.status).toBe(404);
    expect((await body<Problem>(missing)).code).toBe('item_not_found');
  });

  it('writes off and issues stock, costed from the oldest lot', async () => {
    const written = await writeOff(
      authed(`/api/v1/items/${pavers}/write-offs`, {
        quantity: '2.25',
        reason: 'damaged',
        expenseAccountId: accounts.breakage.id,
        reference: 'DMG-7',
      }),
      itemParams(pavers),
    );
    expect(written.status).toBe(201);
    expect(written.headers.get('location')).toMatch(/^\/api\/v1\/entries\/txn_/u);
    const off = await body<{
      data: { movement: { kind: string; reason: string; quantity: string; cost: Money } };
    }>(written);
    expect(off.data.movement).toMatchObject({
      kind: 'writeoff',
      reason: 'damaged',
      quantity: '2.25',
    });
    expect(off.data.movement.cost.amount).toBe('45.00');

    const shipped = await issue(
      authed(`/api/v1/items/${pavers}/issues`, { quantity: '1', reference: 'SAMPLE' }),
      itemParams(pavers),
    );
    expect(shipped.status).toBe(201);

    const unknownReason = await writeOff(
      authed(`/api/v1/items/${pavers}/write-offs`, {
        quantity: '1',
        reason: 'stolen by pixies',
        expenseAccountId: accounts.breakage.id,
      }),
      itemParams(pavers),
    );
    expect(unknownReason.status).toBe(400);
  });

  it('creates an item once under an idempotency key', async () => {
    const payload = {
      sku: 'SLAB-1',
      name: 'Granite slab',
      unit: 'slab',
      inventoryAccountId: accounts.stock.id,
      cogsAccountId: accounts.cogs.id,
    };
    const key = { 'idempotency-key': 'item-slab-1' };

    const first = await createItem(authed('/api/v1/items', payload, key), noParams);
    const second = await createItem(authed('/api/v1/items', payload, key), noParams);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);

    // Without the key the retry is the duplicate-SKU conflict the key spares a client.
    const third = await createItem(authed('/api/v1/items', payload), noParams);
    expect(third.status).toBe(409);
    expect((await body<Problem>(third)).code).toBe('sku_taken');
  });
});

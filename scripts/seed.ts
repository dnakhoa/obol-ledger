import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/server/db/schema';
import { createAccountService } from '../src/server/services/accounts';
import { createInventoryService } from '../src/server/services/inventory';
import { createLandedCostService } from '../src/server/services/landed-cost';
import { digestToken } from '../src/server/services/authentication';
import { newId } from '../src/lib/id';
import { createJournalService } from '../src/server/services/journal';
import { createRateService } from '../src/server/services/rates';
import { minorUnits, type MinorUnits } from '../src/lib/money';
import type { Database } from '../src/server/db/types';
import { checkTenantPolicies, TENANT_TABLE_COUNT, withTenant } from '../src/server/db/tenancy';
import type { AccountType } from '../src/server/domain/account';
import { describeTarget, schemaConnectionString, sslFor } from './connection';

/**
 * Seeds a quarter's books for a Vietnamese stone exporter.
 *
 * Deliberately not random noise, and deliberately not a generic shop. It is a
 * granite and basalt producer in Bình Định: blocks come out of a quarry, a
 * factory cuts and finishes them, and containers of pavers and kerbstones
 * leave for buyers in Europe and Australia who pay in euros and dollars, sixty
 * days later, while the books are kept in dong.
 *
 * That business is chosen because it exercises everything this ledger claims
 * to do, in the order a real month does it:
 *
 *  - a **statutory chart** (Thông tư 200), because a Vietnamese company's
 *    accountant does not get to invent account codes
 *  - **entries that cross currencies**, because an export invoice is in euros
 *    and the books are not
 *  - **realized** exchange differences, when a customer pays at a rate that
 *    is not the one you invoiced at
 *  - **unrealized** ones, on the invoices they have not paid yet
 *  - a **pending** entry, for a container that has left the factory and not
 *    yet cleared customs
 *  - a **period close**, which refuses until the foreign balances have been
 *    retranslated
 *
 * Every figure on screen is the result of the same code path the API uses.
 */

type Seeded = Record<string, string>;

/*
 * The demo roastery's chart, numbered in the AU/NZ convention.
 *
 * 100s assets, 200s liabilities, 300s equity, 400s revenue, 500s expenses,
 * with gaps of ten — the scheme Xero teaches, and the one the primary market
 * reads. Codes are what an accountant files by, and a demo that sorted
 * alphabetically was showing them a chart nobody keeps.
 */
/*
 * The chart, in Thông tư 200 codes.
 *
 * Level-two codes where the model needs one account per currency: TT200 keeps
 * a single 112 for bank deposits and distinguishes currency in a sub-account,
 * and this ledger holds one currency per account — so 1121 is the dong
 * account and 1122 the dollar one, which is how the circular numbers them
 * anyway.
 *
 * `monetary` is the IAS 21 distinction and the reason it is stated per
 * account: 152 and 155 are stone, bought at a rate and carried at it forever,
 * while 1311 is a dollar invoice that is worth a different number of dong
 * every month end. One export sale creates both.
 */
const ACCOUNTS: {
  key: string;
  code: string;
  name: string;
  type: AccountType;
  currency: 'VND' | 'USD' | 'EUR' | 'AUD';
  overdraft?: boolean;
  monetary?: boolean;
  openItems?: boolean;
  role?: 'retained_earnings' | 'fx_gain_loss';
}[] = [
  { key: 'cash', code: '111', name: 'Tiền mặt', type: 'asset', currency: 'VND' },
  {
    key: 'bankVnd',
    code: '1121',
    name: 'Tiền gửi ngân hàng — VND',
    type: 'asset',
    currency: 'VND',
  },
  {
    key: 'bankUsd',
    code: '1122',
    name: 'Tiền gửi ngân hàng — USD',
    type: 'asset',
    currency: 'USD',
    overdraft: true,
  },
  {
    key: 'arUsd',
    // A claim on somebody, so it is managed as open items and ages.
    openItems: true,
    code: '1311',
    name: 'Phải thu của khách hàng — USD',
    type: 'asset',
    currency: 'USD',
    overdraft: true,
  },
  {
    key: 'arEur',
    // A claim on somebody, so it is managed as open items and ages.
    openItems: true,
    code: '1312',
    name: 'Phải thu của khách hàng — EUR',
    type: 'asset',
    currency: 'EUR',
    overdraft: true,
  },
  {
    key: 'arAud',
    // A claim on somebody, so it is managed as open items and ages.
    openItems: true,
    code: '1313',
    name: 'Phải thu của khách hàng — AUD',
    type: 'asset',
    currency: 'AUD',
    overdraft: true,
  },
  {
    key: 'vatIn',
    code: '133',
    name: 'Thuế GTGT được khấu trừ',
    type: 'asset',
    currency: 'VND',
  },
  {
    key: 'blocks',
    code: '152',
    name: 'Nguyên vật liệu — đá khối',
    type: 'asset',
    currency: 'VND',
    monetary: false,
  },
  {
    key: 'wip',
    code: '154',
    name: 'Chi phí sản xuất dở dang',
    type: 'asset',
    currency: 'VND',
    monetary: false,
  },
  {
    key: 'finished',
    code: '155',
    name: 'Thành phẩm — đá đã gia công',
    type: 'asset',
    currency: 'VND',
    monetary: false,
  },
  {
    key: 'plant',
    code: '211',
    name: 'TSCĐ hữu hình — máy cắt, máy mài',
    type: 'asset',
    currency: 'VND',
    monetary: false,
  },
  {
    key: 'depreciation',
    code: '214',
    name: 'Hao mòn tài sản cố định',
    type: 'asset',
    currency: 'VND',
    overdraft: true,
    monetary: false,
  },
  {
    key: 'payable',
    // A claim on somebody, so it is managed as open items and ages.
    openItems: true,
    code: '331',
    name: 'Phải trả cho người bán',
    type: 'liability',
    currency: 'VND',
    overdraft: true,
  },
  {
    key: 'taxes',
    code: '333',
    name: 'Thuế và các khoản phải nộp Nhà nước',
    type: 'liability',
    currency: 'VND',
    overdraft: true,
  },
  {
    key: 'payroll',
    code: '334',
    name: 'Phải trả người lao động',
    type: 'liability',
    currency: 'VND',
    overdraft: true,
  },
  {
    key: 'capital',
    code: '411',
    name: 'Vốn đầu tư của chủ sở hữu',
    type: 'equity',
    currency: 'VND',
    overdraft: true,
  },
  {
    key: 'retained',
    code: '421',
    name: 'Lợi nhuận sau thuế chưa phân phối',
    type: 'equity',
    currency: 'VND',
    overdraft: true,
    role: 'retained_earnings',
  },
  {
    key: 'revenue',
    code: '511',
    name: 'Doanh thu bán hàng và cung cấp dịch vụ',
    type: 'revenue',
    currency: 'VND',
    overdraft: true,
  },
  {
    key: 'finIncome',
    code: '515',
    name: 'Doanh thu hoạt động tài chính',
    type: 'revenue',
    currency: 'VND',
    overdraft: true,
  },
  { key: 'cogs', code: '632', name: 'Giá vốn hàng bán', type: 'expense', currency: 'VND' },
  {
    key: 'finExpense',
    code: '635',
    name: 'Chi phí tài chính',
    type: 'expense',
    currency: 'VND',
    overdraft: true,
    role: 'fx_gain_loss',
  },
  {
    key: 'selling',
    code: '641',
    name: 'Chi phí bán hàng — cước tàu, hải quan',
    type: 'expense',
    currency: 'VND',
  },
  {
    key: 'admin',
    code: '642',
    name: 'Chi phí quản lý doanh nghiệp',
    type: 'expense',
    currency: 'VND',
  },
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What the factory makes, as things with quantities rather than amounts.
 *
 * The demo has always had a finished-goods account; what it has not had is any
 * idea *how much stone* that account represents, which is the number the
 * business actually manages. Unit costs rise across the quarter — deliberately,
 * because that is when the costing method stops being a formality and starts
 * changing the profit.
 */
const PRODUCTS: {
  key: string;
  sku: string;
  name: string;
  unit: 'm2' | 'm3';
  /** Dong per unit on the first production run; later runs cost more. */
  unitCost: number;
}[] = [
  {
    key: 'pavers',
    sku: 'PAV-600',
    name: 'Đá lát granite 600×600',
    unit: 'm2',
    unitCost: 690_000,
  },
  {
    key: 'cladding',
    sku: 'CLD-PNL',
    name: 'Tấm ốp tường bằng đá',
    unit: 'm2',
    unitCost: 845_000,
  },
  {
    key: 'kerbs',
    sku: 'BLK-STR',
    name: 'Đá bậc và bó vỉa',
    unit: 'm3',
    unitCost: 5_600_000,
  },
  // Bought in rather than made. An exporter of its own granite that also
  // imports marble to resell is the ordinary shape of this business, and it
  // is the half of it that has freight and duty attached.
  {
    key: 'marble',
    sku: 'MRB-CAR',
    name: 'Đá marble trắng Carrara',
    unit: 'm2',
    unitCost: 1_850_000,
  },
];

/** The three that come off the factory line, as opposed to the one imported. */
const MADE = PRODUCTS.filter((product) => product.key !== 'marble');

const random = mulberry32(20260919);

function between(low: number, high: number): number {
  return Math.floor(random() * (high - low + 1)) + low;
}

/** The last day of a month, `monthsBack` months before this one, as YYYY-MM-DD. */
function monthEnd(monthsBack: number): string {
  const now = new Date();
  // Day 0 of a month is the last day of the one before it.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack + 1, 0));
  return end.toISOString().slice(0, 10);
}

function daysAgo(days: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, between(0, 59), 0, 0);
  return date;
}

async function main(): Promise<void> {
  const url = schemaConnectionString();
  const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });
  console.log(`seeding ${describeTarget(url)}`);
  try {
    const database = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;

    // Seeding is destructive and must be explicit. Postings and entries are
    // append-only by trigger, so the triggers are lifted for the truncate.
    console.log('clearing existing data');
    // TRUNCATE does not fire row-level triggers, so the append-only guards
    // never see it — which is why this is a plain TRUNCATE and not a delete
    // with the triggers lifted. Naming them here would only create a
    // maintenance trap: `transactions_append_only` was replaced by
    // `transactions_guard_mutation` in 0004, and a stale ALTER would fail the
    // seed for a reason that has nothing to do with seeding.
    await database.execute(sql`
      TRUNCATE idempotency_keys, postings, transactions, accounting_periods,
               exchange_rates, accounts, api_keys, memberships, organizations
      RESTART IDENTITY CASCADE
    `);

    const demoSlug = process.env['DEMO_ORG_SLUG'] ?? 'demo';
    const orgId = newId('organization');
    await database
      .insert(schema.organizations)
      // Marked as *the* demo: that column, not the slug, is what makes a
      // ledger readable to a signed-out visitor. A partial unique index
      // allows exactly one, so "the demo" is never ambiguous.
      .values({
        id: orgId,
        name: 'Công ty TNHH Đá Bình Minh',
        slug: demoSlug,
        isDemo: true,
        // The books are kept in dong. Every export invoice is in a currency
        // that is not, which is what makes the balance rule interesting.
        functionalCurrency: 'VND',
        // A Vietnamese company's accountant does not get to invent account
        // codes, so the demo is on the statutory chart rather than a
        // convention — and the database enforces the digit rule.
        chartTemplate: 'vn_tt200',
        locale: 'vi',
      });

    // A second tenant with its own books exists purely so the isolation is
    // real rather than theoretical: there is something on the other side of
    // the policy for it to keep out.
    const otherOrgId = newId('organization');
    await database
      .insert(schema.organizations)
      .values({ id: otherOrgId, name: 'Second Tenant', slug: 'second' });

    // The demo tenant's API key is whatever LEDGER_API_TOKEN is set to, so a
    // deployment's existing credential keeps working and the token still
    // travels through the real api_keys lookup rather than a special case.
    const token = process.env['LEDGER_API_TOKEN'];
    if (token) {
      await database.insert(schema.apiKeys).values({
        id: newId('apiKey'),
        orgId,
        name: 'seeded demo key',
        tokenDigest: digestToken(token),
        // A supplied token is not generated by `issueToken`, so its prefix is
        // taken from the token itself rather than invented.
        tokenPrefix: token.slice(0, 14),
      });
      console.log('registered LEDGER_API_TOKEN as the demo tenant key');
    } else {
      console.log('LEDGER_API_TOKEN not set; no API key registered (reads still work)');
    }

    const accountService = createAccountService(database, orgId);
    const journal = createJournalService(database, orgId);
    const rates = createRateService(database, orgId);

    const ids: Seeded = {};
    for (const account of ACCOUNTS) {
      const created = await accountService.create({
        name: account.name,
        type: account.type,
        currency: account.currency,
        code: account.code,
        overdraftAllowed: account.overdraft ?? false,
        ...(account.monetary === undefined ? {} : { monetary: account.monetary }),
        ...(account.openItems === undefined ? {} : { openItems: account.openItems }),
        ...(account.role ? { role: account.role } : {}),
      });
      ids[account.key] = created.id;
    }
    // Back-date the accounts to just before the first entry.
    //
    // `created_at` defaults to now(), so a freshly seeded ledger claims every
    // account was opened today while showing a statement going back months.
    // Accounts are not append-only — only postings and journal entries are —
    // so this is a plain UPDATE rather than anything that fights a trigger.
    await database.execute(sql`UPDATE accounts SET created_at = now() - interval '110 days'`);
    console.log(`opened ${ACCOUNTS.length} accounts`);

    /*
     * Rates, as the facts they were on the day.
     *
     * Illustrative rather than historical — the point is that they *move*, and
     * that a lookup asks for the most recent rate at or before a date rather
     * than today's. Recorded month by month so a revaluation at the end of one
     * month cannot accidentally use the next month's rate.
     */
    const RATES: { base: 'USD' | 'EUR' | 'AUD'; asOf: string; rate: string }[] = [];
    for (const [monthsBack, usd, eur, aud] of [
      [3, '25380', '27450', '16420'],
      [2, '25510', '27780', '16610'],
      [1, '25640', '28040', '16880'],
      [0, '25705', '28190', '17010'],
    ] as const) {
      const day = monthEnd(monthsBack);
      RATES.push({ base: 'USD', asOf: day, rate: usd });
      RATES.push({ base: 'EUR', asOf: day, rate: eur });
      RATES.push({ base: 'AUD', asOf: day, rate: aud });
    }
    for (const rate of RATES) {
      const recorded = await rates.record({
        base: rate.base,
        quote: 'VND',
        rate: rate.rate,
        asOf: rate.asOf,
        source: 'seed',
      });
      if (!recorded.ok) throw new Error(`rate ${rate.base} ${rate.asOf} rejected`);
    }
    console.log(`recorded ${RATES.length} exchange rates`);

    // Dong has no minor unit, so a "đồng" is already a minor unit. Dollars,
    // euros and Australian dollars have two — which is exactly the rescaling
    // that makes a cross-currency entry interesting.
    const dong = (value: number): MinorUnits => minorUnits(BigInt(Math.round(value)));
    const foreign = (value: number): MinorUnits => minorUnits(BigInt(Math.round(value * 100)));

    const at = (key: string): string => {
      const id = ids[key];
      if (!id) throw new Error(`unknown seed account ${key}`);
      return id;
    };

    let entries = 0;
    type Leg = {
      account: string;
      amount: MinorUnits;
      baseAmount?: MinorUnits;
      fxRate?: string;
    };

    async function post(
      description: string,
      occurredAt: Date,
      legs: Leg[],
      options: {
        status?: 'pending' | 'posted';
        metadata?: Record<string, string>;
        fxAdjustment?: boolean;
      } = {},
    ): Promise<void> {
      const result = await journal.postEntry({
        description,
        currency: 'VND',
        occurredAt,
        status: options.status ?? 'posted',
        metadata: options.metadata ?? {},
        ...(options.fxAdjustment ? { fxAdjustment: true } : {}),
        postings: legs.map((leg) => ({
          accountId: at(leg.account),
          amount: leg.amount,
          ...(leg.baseAmount === undefined ? {} : { baseAmount: leg.baseAmount }),
          ...(leg.fxRate === undefined ? {} : { fxRate: leg.fxRate }),
        })),
      });
      if (!result.ok) {
        throw new Error(`seed entry "${description}" was rejected: ${result.error.code}`);
      }
      entries += 1;
    }

    // ---- Opening the books, before the quarter starts -----------------------
    //
    // A quarry and a factory are capitalised long before the first container
    // ships, and these entries are an order of magnitude larger than a week of
    // trading. Dated well back so they do not flatten the dashboard's chart.

    await post('Góp vốn của chủ sở hữu', daysAgo(104, 9), [
      { account: 'bankVnd', amount: dong(32_000_000_000) },
      { account: 'capital', amount: dong(-32_000_000_000) },
    ]);

    await post('Mua dây chuyền cắt và mài đá', daysAgo(102, 10), [
      { account: 'plant', amount: dong(18_400_000_000) },
      { account: 'payable', amount: dong(-12_000_000_000) },
      { account: 'bankVnd', amount: dong(-6_400_000_000) },
    ]);

    await post('Tồn kho đá khối đầu kỳ', daysAgo(100, 8), [
      { account: 'blocks', amount: dong(4_800_000_000) },
      { account: 'payable', amount: dong(-4_800_000_000) },
    ]);

    // ---- A quarter of quarrying, cutting and exporting ----------------------
    //
    // Production is posted before the shipments that consume it, which is the
    // order the factory actually works in — you cannot ship stone you have not
    // cut. The overdraft rule enforces that: crediting finished goods that do
    // not exist is refused, which is how the seed found out it had the two
    // loops the wrong way round.

    // Stock, as things with quantities.
    //
    // Opened against the same two accounts the hand-posted entries used, so
    // nothing about the chart changes: what changes is that 155 now has a
    // quantity behind it and 632 is derived from the lots rather than from a
    // percentage somebody chose.
    const inventory = createInventoryService(database, orgId);
    const landedCost = createLandedCostService(database, orgId);
    const itemIds: Record<string, string> = {};
    for (const product of PRODUCTS) {
      const created = await inventory.createItem({
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        inventoryAccountId: ids['finished'] ?? '',
        cogsAccountId: ids['cogs'] ?? '',
      });
      if (!created.ok) throw new Error(`could not open ${product.sku}: ${created.error.code}`);
      itemIds[product.key] = created.value.id;
    }
    // Quantities are scaled integers, like money: m² to two places, m³ to three.
    const SCALE: Record<string, bigint> = { m2: 100n, m3: 1000n };
    const produced: Record<string, bigint> = {};
    console.log(`opened ${PRODUCTS.length} stock items`);

    // Quarry blocks bought, and the factory turning them into product.
    for (const [run, day] of [95, 80, 65, 50, 35, 20, 6].entries()) {
      const blocks = between(1_400_000_000, 2_900_000_000);
      await post('Mua đá khối từ mỏ', daysAgo(day, 8), [
        { account: 'blocks', amount: dong(blocks) },
        { account: 'payable', amount: dong(-blocks) },
      ]);

      const processed = Math.round(blocks * 0.94);
      const labour = Math.round(processed * 0.38);
      await post('Xuất đá khối vào sản xuất', daysAgo(day - 1, 8), [
        { account: 'wip', amount: dong(processed) },
        { account: 'blocks', amount: dong(-processed) },
      ]);
      await post('Chi phí nhân công phân xưởng', daysAgo(day - 1, 17), [
        { account: 'wip', amount: dong(labour) },
        { account: 'payroll', amount: dong(-labour) },
      ]);
      // The run comes off the line as a *lot*: a quantity at a price, priced
      // a little higher than the run before it. The entry posted is the one
      // that was posted before — debit 155, credit 154 — but it now opens a
      // cost layer at the same time, in the same transaction, so the stock
      // records and the account cannot come apart.
      const product = MADE[run % MADE.length];
      if (!product) throw new Error('no product for run');
      const cost = processed + labour;
      const perUnit = Math.round(product.unitCost * (0.9 + run * 0.035));
      const quantity = (BigInt(Math.round(cost / perUnit)) * (SCALE[product.unit] ?? 1n)) as never;

      const received = await inventory.receive({
        itemId: itemIds[product.key] ?? '',
        quantity,
        cost: BigInt(cost),
        currency: 'VND',
        creditAccountId: ids['wip'] ?? '',
        occurredAt: daysAgo(day - 2, 16),
        reference: `LOT-${String(run + 1).padStart(3, '0')}`,
        description: 'Nhập kho thành phẩm',
      });
      if (!received.ok) throw new Error(`receipt failed: ${received.error.code}`);
      entries += 1;
      produced[product.key] = (produced[product.key] ?? 0n) + quantity;
    }

    // ---- A container coming the other way -----------------------------------
    //
    // The company exports its own granite and imports marble to resell, which
    // is the ordinary shape of this business and the half that has freight and
    // duty attached. A supplier invoice is not what the stone cost: IAS 2 puts
    // the cost of purchase at the price *plus* import duties and transport.
    //
    // Booking those as expenses would understate the stock and make every
    // subsequent cost of goods sold wrong by the same margin — here, a fifth
    // of the invoice. See docs/adr/0015-landed-cost.md.

    const shipment = await landedCost.record({
      reference: 'CONT-IT-2207',
      arrivedAt: daysAgo(46, 9),
      notes: 'Marble trắng Carrara, nhập từ Ý qua cảng Cát Lái',
    });
    if (!shipment.ok) throw new Error(`shipment failed: ${shipment.error.code}`);

    // 800 m² invoiced at 48,000 USD.
    const marbleQuantity = 800n * (SCALE['m2'] ?? 1n);
    const marbleReceipt = await inventory.receive({
      itemId: itemIds['marble'] ?? '',
      quantity: marbleQuantity as never,
      cost: BigInt(48_000_00),
      currency: 'USD',
      creditAccountId: ids['payable'] ?? '',
      occurredAt: daysAgo(46, 9),
      reference: 'CONT-IT-2207',
      description: 'Nhập khẩu đá marble Carrara',
      shipmentId: shipment.value.id,
      // 24.6 tonnes, so a charge could be spread by weight as well as value.
      weightGrams: 24_600_000n,
    });
    if (!marbleReceipt.ok) throw new Error(`marble receipt failed: ${marbleReceipt.error.code}`);
    entries += 1;
    produced['marble'] = marbleQuantity;

    // Everything else on the customs declaration. Three of these belong in the
    // cost of the stone; the fourth does not, and the difference is the whole
    // point of modelling them separately.
    const CHARGES: {
      kind: 'freight' | 'duty' | 'handling' | 'tax';
      description: string;
      amount: number;
      currency: 'USD' | 'VND';
      capitalise?: boolean;
      debit?: string;
    }[] = [
      {
        kind: 'freight',
        description: 'Cước tàu biển Genoa — Cát Lái',
        amount: 3_400_00,
        currency: 'USD',
      },
      {
        kind: 'duty',
        // Not recoverable, so it is part of what the stone cost.
        description: 'Thuế nhập khẩu 5%',
        amount: 62_000_000,
        currency: 'VND',
      },
      {
        kind: 'handling',
        description: 'Phí dịch vụ hải quan và vận chuyển nội địa',
        amount: 18_400_000,
        currency: 'VND',
      },
      {
        kind: 'tax',
        // Reclaimed from the tax authority, so it never was a cost. IAS 2
        // excludes taxes "subsequently recoverable by the entity" — this is
        // an asset against the state, not part of the marble.
        description: 'Thuế GTGT hàng nhập khẩu 8% (được khấu trừ)',
        amount: 104_000_000,
        currency: 'VND',
        capitalise: false,
        debit: 'vatIn',
      },
    ];

    for (const charge of CHARGES) {
      const applied = await landedCost.addCharge({
        shipmentId: shipment.value.id,
        kind: charge.kind,
        description: charge.description,
        amount: BigInt(charge.amount),
        currency: charge.currency,
        basis: 'value',
        creditAccountId: ids['payable'] ?? '',
        occurredAt: daysAgo(44, 11),
        ...(charge.capitalise === false
          ? { capitalise: false, debitAccountId: ids[charge.debit ?? ''] ?? '' }
          : {}),
      });
      if (!applied.ok) throw new Error(`charge failed (${charge.kind}): ${applied.error.code}`);
      entries += 1;
    }

    const CONTAINERS: {
      day: number;
      currency: 'USD' | 'EUR' | 'AUD';
      account: string;
      /** Which of the three product lines left in this container. */
      item: string;
      /** How much of everything ever made of it — kept as a share so the seed
       * cannot ask for stone it never cut, whatever the random costs came out
       * at. */
      share: number;
      amount: number;
      rate: string;
      buyer: string;
      product: string;
      invoice: string;
    }[] = [
      // Australia and New Zealand are the largest market, so most containers
      // leave in Australian dollars.
      {
        day: 88,
        currency: 'AUD',
        account: 'arAud',
        amount: 58_400,
        rate: '16420',
        buyer: 'Southern Landscape Supplies, Brisbane',
        product: 'Đá lát granite 400×400×30',
        item: 'pavers',
        share: 0.17,
        invoice: 'INV-2601',
      },
      {
        day: 81,
        currency: 'EUR',
        account: 'arEur',
        amount: 41_250,
        rate: '27450',
        buyer: 'Steinhandel Nord, Hamburg',
        product: 'Đá bazan lập phương 100×100×100',
        item: 'kerbs',
        share: 0.15,
        invoice: 'INV-2602',
      },
      {
        day: 74,
        currency: 'AUD',
        account: 'arAud',
        amount: 63_900,
        rate: '16510',
        buyer: 'Kerb & Co, Melbourne',
        product: 'Bó vỉa đá 1000×300×150',
        item: 'kerbs',
        share: 0.16,
        invoice: 'INV-2603',
      },
      {
        day: 66,
        currency: 'USD',
        account: 'arUsd',
        amount: 37_800,
        rate: '25510',
        buyer: 'Pacific Stone Imports, Seattle',
        product: 'Đá lát phiến, bề mặt băm',
        item: 'cladding',
        share: 0.19,
        invoice: 'INV-2604',
      },
      {
        day: 59,
        currency: 'AUD',
        account: 'arAud',
        amount: 71_200,
        rate: '16610',
        buyer: 'Auckland Paving Centre',
        product: 'Đá lát granite 600×300×30',
        item: 'pavers',
        share: 0.18,
        invoice: 'INV-2605',
      },
      {
        day: 52,
        currency: 'EUR',
        account: 'arEur',
        amount: 48_600,
        rate: '27780',
        buyer: 'Pierre Naturelle SA, Lyon',
        product: 'Trụ đá 100×100×1000',
        item: 'kerbs',
        share: 0.14,
        invoice: 'INV-2606',
      },
      {
        day: 44,
        currency: 'AUD',
        account: 'arAud',
        amount: 66_500,
        rate: '16700',
        buyer: 'Southern Landscape Supplies, Brisbane',
        product: 'Tấm ốp tường bằng đá',
        item: 'cladding',
        share: 0.21,
        invoice: 'INV-2607',
      },
      {
        day: 37,
        currency: 'USD',
        account: 'arUsd',
        amount: 44_150,
        rate: '25580',
        buyer: 'Pacific Stone Imports, Seattle',
        product: 'Đá bậc, đục 5 mặt',
        item: 'kerbs',
        share: 0.13,
        invoice: 'INV-2608',
      },
      {
        day: 30,
        currency: 'AUD',
        account: 'arAud',
        amount: 74_800,
        rate: '16780',
        buyer: 'Kerb & Co, Melbourne',
        product: 'Bó vỉa đá, cắt máy',
        item: 'kerbs',
        share: 0.12,
        invoice: 'INV-2609',
      },
      {
        day: 22,
        currency: 'EUR',
        account: 'arEur',
        amount: 52_300,
        rate: '28040',
        buyer: 'Steinhandel Nord, Hamburg',
        product: 'Đá bazan lập phương, mặt chẻ',
        item: 'cladding',
        share: 0.18,
        invoice: 'INV-2610',
      },
      {
        day: 15,
        currency: 'AUD',
        account: 'arAud',
        amount: 69_900,
        rate: '16880',
        buyer: 'Auckland Paving Centre',
        product: 'Bộ đá trang trí sân vườn',
        item: 'pavers',
        share: 0.16,
        invoice: 'INV-2611',
      },
      {
        day: 8,
        currency: 'AUD',
        account: 'arAud',
        amount: 77_400,
        rate: '16950',
        buyer: 'Southern Landscape Supplies, Brisbane',
        product: 'Đá lát granite 450×900×60',
        item: 'pavers',
        share: 0.19,
        invoice: 'INV-2612',
      },
    ];

    for (const container of CONTAINERS) {
      const revenueVnd = Math.round(container.amount * Number(container.rate));

      // The export invoice. One entry, two currencies: the receivable is in
      // the buyer's money and the revenue is in dong, at the rate on the day.
      await post(
        `Xuất khẩu — ${container.product} → ${container.buyer}`,
        daysAgo(container.day, 10),
        [
          {
            account: container.account,
            amount: foreign(container.amount),
            fxRate: container.rate,
          },
          { account: 'revenue', amount: dong(-revenueVnd) },
        ],
        { metadata: { invoice: container.invoice, market: container.currency } },
      );

      // The cost of the stone that left — worked out from the lots it came
      // out of rather than from a percentage of the sale.
      //
      // This is the substance of the change. The old line took 52% of revenue,
      // which is a number nobody could check and which quietly made every
      // container equally profitable. Now the earliest lots go first, the
      // later ones cost more, and the margin on each container differs because
      // the stone in it genuinely did.
      const shipped =
        ((produced[container.item] ?? 0n) * BigInt(Math.round(container.share * 1000))) / 1000n;
      const issued = await inventory.issue({
        itemId: itemIds[container.item] ?? '',
        quantity: shipped as never,
        occurredAt: daysAgo(container.day, 10),
        reference: container.invoice,
        description: `Giá vốn — ${container.invoice}`,
      });
      if (!issued.ok)
        throw new Error(`issue failed for ${container.invoice}: ${issued.error.code}`);
      entries += 1;

      // Freight and customs, paid in dong to a local forwarder.
      const freight = between(48_000_000, 96_000_000);
      await post(`Cước tàu và thông quan — ${container.invoice}`, daysAgo(container.day - 1, 15), [
        { account: 'selling', amount: dong(freight) },
        { account: 'bankVnd', amount: dong(-freight) },
      ]);
    }

    // ---- Customers paying, at a rate that is never the invoiced one ---------
    //
    // This is the entry an exporter feels. The invoice was raised at one rate
    // and the money arrives at another, and the difference is real income or
    // expense rather than a rounding artefact. `fxAdjustment` books it — and
    // only because each currency balances on its own, which is what stops the
    // adjustment hiding a mistyped amount.

    const COLLECTIONS: {
      day: number;
      from: string;
      amount: number;
      invoicedAt: string;
      paidAt: string;
      invoice: string;
    }[] = [
      {
        day: 28,
        from: 'arAud',
        amount: 58_400,
        invoicedAt: '16420',
        paidAt: '16735',
        invoice: 'INV-2601',
      },
      {
        day: 21,
        from: 'arEur',
        amount: 41_250,
        invoicedAt: '27450',
        paidAt: '27960',
        invoice: 'INV-2602',
      },
      {
        day: 14,
        from: 'arAud',
        amount: 63_900,
        invoicedAt: '16510',
        paidAt: '16820',
        invoice: 'INV-2603',
      },
      {
        day: 9,
        from: 'arUsd',
        amount: 37_800,
        invoicedAt: '25510',
        paidAt: '25655',
        invoice: 'INV-2604',
      },
      {
        day: 4,
        from: 'arAud',
        amount: 71_200,
        invoicedAt: '16610',
        paidAt: '16940',
        invoice: 'INV-2605',
      },
    ];

    for (const payment of COLLECTIONS) {
      const bank = payment.from === 'arUsd' ? 'bankUsd' : payment.from;
      const invoicedVnd = Math.round(payment.amount * Number(payment.invoicedAt));
      const receivedVnd = Math.round(payment.amount * Number(payment.paidAt));

      if (bank === 'bankUsd') {
        // Dollars land in the dollar account: the currency does not change,
        // only what it is worth.
        await post(
          `Khách hàng thanh toán — ${payment.invoice}`,
          daysAgo(payment.day, 11),
          [
            { account: 'bankUsd', amount: foreign(payment.amount), baseAmount: dong(receivedVnd) },
            {
              account: payment.from,
              amount: foreign(-payment.amount),
              baseAmount: dong(-invoicedVnd),
            },
          ],
          { fxAdjustment: true, metadata: { invoice: payment.invoice } },
        );
      } else {
        /*
         * Converted to dong on arrival, which is what most exporters do with
         * euros and Australian dollars — and this one states the difference
         * explicitly rather than letting `fxAdjustment` find it.
         *
         * That is not a style choice. The automatic adjustment is only
         * allowed when the entry already balances *within every transaction
         * currency*, which is what stops it swallowing a mistyped amount.
         * A conversion does not: Australian dollars go out and dong come in,
         * so no currency nets to zero on its own and the guard refuses. The
         * same-currency settlement above is exactly the case it does cover.
         */
        const difference = receivedVnd - invoicedVnd;
        await post(
          `Khách hàng thanh toán — ${payment.invoice}`,
          daysAgo(payment.day, 11),
          [
            { account: 'bankVnd', amount: dong(receivedVnd) },
            {
              account: payment.from,
              amount: foreign(-payment.amount),
              baseAmount: dong(-invoicedVnd),
            },
            // A weakening dong makes a foreign receivable worth more of it,
            // so these are gains — 515, doanh thu hoạt động tài chính.
            { account: 'finIncome', amount: dong(-difference) },
          ],
          { metadata: { invoice: payment.invoice } },
        );
      }
    }

    // ---- The rest of running a factory -------------------------------------

    for (const day of [90, 60, 30]) {
      const wages = between(1_900_000_000, 2_400_000_000);
      await post('Thanh toán lương cho người lao động', daysAgo(day, 9), [
        { account: 'payroll', amount: dong(wages) },
        { account: 'bankVnd', amount: dong(-wages) },
      ]);

      const admin = between(320_000_000, 520_000_000);
      await post('Chi phí quản lý doanh nghiệp', daysAgo(day, 14), [
        { account: 'admin', amount: dong(admin) },
        { account: 'bankVnd', amount: dong(-admin) },
      ]);

      const supplier = between(2_100_000_000, 3_600_000_000);
      await post('Thanh toán cho nhà cung cấp', daysAgo(day - 3, 11), [
        { account: 'payable', amount: dong(supplier) },
        { account: 'bankVnd', amount: dong(-supplier) },
      ]);

      const depreciation = 306_000_000;
      await post('Trích khấu hao tài sản cố định', daysAgo(day, 17), [
        { account: 'admin', amount: dong(depreciation) },
        { account: 'depreciation', amount: dong(-depreciation) },
      ]);
    }

    // ---- A container that has left and not yet cleared ----------------------
    //
    // The state a single-balance ledger cannot hold: the stone is on a ship,
    // the invoice is raised, and nothing has settled. It reserves the value
    // without moving it, so the receivable's posted and available balances
    // differ — which is the whole point of the two-phase model.

    await post(
      'Container đã xuất, chờ vận đơn',
      daysAgo(1, 16),
      [
        { account: 'arAud', amount: foreign(54_600), fxRate: '17010' },
        { account: 'revenue', amount: dong(-Math.round(54_600 * 17_010)) },
      ],
      { status: 'pending', metadata: { invoice: 'INV-2613', market: 'AUD' } },
    );

    // Assert the *schema* carries the isolation policies.
    //
    // Deliberately not "does an unscoped read return nothing". Seeding is an
    // administrative task and runs as a privileged role, which bypasses
    // row-level security by design — so that check fails on exactly the
    // connections that are supposed to bypass it. What a migration can
    // meaningfully verify is that the policies exist and are forced; whether a
    // given connection is subject to them depends on its role, and that is the
    // application's question, answered by /api/v1/health.
    const policies = await checkTenantPolicies(database);
    if (!policies.configured) {
      throw new Error(
        `tenant isolation is not configured: ${policies.tablesWithRls}/${TENANT_TABLE_COUNT} tables with RLS, ` +
          `${policies.tablesForced}/${TENANT_TABLE_COUNT} forced, ${policies.policies} policies`,
      );
    }
    console.log(
      `tenant isolation: ${policies.tablesForced}/${TENANT_TABLE_COUNT} tables forced, ${policies.policies} policies`,
    );

    // The seed asserts its own output: if the books do not balance, the script
    // fails rather than leaving a broken ledger behind for the UI to render.

    const residual = await withTenant(database, orgId, async (tx) => {
      const [row] = await tx
        // Summed in the *functional* currency.
        //
        // `balance_minor` is in each account's own currency, so adding a
        // dollar balance to a dong one produces a number with no meaning —
        // which is what this assertion used to do, and it only ever looked
        // right because every account was USD.
        .select({
          residual: sql<string>`coalesce(sum(${schema.accounts.baseBalanceMinor}), 0)::text`,
        })
        .from(schema.accounts);
      return row?.residual;
    });

    const [pendingCount] = await withTenant(database, orgId, async (tx) => {
      const rows = await tx
        .select({ count: sql<string>`count(*)::text` })
        .from(schema.transactions)
        .where(eq(schema.transactions.status, 'pending'));
      return rows;
    });
    console.log(`posted ${entries} entries (${pendingCount?.count ?? 0} left pending)`);
    console.log(`trial balance residual: ${residual ?? 'unknown'} (0 means consistent)`);
    if (residual !== '0') throw new Error('seeded ledger does not balance');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exitCode = 1;
});

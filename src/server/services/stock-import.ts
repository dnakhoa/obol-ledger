import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { parseTable, sniffSeparator } from '@/lib/csv';
import { isCurrencyCode, parseDecimal, type CurrencyCode } from '@/lib/money';
import { defaultPrecision, isUnit, parseQuantity, type Unit } from '@/lib/quantity';
import { ledgerMessages, type Locale } from '@/lib/i18n';
import { describe as describeError, type LedgerError } from '@/server/domain/errors';
import { inventoryItems, organizations } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createInventoryService } from './inventory';

/**
 * Getting a decade of purchase history out of the spreadsheet.
 *
 * The costing engine is useless to somebody whose lots are in a workbook with
 * four hundred rows in it, and "type them in again" is not an answer. So this
 * reads what they already have.
 *
 * Two decisions shape the whole thing.
 *
 * **It is all or nothing.** A partially applied import is the worst outcome
 * available: the books move, nobody knows how far it got, and undoing it means
 * finding which rows landed. Every row is checked first, and if one fails
 * nothing is written. That also means the preview is trustworthy — it is the
 * same validation the apply runs, not a cheaper approximation of it.
 *
 * **Every refusal names a line.** "Row 3: no product with the code PAV-700" is
 * something a person can fix in thirty seconds. "Import failed" is not.
 */

/** What a column may be called. People type headers; matching one spelling is how a good file gets rejected. */
const COLUMNS = {
  sku: [
    'sku',
    'code',
    'productcode',
    'itemcode',
    'ma',
    'mahang',
    '品目コード',
    '商品コード',
    'コード',
  ],
  name: ['name', 'product', 'productname', 'description', 'tenhang', '品名', '品目名', '商品名'],
  unit: ['unit', 'uom', 'unitofmeasure', 'donvi', '単位'],
  quantity: ['quantity', 'qty', 'amountreceived', 'received', 'soluong', '数量'],
  cost: [
    'cost',
    'totalcost',
    'total',
    'amount',
    'value',
    'linetotal',
    'thanhtien',
    '金額',
    '仕入金額',
    '合計',
  ],
  currency: ['currency', 'ccy', 'tiente'],
  date: [
    'date',
    'datereceived',
    'received',
    'arrived',
    'arrivaldate',
    'invoicedate',
    'ngay',
    '日付',
    '入荷日',
    '仕入日',
  ],
  reference: [
    'reference',
    'ref',
    'container',
    'invoice',
    'invoiceno',
    'lot',
    'batch',
    'sochungtu',
    '伝票番号',
    'コンテナ番号',
    '請求書番号',
  ],
} as const;

export type ImportRow = {
  /** 1-based, counting the header, so it matches what the spreadsheet shows. */
  readonly line: number;
  readonly sku: string;
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
  readonly cost: string;
  readonly currency: string;
  readonly reference: string;
  readonly date: string;
  /** Why this row cannot be imported. Absent when it can. */
  readonly problem?: string;
  /** True when importing would open a new product as well as a lot. */
  readonly createsProduct: boolean;
};

export type ImportPreview = {
  readonly separator: 'tab' | 'semicolon' | 'comma';
  readonly rows: readonly ImportRow[];
  readonly ready: number;
  readonly problems: number;
  readonly newProducts: number;
  /** Columns in the file this importer does not use, so nobody wonders. */
  readonly ignoredColumns: readonly string[];
  readonly missingColumns: readonly string[];
};

export type ImportInput = {
  readonly text: string;
  /** What every delivery is credited to: the supplier account, or a bank. */
  readonly creditAccountId: string;
  /** Where a newly created product's stock sits. */
  readonly inventoryAccountId: string;
  /** Where its cost goes when it ships. */
  readonly cogsAccountId: string;
};

export type ImportResult = {
  readonly lots: number;
  readonly products: number;
};

const SEPARATOR_NAMES: Record<string, ImportPreview['separator']> = {
  '\t': 'tab',
  ';': 'semicolon',
  ',': 'comma',
};

export function createStockImportService(database: Database, orgId: string) {
  return {
    /**
     * What the file says, and what is wrong with it — without writing anything.
     *
     * Runs the same checks the apply does, so a clean preview means a clean
     * import. A preview that is cheaper than the real thing is a preview that
     * lies, usually about the last row.
     */
    async preview(input: ImportInput): Promise<ImportPreview> {
      return withTenant(database, orgId, (tx) => read(tx, orgId, input));
    },

    /**
     * Applies the file, or none of it.
     *
     * The outer transaction is what makes that true. Each row goes through the
     * ordinary receive — the same path the form uses, opening a lot and posting
     * the purchase — and a single refusal rolls the lot back to where it
     * started.
     */
    async apply(input: ImportInput): Promise<Result<ImportResult, LedgerError | ImportRefusal>> {
      return withTenant(database, orgId, async (tx) => {
        const preview = await read(tx, orgId, input);
        if (preview.problems > 0) {
          return err({
            code: 'import_has_problems',
            problems: preview.rows
              .filter((row) => row.problem)
              .map((row) => ({ line: row.line, problem: row.problem ?? '' })),
          });
        }
        if (preview.rows.length === 0) {
          return err({
            code: 'import_has_problems',
            problems: [{ line: 0, problem: 'The file has no rows in it.' }],
          });
        }

        // Written in the tenant's language, because it becomes the
        // description on a posted entry rather than a label on a screen.
        const ledger = ledgerMessages(await booksLocale(tx, orgId));
        const inventory = createInventoryService(tx, orgId);
        const byCode = await codes(tx);
        let products = 0;

        for (const row of preview.rows) {
          let itemId = byCode.get(row.sku);

          if (!itemId) {
            const created = await inventory.createItem({
              sku: row.sku,
              name: row.name || row.sku,
              unit: row.unit as Unit,
              inventoryAccountId: input.inventoryAccountId,
              cogsAccountId: input.cogsAccountId,
            });
            if (!created.ok) return created;
            itemId = created.value.id;
            byCode.set(row.sku, itemId);
            products += 1;
          }

          const currency = row.currency as CurrencyCode;
          const precision = await precisionOf(tx, itemId, row.unit as Unit);
          const quantity = parseQuantity(row.quantity, precision);
          const cost = parseDecimal(row.cost, currency);
          // Both were validated in `read`; this is the type narrowing, not a
          // second opinion.
          if (!quantity.ok || !cost.ok) {
            return err({
              code: 'import_has_problems',
              problems: [
                { line: row.line, problem: 'The quantity or the amount stopped parsing.' },
              ],
            });
          }

          const received = await inventory.receive({
            itemId,
            quantity: quantity.value,
            cost: cost.value,
            currency,
            creditAccountId: input.creditAccountId,
            occurredAt: new Date(`${row.date}T12:00:00.000Z`),
            ...(row.reference ? { reference: row.reference } : {}),
            description: ledger.importedDelivery(row.reference),
          });
          if (!received.ok) {
            // Carried out with the line number attached, because "insufficient
            // funds" on row 217 of a 400-row file is otherwise unfindable.
            return err({
              code: 'import_has_problems',
              problems: [{ line: row.line, problem: describeError(received.error) }],
            });
          }
        }

        return ok({ lots: preview.rows.length, products });
      });
    },
  };
}

export type StockImportService = ReturnType<typeof createStockImportService>;

export type ImportRefusal = {
  readonly code: 'import_has_problems';
  readonly problems: readonly { readonly line: number; readonly problem: string }[];
};

async function booksLocale(tx: Transactional, orgId: string): Promise<Locale> {
  const [row] = await tx
    .select({ locale: organizations.locale })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row?.locale ?? 'en';
}

async function read(tx: Transactional, orgId: string, input: ImportInput): Promise<ImportPreview> {
  const separator = sniffSeparator(input.text);
  const { headers, rows } = parseTable(input.text);
  const index = mapColumns(headers);

  const [org] = await tx
    .select({ currency: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const functional = (org?.currency ?? 'USD') as CurrencyCode;

  const known = await items(tx);
  const missing = (['sku', 'quantity', 'cost', 'date'] as const).filter(
    (column) => index[column] === undefined,
  );

  const parsed = rows.map((cells, offset): ImportRow => {
    const at = (column: keyof typeof COLUMNS) => {
      const position = index[column];
      return position === undefined ? '' : (cells[position] ?? '').trim();
    };

    const sku = at('sku');
    const existing = known.get(sku);
    const unit = at('unit') || existing?.unit || 'piece';
    const currency = (at('currency') || functional).toUpperCase();

    const base = {
      line: offset + 2,
      sku,
      name: at('name') || existing?.name || '',
      quantity: at('quantity'),
      unit,
      cost: at('cost'),
      currency,
      reference: at('reference'),
      date: normaliseDate(at('date')),
      createsProduct: sku !== '' && !existing,
    };

    const problem = missing.length > 0 ? undefined : check(base, existing);
    return problem ? { ...base, problem } : base;
  });

  // A missing column is a fact about the *file*, so it is reported once rather
  // than stamped onto every row — four hundred rows each saying the same thing
  // buries the one sentence that would have fixed it.
  const usable = missing.length === 0;

  return {
    separator: SEPARATOR_NAMES[separator] ?? 'comma',
    rows: parsed,
    ready: usable ? parsed.filter((row) => !row.problem).length : 0,
    problems: usable ? parsed.filter((row) => row.problem).length : parsed.length,
    newProducts: new Set(
      parsed.filter((row) => row.createsProduct && !row.problem).map((r) => r.sku),
    ).size,
    ignoredColumns: headers.filter(
      (header) =>
        header !== '' && !Object.values(COLUMNS).some((names) => names.includes(header as never)),
    ),
    missingColumns: missing,
  };
}

/** One sentence naming what to change, or nothing. */
function check(
  row: Omit<ImportRow, 'problem'>,
  existing: { unit: string; precision: number } | undefined,
): string | undefined {
  if (!row.sku) return 'This row has no product code.';
  if (!row.date) return 'The date is not a date. Use 2026-03-17, 17/03/2026 or 17-03-2026.';

  if (!existing && !isUnit(row.unit)) {
    return `No product has the code ${row.sku}, and "${row.unit}" is not a unit this ledger knows. Add a unit column, or open the product first.`;
  }
  if (existing && row.unit !== existing.unit) {
    return `${row.sku} is measured in ${existing.unit}, and this row says ${row.unit}. One of the two is wrong, and guessing is worse than asking.`;
  }
  if (!isCurrencyCode(row.currency)) {
    return `${row.currency} is not a currency this ledger handles.`;
  }

  const precision = existing?.precision ?? defaultPrecision(row.unit as Unit);
  const quantity = parseQuantity(row.quantity, precision);
  if (!quantity.ok) {
    return quantity.error === 'too_many_decimals'
      ? `${row.sku} is counted to ${precision} decimal place${precision === 1 ? '' : 's'}, and "${row.quantity}" has more. Rounding it here would lose stock quietly.`
      : `"${row.quantity}" is not a quantity.`;
  }
  if (quantity.value === 0n) return 'A delivery of nothing is not a delivery.';

  const cost = parseDecimal(row.cost, row.currency as CurrencyCode);
  if (!cost.ok) {
    return `"${row.cost}" is not an amount in ${row.currency}. Remove any thousands separators and currency symbol.`;
  }
  if (cost.value < 0n) return 'A delivery cannot have cost less than nothing.';

  return undefined;
}

/**
 * `17/03/2026` and `17-03-2026` mean the same day, and neither is ISO.
 *
 * Day-first rather than month-first, deliberately: this ledger's users are in
 * Vietnam, Australia and Europe, where 03/04 is the third of April. Ambiguous
 * dates are the reason the preview prints the resolved date back — a person
 * reading "2026-04-03" next to their own row will notice if it is wrong, and
 * cannot notice anything if the import only echoes what they typed.
 */
function normaliseDate(value: string): string {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/u.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/u.exec(trimmed);
  if (dayFirst) {
    const [, day = '', month = '', year = ''] = dayFirst;
    const padded = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return Number.isNaN(Date.parse(padded)) ? '' : padded;
  }

  return '';
}

function mapColumns(headers: readonly string[]): Partial<Record<keyof typeof COLUMNS, number>> {
  const index: Partial<Record<keyof typeof COLUMNS, number>> = {};
  for (const [column, names] of Object.entries(COLUMNS) as [
    keyof typeof COLUMNS,
    readonly string[],
  ][]) {
    const position = headers.findIndex((header) => names.includes(header));
    if (position >= 0) index[column] = position;
  }
  return index;
}

async function items(
  tx: Transactional,
): Promise<Map<string, { id: string; name: string; unit: string; precision: number }>> {
  const rows = await tx
    .select({
      id: inventoryItems.id,
      sku: inventoryItems.sku,
      name: inventoryItems.name,
      unit: inventoryItems.unit,
      precision: inventoryItems.quantityPrecision,
    })
    .from(inventoryItems);

  return new Map(rows.map((row) => [row.sku, row]));
}

async function codes(tx: Transactional): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: inventoryItems.id, sku: inventoryItems.sku })
    .from(inventoryItems);
  return new Map(rows.map((row) => [row.sku, row.id]));
}

async function precisionOf(tx: Transactional, itemId: string, fallback: Unit): Promise<number> {
  const [row] = await tx
    .select({ precision: inventoryItems.quantityPrecision })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  return row?.precision ?? defaultPrecision(fallback);
}

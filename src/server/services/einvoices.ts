import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { toQuantityString } from '@/lib/quantity';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import {
  buildInvoiceXml,
  invoiceNumber,
  seriesFitsYear,
  type InvoiceLine,
  type Party,
} from '@/server/domain/einvoice-vn';
import type { LedgerError } from '@/server/domain/errors';
import {
  accounts,
  creditNoteLines,
  creditNotes,
  einvoices,
  inventoryItems,
  inventoryMovements,
  organizations,
  sales,
  taxCodes,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { toMoneyDto } from './serialize';
import type { MoneyDto } from './dto';

/**
 * Vietnamese e-invoices for sales, and adjustment invoices for credit notes.
 *
 * The ledger produces the invoice document: the next number in the series,
 * the seller and buyer as the law requires them named, the lines, the tax
 * by rate and the total in words. Signing it with the seller's certificate
 * and obtaining the tax authority's code is a licensed provider's job; the
 * document is what is handed to one. See `docs/adr/0027-vietnam-e-invoices.md`.
 */

export type SellerDetails = {
  readonly legalName: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
  readonly template: string;
  readonly series: string | null;
};

export type EInvoiceSummary = {
  readonly id: string;
  readonly kind: 'original' | 'adjustment';
  readonly saleId: string;
  readonly creditNoteId: string | null;
  readonly template: string;
  readonly series: string;
  readonly number: number;
  /** As it prints: seven digits. */
  readonly printedNumber: string;
  readonly issuedOn: string;
  readonly net: MoneyDto;
  readonly tax: MoneyDto;
  readonly gross: MoneyDto;
  readonly sha256: string;
};

/** Ten digits, or ten, a dash and three for a branch. */
export const VN_TAX_ID = /^\d{10}(-\d{3})?$/u;

export function createEInvoiceService(database: Database, orgId: string) {
  return {
    async seller(): Promise<SellerDetails> {
      return withTenant(database, orgId, (tx) => sellerOf(tx, orgId));
    },

    /** The company as its invoices name it, and the series it issues them under. */
    async updateSeller(input: {
      readonly legalName: string;
      readonly taxId: string;
      readonly address: string;
      readonly series: string;
    }): Promise<Result<SellerDetails, LedgerError>> {
      if (!VN_TAX_ID.test(input.taxId)) return err({ code: 'tax_id_invalid', taxId: input.taxId });
      return withTenant(database, orgId, async (tx) => {
        await tx
          .update(organizations)
          .set({
            legalName: input.legalName,
            taxId: input.taxId,
            address: input.address,
            einvoiceTemplate: '1',
            einvoiceSeries: input.series,
          })
          .where(eq(organizations.id, orgId));
        return ok(await sellerOf(tx, orgId));
      });
    },

    /** A customer as its invoices name it. A consumer has no tax code. */
    async updateBuyer(input: {
      readonly accountId: string;
      readonly legalName: string | null;
      readonly taxId: string | null;
      readonly address: string | null;
    }): Promise<Result<true, LedgerError>> {
      if (input.taxId && !VN_TAX_ID.test(input.taxId)) {
        return err({ code: 'tax_id_invalid', taxId: input.taxId });
      }
      return withTenant(database, orgId, async (tx) => {
        const updated = await tx
          .update(accounts)
          .set({ legalName: input.legalName, taxId: input.taxId, address: input.address })
          .where(eq(accounts.id, input.accountId))
          .returning({ id: accounts.id });
        return updated.length === 1
          ? ok(true)
          : err({ code: 'account_not_found', accountId: input.accountId });
      });
    },

    async buyer(accountId: string) {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .select({
            name: accounts.name,
            legalName: accounts.legalName,
            taxId: accounts.taxId,
            address: accounts.address,
          })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .limit(1);
        return row ?? null;
      });
    },

    /** The invoice for a sale and any adjustments to it, in number order. */
    async forSale(saleId: string): Promise<readonly EInvoiceSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(einvoices)
          .where(eq(einvoices.saleId, saleId))
          .orderBy(asc(einvoices.number));
        return rows.map(summarise);
      });
    },

    /** Every e-invoice issued, newest first, with the sale and buyer it is for. */
    async list(limit = 100) {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select({
            einvoice: einvoices,
            saleReference: sales.reference,
            buyer: sql<string>`coalesce(${accounts.legalName}, ${accounts.name})`,
          })
          .from(einvoices)
          .innerJoin(sales, eq(sales.id, einvoices.saleId))
          .innerJoin(accounts, eq(accounts.id, sales.customerAccountId))
          .orderBy(sql`${einvoices.issuedOn} desc`, sql`${einvoices.number} desc`)
          .limit(limit);
        return rows.map((row) => ({
          ...summarise(row.einvoice),
          saleReference: row.saleReference,
          buyer: row.buyer,
        }));
      });
    },

    /** The document itself, for download or for the provider. */
    async document(einvoiceId: string) {
      return withTenant(database, orgId, async (tx) => {
        const [row] = await tx
          .select()
          .from(einvoices)
          .where(eq(einvoices.id, einvoiceId))
          .limit(1);
        return row
          ? {
              filename: `${row.template}${row.series}_${invoiceNumber(row.number)}.xml`,
              xml: row.xml,
              sha256: row.sha256,
            }
          : null;
      });
    },

    /** Issues the e-invoice for a sale: the next number in the series, dated `issuedOn`. */
    async issueForSale(input: {
      readonly saleId: string;
      readonly issuedOn?: string | undefined;
      readonly userId?: string | undefined;
    }): Promise<Result<EInvoiceSummary, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId)).limit(1);
        if (!sale) return err({ code: 'sale_not_found', saleId: input.saleId });
        const [existing] = await tx
          .select({ id: einvoices.id })
          .from(einvoices)
          .where(and(eq(einvoices.saleId, sale.id), eq(einvoices.kind, 'original')))
          .limit(1);
        if (existing) return err({ code: 'einvoice_already_issued', einvoiceId: existing.id });

        const issuedOn = input.issuedOn ?? new Date().toISOString().slice(0, 10);
        const seller = await readySeller(tx, orgId, issuedOn);
        if (!seller.ok) return seller;

        const rate = await rateOf(tx, sale.taxCodeId);
        const lines = await tx
          .select({ movement: inventoryMovements, item: inventoryItems })
          .from(inventoryMovements)
          .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
          .where(eq(inventoryMovements.saleId, sale.id))
          .orderBy(asc(inventoryMovements.saleLine));
        const invoiceLines: InvoiceLine[] = lines.map(({ movement, item }) => ({
          description: item.name,
          unit: item.unit,
          quantity: toQuantityString(movement.quantityMinor, item.quantityPrecision),
          amount: movement.amountMinor ?? 0n,
          rate,
        }));

        return issue(tx, orgId, {
          kind: 'original',
          saleId: sale.id,
          creditNoteId: null,
          adjusts: null,
          seller: seller.value,
          buyer: await buyerOf(tx, sale.customerAccountId),
          issuedOn,
          currency: sale.currency as CurrencyCode,
          exchangeRate: normaliseRate(sale.fxRate),
          lines: invoiceLines,
          net: sale.netMinor,
          tax: sale.taxMinor,
          userId: input.userId ?? null,
        });
      });
    },

    /**
     * Issues the adjustment invoice for a credit note.
     *
     * Goods returned and allowances given are corrected by an invoice that
     * names the original and carries the reduction as negative amounts — the
     * original itself is never reissued or changed.
     */
    async issueForCreditNote(input: {
      readonly creditNoteId: string;
      readonly issuedOn?: string | undefined;
      readonly userId?: string | undefined;
    }): Promise<Result<EInvoiceSummary, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [note] = await tx
          .select()
          .from(creditNotes)
          .where(eq(creditNotes.id, input.creditNoteId))
          .limit(1);
        if (!note) return err({ code: 'credit_note_not_found', creditNoteId: input.creditNoteId });
        const [existing] = await tx
          .select({ id: einvoices.id })
          .from(einvoices)
          .where(eq(einvoices.creditNoteId, note.id))
          .limit(1);
        if (existing) return err({ code: 'einvoice_already_issued', einvoiceId: existing.id });
        const [original] = await tx
          .select()
          .from(einvoices)
          .where(and(eq(einvoices.saleId, note.saleId), eq(einvoices.kind, 'original')))
          .limit(1);
        if (!original) return err({ code: 'einvoice_original_missing', saleId: note.saleId });
        const [sale] = await tx.select().from(sales).where(eq(sales.id, note.saleId)).limit(1);
        if (!sale) return err({ code: 'sale_not_found', saleId: note.saleId });

        const issuedOn = input.issuedOn ?? new Date().toISOString().slice(0, 10);
        const seller = await readySeller(tx, orgId, issuedOn);
        if (!seller.ok) return seller;

        const rate = await rateOf(tx, sale.taxCodeId);
        const lines = await tx
          .select({ line: creditNoteLines, item: inventoryItems })
          .from(creditNoteLines)
          .innerJoin(inventoryMovements, eq(inventoryMovements.id, creditNoteLines.saleMovementId))
          .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
          .where(eq(creditNoteLines.creditNoteId, note.id))
          .orderBy(asc(creditNoteLines.line));

        return issue(tx, orgId, {
          kind: 'adjustment',
          saleId: sale.id,
          creditNoteId: note.id,
          adjusts: {
            id: original.id,
            template: original.template,
            series: original.series,
            number: original.number,
            issuedOn: original.issuedOn,
            reason: note.reason ?? note.reference,
          },
          seller: seller.value,
          buyer: await buyerOf(tx, sale.customerAccountId),
          issuedOn,
          currency: sale.currency as CurrencyCode,
          exchangeRate: normaliseRate(note.fxRate),
          lines: lines.map(({ line, item }) => ({
            description: item.name,
            unit: item.unit,
            quantity: toQuantityString(line.quantityMinor, item.quantityPrecision),
            amount: -line.amountMinor,
            rate,
          })),
          net: -note.netMinor,
          tax: -note.taxMinor,
          userId: input.userId ?? null,
        });
      });
    },
  };
}

export type EInvoiceService = ReturnType<typeof createEInvoiceService>;

type Issue = {
  readonly kind: 'original' | 'adjustment';
  readonly saleId: string;
  readonly creditNoteId: string | null;
  readonly adjusts: {
    readonly id: string;
    readonly template: string;
    readonly series: string;
    readonly number: number;
    readonly issuedOn: string;
    readonly reason: string;
  } | null;
  readonly seller: Party & { readonly template: string; readonly series: string };
  readonly buyer: Party;
  readonly issuedOn: string;
  readonly currency: CurrencyCode;
  readonly exchangeRate: string;
  readonly lines: readonly InvoiceLine[];
  readonly net: bigint;
  readonly tax: bigint;
  readonly userId: string | null;
};

/**
 * Takes the next number in the series and writes the document.
 *
 * The number is read and taken under the same lock the database's own check
 * takes, so two invoices issued at once queue rather than both reading the
 * same last number — and the check would refuse the second anyway.
 */
async function issue(
  tx: Transactional,
  orgId: string,
  input: Issue,
): Promise<Result<EInvoiceSummary, LedgerError>> {
  const { template, series } = input.seller;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`einvoice:${orgId}:${template}:${series}`}))`,
  );
  const [last] = await tx
    .select({ number: sql<number | null>`max(${einvoices.number})` })
    .from(einvoices)
    .where(and(eq(einvoices.template, template), eq(einvoices.series, series)));
  const number = (last?.number ?? 0) + 1;

  const xml = buildInvoiceXml({
    kind: input.kind,
    reference: { template, series, number, issuedOn: input.issuedOn },
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    paymentMethod: 'TM/CK',
    seller: input.seller,
    buyer: input.buyer,
    lines: input.lines,
    net: input.net,
    tax: input.tax,
    adjusts: input.adjusts ?? undefined,
  });
  const id = newId('einvoice');
  const [row] = await tx
    .insert(einvoices)
    .values({
      id,
      orgId,
      kind: input.kind,
      saleId: input.saleId,
      creditNoteId: input.creditNoteId,
      adjustsId: input.adjusts?.id ?? null,
      template,
      series,
      number,
      issuedOn: input.issuedOn,
      currency: input.currency,
      netMinor: input.net,
      taxMinor: input.tax,
      xml,
      sha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
      issuedBy: input.userId,
    })
    .returning();
  return row ? ok(summarise(row)) : err({ code: 'einvoice_not_found', einvoiceId: id });
}

async function sellerOf(tx: Transactional, orgId: string): Promise<SellerDetails> {
  const [row] = await tx
    .select({
      legalName: organizations.legalName,
      taxId: organizations.taxId,
      address: organizations.address,
      template: organizations.einvoiceTemplate,
      series: organizations.einvoiceSeries,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return {
    legalName: row?.legalName ?? null,
    taxId: row?.taxId ?? null,
    address: row?.address ?? null,
    template: row?.template ?? '1',
    series: row?.series ?? null,
  };
}

/** The seller, complete and with a series valid for the year of issue — or what is missing. */
async function readySeller(
  tx: Transactional,
  orgId: string,
  issuedOn: string,
): Promise<Result<Party & { template: string; series: string }, LedgerError>> {
  const seller = await sellerOf(tx, orgId);
  const missing: ('legalName' | 'taxId' | 'address' | 'series')[] = [];
  if (!seller.legalName) missing.push('legalName');
  if (!seller.taxId) missing.push('taxId');
  if (!seller.address) missing.push('address');
  if (!seller.series) missing.push('series');
  if (missing.length > 0 || !seller.series || !seller.legalName) {
    return err({ code: 'einvoice_seller_incomplete', missing });
  }
  if (!seriesFitsYear(seller.series, issuedOn)) {
    return err({ code: 'einvoice_series_year', series: seller.series, year: issuedOn.slice(0, 4) });
  }
  return ok({
    name: seller.legalName,
    taxId: seller.taxId,
    address: seller.address,
    template: seller.template,
    series: seller.series,
  });
}

async function buyerOf(tx: Transactional, accountId: string): Promise<Party> {
  const [row] = await tx
    .select({
      name: accounts.name,
      legalName: accounts.legalName,
      taxId: accounts.taxId,
      address: accounts.address,
    })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return {
    name: row?.legalName ?? row?.name ?? '',
    taxId: row?.taxId ?? null,
    address: row?.address ?? null,
  };
}

/** The rate as the invoice prints it: "10%", or "KCT" when the sale carried no VAT code. */
async function rateOf(tx: Transactional, taxCodeId: string | null): Promise<string> {
  if (!taxCodeId) return 'KCT';
  const [code] = await tx
    .select({ rate: taxCodes.rateBasisPoints })
    .from(taxCodes)
    .where(eq(taxCodes.id, taxCodeId))
    .limit(1);
  if (!code) return 'KCT';
  const whole = Math.trunc(code.rate / 100);
  const fraction = code.rate % 100;
  return fraction === 0
    ? `${whole}%`
    : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/u, '')}%`;
}

/** `25400.0000000000` → `25400`: the rate as it prints. */
function normaliseRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/0+$/u, '').replace(/\.$/u, '') : rate;
}

function summarise(row: typeof einvoices.$inferSelect): EInvoiceSummary {
  const currency = row.currency as CurrencyCode;
  return {
    id: row.id,
    kind: row.kind,
    saleId: row.saleId,
    creditNoteId: row.creditNoteId,
    template: row.template,
    series: row.series,
    number: row.number,
    printedNumber: invoiceNumber(row.number),
    issuedOn: row.issuedOn,
    net: toMoneyDto(row.netMinor as MinorUnits, currency),
    tax: toMoneyDto(row.taxMinor as MinorUnits, currency),
    gross: toMoneyDto((row.netMinor + row.taxMinor) as MinorUnits, currency),
    sha256: row.sha256,
  };
}

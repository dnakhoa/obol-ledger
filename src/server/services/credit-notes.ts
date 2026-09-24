import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import { convert, parseRate } from '@/lib/fx';
import { minorUnits, toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import type { Unit } from '@/lib/quantity';
import { ledgerMessages } from '@/lib/i18n';
import {
  creditTax,
  lineAmounts,
  restore,
  shareOf,
  type Restoration,
} from '@/server/domain/credit-note';
import { applyTax, type TaxCode } from '@/server/domain/tax';
import type { LedgerError } from '@/server/domain/errors';
import type { DraftPosting } from '@/server/domain/transaction';
import {
  accounts,
  costLayers,
  creditNoteLines,
  creditNotes,
  inventoryItems,
  inventoryMovements,
  layerConsumptions,
  layerRestorations,
  sales,
  taxCodes,
} from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { counterpartyLeg } from './counterparty';
import { legs, methodFor, organisation, type ItemRow } from './inventory';
import { createJournalService } from './journal';
import { revenueAccount } from './sales';
import { recordTaxEntries } from './tax';
import { toMoneyDto } from './serialize';
import type { MoneyDto, TransactionDto } from './dto';

/**
 * Credit notes: correcting a sale by a further record.
 *
 * A sale is append-only, so a customer who sends back cracked pavers, or is
 * given something off for a late container, is dealt with by a document that
 * names the invoice and says what it takes back. One entry again:
 *
 * ```
 * Dr  Revenue, or a deduction such as 521   what is credited, net
 * Dr  Output tax                              the tax on it
 *   Cr  Receivable (customer)                   the gross, at the invoice's rate
 * Dr  Inventory                               what returned goods cost
 *   Cr  Cost of goods sold
 * ```
 *
 * and, for lines where goods came back, a return movement that puts them into
 * the lots they left from. The limits — no more back than shipped, no more
 * credited than charged — are checked here to explain themselves and in the
 * database because this is not the only writer. See `docs/adr/0021-credit-notes.md`.
 */

export type CreditLineInput = {
  /** The invoice line being corrected: its movement id. */
  readonly saleMovementId: string;
  /** Scaled by the item's precision. Zero for a price allowance. */
  readonly quantity: bigint;
  /** Net credited, in the invoice currency. */
  readonly amount: bigint;
};

export type IssueCreditNoteInput = {
  readonly saleId: string;
  readonly reference: string;
  /** Where the revenue comes back out; the sale's revenue account when absent. */
  readonly revenueAccountId?: string | undefined;
  readonly reason?: string | undefined;
  readonly occurredAt?: Date | undefined;
  readonly metadata?: Record<string, string> | undefined;
  readonly lines: readonly CreditLineInput[];
  readonly actor?:
    | { readonly userId?: string | undefined; readonly via: 'ui' | 'api' | 'system' | 'import' }
    | undefined;
};

export type CreditNoteLine = {
  readonly line: number;
  readonly saleMovementId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly unit: Unit;
  readonly quantityPrecision: number;
  /** What came back. Zero for a price allowance. */
  readonly quantityMinor: string;
  /** Credited, net, in the invoice currency. */
  readonly amount: MoneyDto;
  /** The same, in the books' own currency. */
  readonly revenue: MoneyDto;
  /** What the returned goods cost, put back into stock. */
  readonly cost: MoneyDto;
};

export type CreditNoteSummary = {
  readonly id: string;
  readonly reference: string;
  readonly saleId: string;
  readonly saleReference: string;
  readonly customerAccountId: string;
  readonly customerName: string;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly currency: CurrencyCode;
  readonly net: MoneyDto;
  readonly tax: MoneyDto;
  readonly gross: MoneyDto;
  readonly revenue: MoneyDto;
  readonly cost: MoneyDto;
  readonly revenueAccountId: string;
  readonly transactionId: string;
  readonly lines: readonly CreditNoteLine[];
};

export type CreditNoteResult = {
  readonly creditNote: CreditNoteSummary;
  readonly entry: TransactionDto;
};

/** What is still creditable on each invoice line, for the form and the API. */
export type CreditableLine = {
  readonly saleMovementId: string;
  /** Scaled by the item's precision. */
  readonly quantityMinor: string;
  /** Net, in the invoice currency. */
  readonly amountMinor: string;
};

export function createCreditNoteService(database: Database, orgId: string) {
  return {
    async issue(input: IssueCreditNoteInput): Promise<Result<CreditNoteResult, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const requested = input.lines.filter((line) => line.quantity !== 0n || line.amount !== 0n);
        if (requested.length === 0) return err({ code: 'credit_note_has_no_lines' });

        const [taken] = await tx
          .select({ id: creditNotes.id })
          .from(creditNotes)
          .where(eq(creditNotes.reference, input.reference))
          .limit(1);
        if (taken) return err({ code: 'credit_note_reference_taken', reference: input.reference });

        // Locked for the length of the transaction: two credit notes against
        // one invoice queue here, so the second is capped by the first rather
        // than both being capped by the invoice alone. The database checks
        // the same caps again under the same lock.
        const [sale] = await tx
          .select()
          .from(sales)
          .where(eq(sales.id, input.saleId))
          .for('update')
          .limit(1);
        if (!sale) return err({ code: 'sale_not_found', saleId: input.saleId });

        const occurredAt = input.occurredAt ?? new Date();
        if (occurredAt < sale.occurredAt) {
          return err({
            code: 'credit_before_sale',
            creditedOn: occurredAt.toISOString().slice(0, 10),
            invoicedOn: sale.occurredAt.toISOString().slice(0, 10),
          });
        }

        const org = await organisation(tx, orgId);
        const functional = org.functionalCurrency;
        const revenueAccountId = input.revenueAccountId ?? sale.revenueAccountId;
        const revenueOk = await revenueAccount(tx, revenueAccountId, functional);
        if (!revenueOk.ok) return revenueOk;

        const [customer] = await tx
          .select({ name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, sale.customerAccountId))
          .limit(1);

        // ---- The invoice as it stands --------------------------------------
        const saleLines = await invoiceLines(tx, sale.id, sale.netMinor);
        const byMovement = new Map(saleLines.map((line) => [line.movementId, line]));

        const seen = new Set<string>();
        for (const [index, line] of requested.entries()) {
          if (line.quantity < 0n || line.amount < 0n) {
            return err({ code: 'zero_amount_posting', index });
          }
          if (!byMovement.has(line.saleMovementId)) {
            return err({
              code: 'credit_line_not_on_sale',
              saleId: sale.id,
              movementId: line.saleMovementId,
            });
          }
          if (seen.has(line.saleMovementId)) {
            return err({ code: 'credit_line_repeated', movementId: line.saleMovementId });
          }
          seen.add(line.saleMovementId);
        }

        const scaled = sale.currency === functional ? null : parseRate(sale.fxRate);
        if (scaled !== null && typeof scaled !== 'bigint') {
          return err({ code: 'invalid_fx_rate', accountId: '', rate: sale.fxRate });
        }
        // The invoice's own rate. A credit note undoes part of that invoice;
        // at today's rate it would book an exchange difference that no money
        // moved to create.
        const toBase = (amount: bigint): bigint =>
          scaled === null
            ? amount
            : convert({
                amount: amount as MinorUnits,
                from: sale.currency as CurrencyCode,
                to: functional,
                rate: scaled,
              });

        // ---- Each line: what is credited, and what comes back --------------
        type Planned = {
          readonly source: InvoiceLine;
          readonly quantity: bigint;
          readonly amount: bigint;
          readonly revenueBase: bigint;
          readonly restorations: readonly Restoration[];
          readonly returnCost: bigint;
          readonly returnBaseCost: bigint;
        };
        const planned: Planned[] = [];

        for (const line of requested) {
          const source = byMovement.get(line.saleMovementId);
          if (!source) continue;

          const quantityLeft = source.quantity - source.creditedQuantity;
          if (line.quantity > quantityLeft) {
            return err(tooMuchBack(source, quantityLeft, line.quantity));
          }
          const amountLeft = source.amount - source.creditedAmount;
          if (line.amount > amountLeft) {
            const currency = sale.currency as CurrencyCode;
            return err({
              code: 'credit_exceeds_sale',
              limit: 'amount',
              movementId: source.movementId,
              sku: source.item.sku,
              remaining: toDecimalString(minorUnits(amountLeft), currency),
              requested: toDecimalString(minorUnits(line.amount), currency),
              currency,
            });
          }

          const revenueBase = shareOf(
            { original: source.revenueBase, taken: source.creditedRevenueBase },
            line.amount,
            { original: source.amount, taken: source.creditedAmount },
          );

          let restorations: readonly Restoration[] = [];
          if (line.quantity > 0n) {
            const draws = await returnableDraws(tx, source.movementId);
            const restored = restore(draws, line.quantity);
            if (!restored.ok) return err(tooMuchBack(source, restored.returnable, line.quantity));
            restorations = restored.restorations;
          }

          planned.push({
            source,
            quantity: line.quantity,
            amount: line.amount,
            revenueBase,
            restorations,
            returnCost: restorations.reduce((sum, r) => sum + r.cost, 0n),
            returnBaseCost: restorations.reduce((sum, r) => sum + r.baseCost, 0n),
          });
        }

        // ---- The tax it takes back -----------------------------------------
        const net = planned.reduce((sum, line) => sum + line.amount, 0n);
        const baseNet = planned.reduce((sum, line) => sum + line.revenueBase, 0n);
        const baseCost = planned.reduce((sum, line) => sum + line.returnBaseCost, 0n);

        const [prior] = await tx
          .select({
            net: sql<string>`coalesce(sum(${creditNotes.netMinor}), 0)::text`,
            tax: sql<string>`coalesce(sum(${creditNotes.taxMinor}), 0)::text`,
            baseTax: sql<string>`coalesce(sum(${creditNotes.baseTaxMinor}), 0)::text`,
          })
          .from(creditNotes)
          .where(eq(creditNotes.saleId, sale.id));

        // The code the invoice was raised under, even if it has since been
        // retired: a credit note corrects that invoice, under its rules.
        const code = sale.taxCodeId ? await taxCodeById(tx, sale.taxCodeId) : null;
        const { tax, baseTax } = code
          ? creditTax({
              net,
              invoice: {
                net: { original: sale.netMinor, taken: BigInt(prior?.net ?? '0') },
                tax: { original: sale.taxMinor, taken: BigInt(prior?.tax ?? '0') },
                baseTax: { original: sale.baseTaxMinor, taken: BigInt(prior?.baseTax ?? '0') },
              },
              taxOn: (amount) => {
                const applied = applyTax(code, 'sale', amount);
                return applied.ok ? applied.value.tax : 0n;
              },
              toBase,
            })
          : { tax: 0n, baseTax: 0n };
        const gross = net + tax;

        // ---- The entry -----------------------------------------------------
        // A return of goods that cost nothing, credited at nothing, changes
        // nothing — and an entry of no postings is one the journal refuses.
        if (gross === 0n && baseCost === 0n) return err({ code: 'credit_note_has_no_lines' });

        const postings: DraftPosting[] = [];
        if (gross > 0n) {
          const receivable = await counterpartyLeg(
            tx,
            sale.customerAccountId,
            { amount: gross, currency: sale.currency as CurrencyCode },
            { amount: baseNet + baseTax, rate: sale.fxRate, currency: functional },
            -1n,
          );
          if (!receivable.ok) return receivable;
          postings.push(receivable.value);
        }

        const pairs: [string, bigint][] = [[revenueAccountId, baseNet]];
        if (baseTax > 0n && code?.outputAccountId) pairs.push([code.outputAccountId, baseTax]);
        for (const line of planned) {
          if (line.returnBaseCost === 0n) continue;
          pairs.push([line.source.item.inventoryAccountId, line.returnBaseCost]);
          pairs.push([line.source.item.cogsAccountId, -line.returnBaseCost]);
        }
        postings.push(...legs(pairs));

        const creditNoteId = newId('creditNote');
        const books = ledgerMessages(org.locale);
        const entry = await createJournalService(tx, orgId).postEntry({
          description: books.creditNoteIssued(
            input.reference,
            sale.reference,
            customer?.name ?? sale.customerAccountId,
          ),
          currency: functional,
          occurredAt,
          metadata: {
            ...(input.metadata ?? {}),
            creditNote: input.reference,
            sale: sale.id,
            // What the aged receivables settle this against: its own invoice,
            // not whichever happens to be oldest.
            appliesTo: sale.reference,
          },
          ...(input.actor ? { actor: input.actor } : {}),
          postings,
        });
        if (!entry.ok) return entry;
        const transactionId = entry.value.transaction.id;

        await tx.insert(creditNotes).values({
          id: creditNoteId,
          orgId,
          reference: input.reference,
          saleId: sale.id,
          currency: sale.currency,
          fxRate: sale.fxRate,
          revenueAccountId,
          reason: input.reason ?? null,
          netMinor: net,
          taxMinor: tax,
          grossMinor: gross,
          baseNetMinor: baseNet,
          baseTaxMinor: baseTax,
          baseCostMinor: baseCost,
          occurredAt,
          transactionId,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });

        for (const [index, line] of planned.entries()) {
          let returnMovementId: string | null = null;
          if (line.quantity > 0n) {
            returnMovementId = newId('inventoryMovement');
            await tx.insert(inventoryMovements).values({
              id: returnMovementId,
              orgId,
              itemId: line.source.item.id,
              kind: 'return',
              quantityMinor: line.quantity,
              costMinor: line.returnCost,
              baseCostMinor: line.returnBaseCost,
              occurredAt,
              transactionId,
              costingMethod: methodFor(line.source.item, org),
              reference: input.reference,
            });
            await recordRestorations(tx, orgId, returnMovementId, line.restorations);
          }

          await tx.insert(creditNoteLines).values({
            id: newId('creditNoteLine'),
            orgId,
            creditNoteId,
            saleId: sale.id,
            line: index + 1,
            saleMovementId: line.source.movementId,
            quantityMinor: line.quantity,
            amountMinor: line.amount,
            revenueBaseMinor: line.revenueBase,
            baseCostMinor: line.returnBaseCost,
            returnMovementId,
          });
        }

        // The tax return reads these rows, not the postings, so the credit
        // lands on the return for the month it was issued in — which is when
        // an adjustment is declared, not the month of the invoice it adjusts.
        if (code) {
          await recordTaxEntries(tx, orgId, {
            transactionId,
            taxCode: code,
            supply: 'sale',
            net: -baseNet,
            tax: -baseTax,
            occurredAt,
          });
        }

        const summary = await describeCreditNote(tx, creditNoteId, functional);
        return summary
          ? ok({ creditNote: summary, entry: entry.value.transaction })
          : err({ code: 'credit_note_not_found', creditNoteId });
      });
    },

    async get(creditNoteId: string): Promise<CreditNoteSummary | null> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        return describeCreditNote(tx, creditNoteId, org.functionalCurrency);
      });
    },

    /** Oldest first: the order they were issued in, which is the order they read in. */
    async forSale(saleId: string): Promise<readonly CreditNoteSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const rows = await tx
          .select({ id: creditNotes.id })
          .from(creditNotes)
          .where(eq(creditNotes.saleId, saleId))
          .orderBy(asc(creditNotes.occurredAt), asc(creditNotes.id));
        const out: CreditNoteSummary[] = [];
        for (const row of rows) {
          const note = await describeCreditNote(tx, row.id, org.functionalCurrency);
          if (note) out.push(note);
        }
        return out;
      });
    },

    /** Most recent first. */
    async list(limit = 50): Promise<readonly CreditNoteSummary[]> {
      return withTenant(database, orgId, async (tx) => {
        const org = await organisation(tx, orgId);
        const rows = await tx
          .select({ id: creditNotes.id })
          .from(creditNotes)
          .orderBy(desc(creditNotes.occurredAt), desc(creditNotes.id))
          .limit(limit);
        const out: CreditNoteSummary[] = [];
        for (const row of rows) {
          const note = await describeCreditNote(tx, row.id, org.functionalCurrency);
          if (note) out.push(note);
        }
        return out;
      });
    },

    /** What each line of an invoice still has to give: goods to take back, money to credit. */
    async creditable(saleId: string): Promise<readonly CreditableLine[]> {
      return withTenant(database, orgId, async (tx) => {
        const [sale] = await tx
          .select({ id: sales.id, net: sales.netMinor })
          .from(sales)
          .where(eq(sales.id, saleId))
          .limit(1);
        if (!sale) return [];
        const lines = await invoiceLines(tx, sale.id, sale.net);
        return lines.map((line) => ({
          saleMovementId: line.movementId,
          quantityMinor: String(line.quantity - line.creditedQuantity),
          amountMinor: String(line.amount - line.creditedAmount),
        }));
      });
    },
  };
}

export type CreditNoteService = ReturnType<typeof createCreditNoteService>;

type InvoiceLine = {
  readonly movementId: string;
  readonly item: ItemRow;
  readonly quantity: bigint;
  /** Net, in the invoice currency. */
  readonly amount: bigint;
  readonly revenueBase: bigint;
  readonly creditedQuantity: bigint;
  readonly creditedAmount: bigint;
  readonly creditedRevenueBase: bigint;
};

function tooMuchBack(source: InvoiceLine, remaining: bigint, requested: bigint): LedgerError {
  return {
    code: 'credit_exceeds_sale',
    limit: 'quantity',
    movementId: source.movementId,
    sku: source.item.sku,
    remaining: String(remaining),
    requested: String(requested),
    precision: source.item.quantityPrecision,
    unit: source.item.unit,
  };
}

/** An invoice's lines, with what earlier credit notes already took from each. */
async function invoiceLines(
  tx: Transactional,
  saleId: string,
  invoiceNet: bigint,
): Promise<InvoiceLine[]> {
  const rows = await tx
    .select({ movement: inventoryMovements, item: inventoryItems })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .where(eq(inventoryMovements.saleId, saleId))
    .orderBy(asc(inventoryMovements.saleLine));

  const credited = rows.length
    ? await tx
        .select({
          movementId: creditNoteLines.saleMovementId,
          quantity: sql<string>`sum(${creditNoteLines.quantityMinor})::text`,
          amount: sql<string>`sum(${creditNoteLines.amountMinor})::text`,
          revenue: sql<string>`sum(${creditNoteLines.revenueBaseMinor})::text`,
        })
        .from(creditNoteLines)
        .where(
          inArray(
            creditNoteLines.saleMovementId,
            rows.map((row) => row.movement.id),
          ),
        )
        .groupBy(creditNoteLines.saleMovementId)
    : [];
  const creditedBy = new Map(credited.map((row) => [row.movementId, row]));

  const amounts = lineAmounts(
    invoiceNet,
    rows.map((row) => ({
      amount: row.movement.amountMinor,
      revenueBase: row.movement.revenueBaseMinor ?? 0n,
    })),
  );

  return rows.map((row, index) => {
    const prior = creditedBy.get(row.movement.id);
    return {
      movementId: row.movement.id,
      item: row.item,
      quantity: row.movement.quantityMinor,
      amount: amounts[index] ?? 0n,
      revenueBase: row.movement.revenueBaseMinor ?? 0n,
      creditedQuantity: BigInt(prior?.quantity ?? '0'),
      creditedAmount: BigInt(prior?.amount ?? '0'),
      creditedRevenueBase: BigInt(prior?.revenue ?? '0'),
    };
  });
}

/**
 * The draws an invoice line made, with what earlier returns already gave back.
 *
 * The lots are locked: a return raises a lot's remainder, and a sale drawing
 * on the same lot at the same moment must see the result rather than the
 * remainder from before it.
 */
async function returnableDraws(tx: Transactional, saleMovementId: string) {
  const draws = await tx
    .select({
      consumptionId: layerConsumptions.id,
      layerId: layerConsumptions.layerId,
      acquiredAt: costLayers.acquiredAt,
      quantity: layerConsumptions.quantityMinor,
      cost: layerConsumptions.costMinor,
      baseCost: layerConsumptions.baseCostMinor,
    })
    .from(layerConsumptions)
    .innerJoin(costLayers, eq(costLayers.id, layerConsumptions.layerId))
    .where(eq(layerConsumptions.movementId, saleMovementId))
    .for('update', { of: costLayers });

  const restored = draws.length
    ? await tx
        .select({
          consumptionId: layerRestorations.consumptionId,
          quantity: sql<string>`sum(${layerRestorations.quantityMinor})::text`,
          cost: sql<string>`sum(${layerRestorations.costMinor})::text`,
          baseCost: sql<string>`sum(${layerRestorations.baseCostMinor})::text`,
        })
        .from(layerRestorations)
        .where(
          inArray(
            layerRestorations.consumptionId,
            draws.map((draw) => draw.consumptionId),
          ),
        )
        .groupBy(layerRestorations.consumptionId)
    : [];
  const restoredBy = new Map(restored.map((row) => [row.consumptionId, row]));

  return draws.map((draw) => {
    const prior = restoredBy.get(draw.consumptionId);
    return {
      ...draw,
      restoredQuantity: BigInt(prior?.quantity ?? '0'),
      restoredCost: BigInt(prior?.cost ?? '0'),
      restoredBaseCost: BigInt(prior?.baseCost ?? '0'),
    };
  });
}

/** Puts goods back into their lots: the inverse of `recordDraws`. */
async function recordRestorations(
  tx: Transactional,
  orgId: string,
  movementId: string,
  restorations: readonly Restoration[],
): Promise<void> {
  for (const restoration of restorations) {
    await tx.insert(layerRestorations).values({
      id: newId('layerRestoration'),
      orgId,
      movementId,
      consumptionId: restoration.consumptionId,
      layerId: restoration.layerId,
      quantityMinor: restoration.quantity,
      costMinor: restoration.cost,
      baseCostMinor: restoration.baseCost,
    });

    // An increment rather than a computed value, like the decrement it
    // undoes, and bounded by the same CHECK: a lot can hold no more than
    // arrived in it.
    await tx
      .update(costLayers)
      .set({
        remainingQuantityMinor: sql`${costLayers.remainingQuantityMinor} + ${restoration.quantity}`,
        remainingCostMinor: sql`${costLayers.remainingCostMinor} + ${restoration.cost}`,
        remainingBaseCostMinor: sql`${costLayers.remainingBaseCostMinor} + ${restoration.baseCost}`,
      })
      .where(eq(costLayers.id, restoration.layerId));
  }
}

async function taxCodeById(tx: Transactional, taxCodeId: string): Promise<TaxCode | null> {
  const [row] = await tx.select().from(taxCodes).where(eq(taxCodes.id, taxCodeId)).limit(1);
  return row
    ? {
        id: row.id,
        name: row.name,
        rateBasisPoints: row.rateBasisPoints,
        treatment: row.treatment,
        inputAccountId: row.inputAccountId,
        outputAccountId: row.outputAccountId,
      }
    : null;
}

async function describeCreditNote(
  tx: Transactional,
  creditNoteId: string,
  functional: CurrencyCode,
): Promise<CreditNoteSummary | null> {
  const [row] = await tx
    .select({
      note: creditNotes,
      saleReference: sales.reference,
      customerAccountId: sales.customerAccountId,
      customerName: accounts.name,
    })
    .from(creditNotes)
    .innerJoin(sales, eq(sales.id, creditNotes.saleId))
    .innerJoin(accounts, eq(accounts.id, sales.customerAccountId))
    .where(eq(creditNotes.id, creditNoteId))
    .limit(1);
  if (!row) return null;
  const { note } = row;
  const currency = note.currency as CurrencyCode;
  const invoiced = (value: bigint) => toMoneyDto(value as MinorUnits, currency);
  const base = (value: bigint) => toMoneyDto(value as MinorUnits, functional);

  const lines = await tx
    .select({ line: creditNoteLines, item: inventoryItems })
    .from(creditNoteLines)
    .innerJoin(inventoryMovements, eq(inventoryMovements.id, creditNoteLines.saleMovementId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.itemId))
    .where(and(eq(creditNoteLines.creditNoteId, note.id)))
    .orderBy(asc(creditNoteLines.line));

  return {
    id: note.id,
    reference: note.reference,
    saleId: note.saleId,
    saleReference: row.saleReference,
    customerAccountId: row.customerAccountId,
    customerName: row.customerName,
    occurredAt: note.occurredAt,
    reason: note.reason,
    currency,
    net: invoiced(note.netMinor),
    tax: invoiced(note.taxMinor),
    gross: invoiced(note.grossMinor),
    revenue: base(note.baseNetMinor),
    cost: base(note.baseCostMinor),
    revenueAccountId: note.revenueAccountId,
    transactionId: note.transactionId,
    lines: lines.map(({ line, item }) => ({
      line: line.line,
      saleMovementId: line.saleMovementId,
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
      unit: item.unit,
      quantityPrecision: item.quantityPrecision,
      quantityMinor: String(line.quantityMinor),
      amount: invoiced(line.amountMinor),
      revenue: base(line.revenueBaseMinor),
      cost: base(line.baseCostMinor),
    })),
  };
}

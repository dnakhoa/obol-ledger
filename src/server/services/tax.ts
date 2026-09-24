import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import {
  applyTax,
  type Supply,
  type TaxCalculation,
  type TaxCode,
  type TaxTreatment,
} from '@/server/domain/tax';
import type { LedgerError } from '@/server/domain/errors';
import { organizations, taxCodes, taxEntries } from '@/server/db/schema';
import { withTenant } from '@/server/db/tenancy';
import type { Database, Transactional } from '@/server/db/types';
import { createJournalService } from './journal';
import type { TransactionDto } from './dto';

/**
 * Posting an entry that carries consumption tax.
 *
 * The tax legs are *added* to the net ones the caller supplies rather than the
 * caller being asked to work them out, because working them out is where the
 * mistake happens: the three mechanisms differ in which side gets a leg at
 * all, and getting it wrong produces an entry that balances.
 */

export type CreateTaxCodeInput = {
  readonly name: string;
  readonly rateBasisPoints: number;
  readonly treatment: TaxTreatment;
  readonly inputAccountId?: string | undefined;
  readonly outputAccountId?: string | undefined;
};

export type PostWithTaxInput = {
  readonly description: string;
  readonly taxCodeId: string;
  readonly supply: Supply;
  /** The net amount, or the gross when `inclusive`. */
  readonly amount: bigint;
  readonly inclusive?: boolean | undefined;
  /** The account the net lands on: revenue for a sale, an expense or asset for a purchase. */
  readonly netAccountId: string;
  /** The counterparty account: the receivable on a sale, the payable on a purchase. */
  readonly counterpartyAccountId: string;
  readonly occurredAt?: Date | undefined;
  readonly metadata?: Record<string, string> | undefined;
};

export type TaxedEntry = {
  readonly entry: TransactionDto;
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
};

export function createTaxService(database: Database, orgId: string) {
  return {
    async create(input: CreateTaxCodeInput): Promise<Result<{ id: string }, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const [existing] = await tx
          .select({ id: taxCodes.id })
          .from(taxCodes)
          .where(eq(taxCodes.name, input.name))
          .limit(1);
        if (existing) return err({ code: 'tax_code_name_taken', name: input.name });

        // The shape rules are checked here so the refusal explains itself, and
        // again by a CHECK because this service is not the only writer.
        if (input.treatment === 'sales_tax' && input.inputAccountId) {
          return err({ code: 'sales_tax_is_not_reclaimable' });
        }
        if (!input.outputAccountId) {
          return err({ code: 'tax_account_missing', treatment: input.treatment, side: 'output' });
        }
        // Reaching the CHECK for this would be a constraint violation rather
        // than a refusal — a 500 where the person left a dropdown blank.
        if (input.treatment !== 'sales_tax' && !input.inputAccountId) {
          return err({ code: 'tax_account_missing', treatment: input.treatment, side: 'input' });
        }

        const id = newId('taxCode');
        await tx.insert(taxCodes).values({
          id,
          orgId,
          name: input.name,
          rateBasisPoints: input.rateBasisPoints,
          treatment: input.treatment,
          inputAccountId: input.inputAccountId ?? null,
          outputAccountId: input.outputAccountId ?? null,
        });
        return ok({ id });
      });
    },

    async list(): Promise<readonly TaxCode[]> {
      return withTenant(database, orgId, async (tx) => {
        const rows = await tx
          .select()
          .from(taxCodes)
          .where(eq(taxCodes.status, 'active'))
          .orderBy(taxCodes.name);
        return rows.map(toDomain);
      });
    },

    /**
     * Posts a sale or a purchase with its tax.
     *
     * Three legs for VAT, two for a US purchase, four for a reverse charge —
     * decided by the treatment rather than by the caller, which is the whole
     * reason this exists.
     */
    async post(input: PostWithTaxInput): Promise<Result<TaxedEntry, LedgerError>> {
      return withTenant(database, orgId, async (tx) => {
        const taxed = await calculateTax(tx, input.taxCodeId, input.supply, input.amount, {
          ...(input.inclusive === undefined ? {} : { inclusive: input.inclusive }),
        });
        if (!taxed.ok) return taxed;

        const { net, gross, legs } = taxed.value.calculation;
        const functional = await functionalCurrency(tx, orgId);
        const sign = input.supply === 'sale' ? 1n : -1n;

        // A sale: debit the customer the gross, credit revenue the net, credit
        // the state the tax. A purchase mirrors it. The tax legs already carry
        // their own sign, so the two net legs are all that flips.
        const entry = await createJournalService(tx, orgId).postEntry({
          description: input.description,
          currency: functional,
          ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
          postings: [
            {
              accountId: input.counterpartyAccountId,
              amount: (gross * sign) as MinorUnits,
            },
            {
              accountId: input.netAccountId,
              amount: (-net * sign) as MinorUnits,
            },
            ...legs.map((leg) => ({
              accountId: leg.accountId,
              amount: leg.amount as MinorUnits,
            })),
          ],
        });
        if (!entry.ok) return entry;

        await recordTaxEntries(tx, orgId, {
          transactionId: entry.value.transaction.id,
          taxCode: taxed.value.code,
          supply: input.supply,
          net,
          tax: taxed.value.calculation.tax,
          occurredAt: new Date(entry.value.transaction.occurredAt),
        });

        return ok({
          entry: entry.value.transaction,
          net: String(net),
          tax: String(taxed.value.calculation.tax),
          gross: String(gross),
        });
      });
    },
  };
}

/**
 * Looks up an active code and works out what a supply attracts under it.
 *
 * Shared with the stock sale, which is the other thing that raises an
 * invoice: two copies of "which side gets a leg" would be two chances to get
 * the reverse charge wrong.
 *
 * A zero leg is dropped here. A zero-rated export has no tax to post, and a
 * posting of nothing is refused by the journal — correctly, since it records
 * nothing — so leaving it in made every 0% supply impossible to post. The
 * return row is written regardless; see `recordTaxEntries`.
 */
export async function calculateTax(
  tx: Transactional,
  taxCodeId: string,
  supply: Supply,
  amount: bigint,
  options: { inclusive?: boolean } = {},
): Promise<Result<{ code: TaxCode; calculation: TaxCalculation }, LedgerError>> {
  const [row] = await tx
    .select()
    .from(taxCodes)
    .where(and(eq(taxCodes.id, taxCodeId), eq(taxCodes.status, 'active')))
    .limit(1);
  if (!row) return err({ code: 'tax_code_not_found', taxCodeId });

  const code = toDomain(row);
  const calculated = applyTax(code, supply, amount, options);
  if (!calculated.ok) {
    return calculated.error.code === 'negative_rate'
      ? err({ code: 'tax_code_not_found', taxCodeId })
      : err({
          code: 'tax_account_missing',
          treatment: calculated.error.treatment,
          side: calculated.error.side,
        });
  }

  return ok({
    code,
    calculation: {
      ...calculated.value,
      legs: calculated.value.legs.filter((leg) => leg.amount !== 0n),
    },
  });
}

/**
 * What the entry attracted, recorded beside it.
 *
 * Nothing in the postings themselves says which code produced the tax leg —
 * an account balance is a single number and a return needs the split by code.
 * Derivable now, unrecoverable later, so it is written now. A zero-rated
 * supply still gets a row: an export at 0% belongs on the return, and a
 * missing row and a nil row are not the same claim.
 *
 * A reverse-charge *acquisition* gets two rows, one per side. The buyer
 * accounts for the tax as if it had made the sale itself, so the acquisition
 * appears on both halves of the return and nets to nothing — which is what
 * the form expects, and is only visible because the two rows exist. One row
 * would report the input credit and quietly drop the output tax that
 * justifies it.
 *
 * A reverse-charge *sale* gets one. The seller charged nothing and reports
 * the supply; it acquired nothing, and a purchase row would put an
 * acquisition that never happened onto its return.
 */
export async function recordTaxEntries(
  tx: Transactional,
  orgId: string,
  input: {
    readonly transactionId: string;
    readonly taxCode: TaxCode;
    readonly supply: Supply;
    /** In the functional currency, like everything on a return. */
    readonly net: bigint;
    readonly tax: bigint;
    readonly occurredAt: Date;
  },
): Promise<void> {
  const sides: Supply[] =
    input.taxCode.treatment === 'reverse_charge' && input.supply === 'purchase'
      ? ['purchase', 'sale']
      : [input.supply];
  await tx.insert(taxEntries).values(
    sides.map((side) => ({
      id: newId('taxEntry'),
      orgId,
      transactionId: input.transactionId,
      taxCodeId: input.taxCode.id,
      supply: side,
      baseMinor: input.net,
      taxMinor: input.tax,
      occurredAt: input.occurredAt,
    })),
  );
}

export type TaxService = ReturnType<typeof createTaxService>;

function toDomain(row: typeof taxCodes.$inferSelect): TaxCode {
  return {
    id: row.id,
    name: row.name,
    rateBasisPoints: row.rateBasisPoints,
    treatment: row.treatment,
    inputAccountId: row.inputAccountId,
    outputAccountId: row.outputAccountId,
  };
}

async function functionalCurrency(tx: Transactional, orgId: string): Promise<CurrencyCode> {
  const [row] = await tx
    .select({ currency: organizations.functionalCurrency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return (row?.currency ?? 'USD') as CurrencyCode;
}

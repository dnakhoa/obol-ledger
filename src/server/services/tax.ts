import { and, eq } from 'drizzle-orm';
import { err, ok, type Result } from '@/lib/result';
import { newId } from '@/lib/id';
import type { CurrencyCode, MinorUnits } from '@/lib/money';
import { applyTax, type Supply, type TaxCode, type TaxTreatment } from '@/server/domain/tax';
import type { LedgerError } from '@/server/domain/errors';
import { organizations, taxCodes } from '@/server/db/schema';
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

        // The shape rule is checked here so the refusal explains itself, and
        // again by a CHECK because this service is not the only writer.
        if (input.treatment === 'sales_tax' && input.inputAccountId) {
          return err({ code: 'sales_tax_is_not_reclaimable' });
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
        const [row] = await tx
          .select()
          .from(taxCodes)
          .where(and(eq(taxCodes.id, input.taxCodeId), eq(taxCodes.status, 'active')))
          .limit(1);
        if (!row) return err({ code: 'tax_code_not_found', taxCodeId: input.taxCodeId });

        const calculated = applyTax(toDomain(row), input.supply, input.amount, {
          ...(input.inclusive === undefined ? {} : { inclusive: input.inclusive }),
        });
        if (!calculated.ok) {
          return calculated.error.code === 'negative_rate'
            ? err({ code: 'tax_code_not_found', taxCodeId: input.taxCodeId })
            : err({
                code: 'tax_account_missing',
                treatment: calculated.error.treatment,
                side: calculated.error.side,
              });
        }

        const { net, gross, legs } = calculated.value;
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

        return ok({
          entry: entry.value.transaction,
          net: String(net),
          tax: String(calculated.value.tax),
          gross: String(gross),
        });
      });
    },
  };
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

import { divideRounding } from '@/lib/fx';
import { err, ok, type Result } from '@/lib/result';

/**
 * Consumption tax, which is three different mechanisms wearing one name.
 *
 * Modelling them as one rate with one account is wrong in a way that only
 * surfaces when somebody tries to file a return, and by then a quarter of
 * entries are wrong.
 *
 * **Value added tax** — Vietnam's GTGT, Japan's 消費税, GST in Australia and
 * New Zealand, VAT across the EU. Tax charged on a sale is owed to the state;
 * tax paid on a purchase is reclaimable from it; what gets remitted is the
 * difference. Two accounts, and the return is the net of them.
 *
 * **Reverse charge** — the EU's answer to cross-border business-to-business
 * supply. The seller charges nothing and the *buyer* accounts for both sides
 * of the same tax: output tax owed and input tax reclaimable, identical
 * amounts, netting to nothing. It is not "no tax" — both entries have to
 * appear on the return, and a system that posts neither cannot produce one.
 *
 * **Sales tax** — the United States. Collected from the customer and remitted;
 * tax paid on a purchase is **never reclaimable** and is simply part of what
 * the thing cost. A business given an input-tax account here accumulates a
 * receivable from a state that does not owe it, and nothing in the ledger ever
 * objects — the accounts balance perfectly while the asset is fictional.
 *
 * That last asymmetry is why the US chart of accounts ships with a sales-tax
 * payable and deliberately no input-tax asset, and why the treatment is a
 * column rather than a rate with a comment.
 */

export const TAX_TREATMENTS = ['vat', 'reverse_charge', 'sales_tax'] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/** Which way the supply goes, which decides which side the tax lands on. */
export type Supply = 'sale' | 'purchase';

export type TaxCode = {
  readonly id: string;
  readonly name: string;
  /** Basis points, so 10% is 1000 and 8.25% is 825 — no float anywhere. */
  readonly rateBasisPoints: number;
  readonly treatment: TaxTreatment;
  /** Reclaimable tax paid on purchases. Absent under sales tax, by law. */
  readonly inputAccountId: string | null;
  /** Tax charged on sales and owed to the state. */
  readonly outputAccountId: string | null;
};

export type TaxLeg = {
  readonly accountId: string;
  /** Signed, debit-positive, like every posting here. */
  readonly amount: bigint;
};

export type TaxCalculation = {
  /** The amount before tax. */
  readonly net: bigint;
  /** The tax itself. Zero when none is separated out. */
  readonly tax: bigint;
  /** What changes hands. */
  readonly gross: bigint;
  /**
   * The postings the tax adds, beyond the net ones the caller already has.
   *
   * Two of them under reverse charge, which is the point: a purchase from
   * another member state books the output tax it owes *and* the input tax it
   * reclaims, and the pair nets to nothing while both appear on the return.
   */
  readonly legs: readonly TaxLeg[];
};

export type TaxError =
  | {
      readonly code: 'tax_account_missing';
      readonly treatment: TaxTreatment;
      readonly side: 'input' | 'output';
    }
  | { readonly code: 'negative_rate' };

const BASIS = 10_000n;

/** Tax on an amount quoted *before* tax. */
export function fromNet(net: bigint, rateBasisPoints: number): { net: bigint; tax: bigint } {
  const tax = divideRounding(net * BigInt(rateBasisPoints), BASIS);
  return { net, tax };
}

/**
 * Tax inside an amount quoted *including* it.
 *
 * Prices are commonly quoted gross in Vietnam and Japan, and the split has to
 * be exact: the net is rounded and the tax takes the remainder, so the two
 * always add back to the price on the invoice. Rounding both independently
 * leaves a dong that reconciles to nothing.
 */
export function fromGross(gross: bigint, rateBasisPoints: number): { net: bigint; tax: bigint } {
  const net = divideRounding(gross * BASIS, BASIS + BigInt(rateBasisPoints));
  return { net, tax: gross - net };
}

/**
 * What tax an entry attracts, and the postings it adds.
 *
 * `amount` is the net unless `inclusive`, in which case it is the gross and
 * the tax is extracted from inside it.
 */
export function applyTax(
  code: TaxCode,
  supply: Supply,
  amount: bigint,
  options: { inclusive?: boolean } = {},
): Result<TaxCalculation, TaxError> {
  if (code.rateBasisPoints < 0) return err({ code: 'negative_rate' });

  const { net, tax } = options.inclusive
    ? fromGross(amount, code.rateBasisPoints)
    : fromNet(amount, code.rateBasisPoints);

  const nothing = (): TaxCalculation => ({ net: amount, tax: 0n, gross: amount, legs: [] });

  switch (code.treatment) {
    case 'vat': {
      const accountId = supply === 'sale' ? code.outputAccountId : code.inputAccountId;
      if (!accountId) {
        return err({
          code: 'tax_account_missing',
          treatment: 'vat',
          side: supply === 'sale' ? 'output' : 'input',
        });
      }
      // A sale credits what is owed to the state; a purchase debits what can
      // be reclaimed from it.
      return ok({
        net,
        tax,
        gross: net + tax,
        legs: [{ accountId, amount: supply === 'sale' ? -tax : tax }],
      });
    }

    case 'reverse_charge': {
      // The seller charges nothing at all — the obligation moved to the buyer.
      if (supply === 'sale') return ok(nothing());

      if (!code.inputAccountId || !code.outputAccountId) {
        return err({
          code: 'tax_account_missing',
          treatment: 'reverse_charge',
          side: code.outputAccountId ? 'input' : 'output',
        });
      }

      // Both sides, same amount. The pair nets to nothing and the supplier is
      // owed only the net — but both entries have to exist, because both
      // appear on the return and a system that posts neither cannot file one.
      return ok({
        net,
        tax,
        gross: net,
        legs: [
          { accountId: code.inputAccountId, amount: tax },
          { accountId: code.outputAccountId, amount: -tax },
        ],
      });
    }

    case 'sales_tax': {
      // Purchases carry no separable tax: it is not reclaimable, so it is part
      // of what the thing cost and belongs in the expense or the asset. An
      // input-tax account here would accumulate a receivable from a state
      // that does not owe it, and the accounts would balance perfectly while
      // the asset was fictional.
      if (supply === 'purchase') return ok(nothing());

      if (!code.outputAccountId) {
        return err({ code: 'tax_account_missing', treatment: 'sales_tax', side: 'output' });
      }
      return ok({
        net,
        tax,
        gross: net + tax,
        legs: [{ accountId: code.outputAccountId, amount: -tax }],
      });
    }
  }
}

/** `1000` → `"10%"`, `825` → `"8.25%"`. Trailing zeroes trimmed. */
export function formatRate(rateBasisPoints: number): string {
  const whole = Math.trunc(rateBasisPoints / 100);
  const fraction = Math.abs(rateBasisPoints % 100);
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/u, '')}%`;
}

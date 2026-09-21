import { err, ok, type Result } from '@/lib/result';
import { formatRate, type TaxTreatment } from './tax';

/**
 * A consumption tax return, as the figures rather than as a form.
 *
 * Every jurisdiction asks for the same three quantities and then arranges them
 * differently on paper: tax charged on sales, tax paid on purchases that may
 * be reclaimed, and the difference. Vietnam's 01/GTGT splits sales by rate and
 * carries an unused credit forward at chỉ tiêu 43; Japan's 消費税申告書 works
 * annually with interim payments; a US state form has no input side at all
 * because none of it is reclaimable.
 *
 * Modelling the *forms* would mean a new model per jurisdiction and a rewrite
 * whenever one changes. Modelling the figures means the form is a rendering,
 * and the part that must be right — the numbers — is right once.
 *
 * ## The credit carried forward
 *
 * When input tax exceeds output tax the difference is not, in most systems, a
 * refund. It is a credit carried into the next period and set against the tax
 * owed there. That makes a sequence of returns a *chain*: this period's
 * opening credit is last period's closing credit, and a gap in the chain is a
 * figure nobody can reconcile.
 *
 * It is also what stops a return being a subtraction. `output - input` is the
 * answer only when the answer is positive.
 */

/** One rate's worth of a return, which is how every form groups them. */
export type TaxBand = {
  readonly taxCodeId: string;
  readonly name: string;
  readonly treatment: TaxTreatment;
  readonly rateBasisPoints: number;
  /** As a form prints it: `10%`, `8.25%`. */
  readonly rate: string;
  /** The amount before tax — every form asks for this beside the tax. */
  readonly base: bigint;
  readonly tax: bigint;
};

export type TaxReturnFigures = {
  readonly sales: readonly TaxBand[];
  readonly purchases: readonly TaxBand[];
  /** Tax charged on sales and owed to the state. */
  readonly outputTax: bigint;
  /** Tax paid on purchases that may be set against it. */
  readonly inputTax: bigint;
  /** Unused credit from the previous return. */
  readonly broughtForward: bigint;
  /** What must actually be paid. Never negative. */
  readonly payable: bigint;
  /** What goes into the next return instead of being refunded. */
  readonly carriedForward: bigint;
};

export type TaxEntryLine = {
  readonly taxCodeId: string;
  readonly name: string;
  readonly treatment: TaxTreatment;
  readonly rateBasisPoints: number;
  readonly supply: 'sale' | 'purchase';
  readonly base: bigint;
  readonly tax: bigint;
};

export type TaxReturnError = { readonly code: 'negative_brought_forward' };

/**
 * Totals the period's tax entries into the figures a return is made of.
 *
 * Reverse charge is the case worth watching. A cross-border acquisition books
 * output tax *and* input tax of the same amount, so it appears on both sides
 * of the return and contributes nothing to the payable — which is exactly what
 * the form expects, and is only possible because the three treatments were
 * modelled separately rather than as one rate.
 *
 * US sales tax has no input side, so `inputTax` is zero and the whole of the
 * output is payable. That also falls out rather than being special-cased.
 */
export function buildReturn(
  lines: readonly TaxEntryLine[],
  broughtForward: bigint,
): Result<TaxReturnFigures, TaxReturnError> {
  if (broughtForward < 0n) return err({ code: 'negative_brought_forward' });

  const sales = bandsFor(lines, 'sale');
  const purchases = bandsFor(lines, 'purchase');

  const outputTax = sales.reduce((total, band) => total + band.tax, 0n);
  const inputTax = purchases.reduce((total, band) => total + band.tax, 0n);

  // The credit is spent before anything is paid, and only what is left over is
  // owed. `output - input - broughtForward` can go negative, and when it does
  // the negative part is not a refund — it is next period's opening credit.
  const offsettable = inputTax + broughtForward;
  const payable = outputTax > offsettable ? outputTax - offsettable : 0n;
  const carriedForward = offsettable > outputTax ? offsettable - outputTax : 0n;

  return ok({ sales, purchases, outputTax, inputTax, broughtForward, payable, carriedForward });
}

/**
 * One band per tax code, because that is the grain a form asks for.
 *
 * Not one per *rate*: two codes can share a rate and mean different things —
 * a domestic 10% sale and a 10% reverse charge are both 10% and belong on
 * different lines of the return.
 */
function bandsFor(lines: readonly TaxEntryLine[], supply: 'sale' | 'purchase'): TaxBand[] {
  const bands = new Map<string, TaxBand>();

  for (const line of lines) {
    if (line.supply !== supply) continue;

    const existing = bands.get(line.taxCodeId);
    bands.set(line.taxCodeId, {
      taxCodeId: line.taxCodeId,
      name: line.name,
      treatment: line.treatment,
      rateBasisPoints: line.rateBasisPoints,
      rate: formatRate(line.rateBasisPoints),
      base: (existing?.base ?? 0n) + line.base,
      tax: (existing?.tax ?? 0n) + line.tax,
    });
  }

  // Highest rate first, which is the order every form lists them in.
  return [...bands.values()].sort(
    (a, b) => b.rateBasisPoints - a.rateBasisPoints || a.name.localeCompare(b.name),
  );
}

/**
 * The legs that clear the tax accounts when a return is filed.
 *
 * Filing is not only a report. The output-tax account has been accumulating a
 * liability all period and the input-tax account a receivable; filing settles
 * them against each other and leaves whichever remains.
 *
 * The input account is credited by *at most* the output, never more. That is
 * what leaves an unused credit sitting in it, which is precisely what "carried
 * forward" means in the books — the next period finds it already there rather
 * than having to remember a number from a form.
 */
export function clearingLegs(figures: TaxReturnFigures): {
  readonly output: bigint;
  readonly input: bigint;
  readonly payable: bigint;
} {
  const input = figures.inputTax < figures.outputTax ? figures.inputTax : figures.outputTax;
  return { output: figures.outputTax, input, payable: figures.outputTax - input };
}

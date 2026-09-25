import { exponentOf, toDecimalString, type CurrencyCode, type MinorUnits } from '@/lib/money';
import { amountInVietnameseWords } from '@/lib/vietnamese-words';

/**
 * A Vietnamese VAT invoice as the national e-invoice XML.
 *
 * Since Nghị định 123/2020 every invoice a Vietnamese business issues is an
 * XML document in the format the General Department of Taxation prescribes
 * (Quyết định 1450/QĐ-TCT and its amendments), signed with the seller's
 * digital certificate and — for a coded invoice — given a code by the tax
 * authority. The XML is the legal invoice; a PDF is a courtesy copy.
 *
 * This module builds the unsigned document: the part the ledger knows. The
 * signature and the authority's code are added by a licensed e-invoice
 * provider, which is the only party that may submit one; see
 * `docs/adr/0027-vietnam-e-invoices.md`. Element names follow the format as
 * published and must be checked against the provider's current schema before
 * go-live — the format has been amended more than once.
 */

export type Party = {
  readonly name: string;
  /** Mã số thuế. Required of the seller; a buyer without one is a consumer. */
  readonly taxId: string | null;
  readonly address: string | null;
};

export type InvoiceLine = {
  readonly description: string;
  readonly unit: string;
  /** A decimal string, already at the item's precision. */
  readonly quantity: string;
  /** Net, in the invoice currency's minor units. */
  readonly amount: bigint;
  /** "10%", "8%", "5%", "0%", "KCT" (not subject), "KKKNT" (not declared). */
  readonly rate: string;
};

export type InvoiceReference = {
  readonly template: string;
  readonly series: string;
  readonly number: number;
  /** YYYY-MM-DD. */
  readonly issuedOn: string;
};

export type InvoiceDocument = {
  readonly kind: 'original' | 'adjustment';
  readonly reference: InvoiceReference;
  readonly currency: CurrencyCode;
  /** Dong per unit of the invoice currency, as a decimal string; "1" for dong. */
  readonly exchangeRate: string;
  /** "TM/CK": cash or transfer, the usual value. */
  readonly paymentMethod: string;
  readonly seller: Party;
  readonly buyer: Party;
  readonly lines: readonly InvoiceLine[];
  readonly net: bigint;
  readonly tax: bigint;
  /** For an adjustment: the invoice it adjusts, and why. */
  readonly adjusts?: (InvoiceReference & { readonly reason: string }) | undefined;
};

/**
 * `C26TAA`: C for an invoice the tax authority codes (K for one it does
 * not), the last two digits of the year, T for an enterprise registered to
 * issue e-invoices, and two letters the business chooses.
 */
export const SERIES_PATTERN = /^[CK]\d{2}[TDLMNBGH][A-Z]{2}$/u;

export function seriesFitsYear(series: string, issuedOn: string): boolean {
  return SERIES_PATTERN.test(series) && series.slice(1, 3) === issuedOn.slice(2, 4);
}

/** Seven digits, zero-padded, as the number prints on the invoice. */
export function invoiceNumber(number: number): string {
  return String(number).padStart(7, '0');
}

export function buildInvoiceXml(document: InvoiceDocument): string {
  const { reference, currency } = document;
  const money = (value: bigint) => toDecimalString(value as MinorUnits, currency);
  const gross = document.net + document.tax;
  const byRate = new Map<string, { net: bigint; tax: bigint }>();
  for (const line of document.lines) {
    const entry = byRate.get(line.rate) ?? { net: 0n, tax: 0n };
    entry.net += line.amount;
    byRate.set(line.rate, entry);
  }
  // The invoice's tax is split across rates in proportion; with one rate —
  // the ordinary case — it is simply the invoice's tax.
  const rates = [...byRate.entries()];
  if (rates.length === 1 && rates[0]) rates[0][1].tax = document.tax;

  const adjustment = document.adjusts
    ? element(
        'TTHDLQuan',
        [
          text('TCHDon', '2'),
          text('LHDCLQuan', '1'),
          text('KHMSHDCLQuan', document.adjusts.template),
          text('KHHDCLQuan', document.adjusts.series),
          text('SHDCLQuan', invoiceNumber(document.adjusts.number)),
          text('NLHDCLQuan', document.adjusts.issuedOn),
          text('GChu', document.adjusts.reason),
        ].join(''),
      )
    : '';

  const general = element(
    'TTChung',
    [
      text('PBan', '2.1.0'),
      text('THDon', 'Hóa đơn giá trị gia tăng'),
      text('KHMSHDon', reference.template),
      text('KHHDon', reference.series),
      text('SHDon', invoiceNumber(reference.number)),
      text('NLap', reference.issuedOn),
      text('DVTTe', currency),
      text('TGia', document.exchangeRate),
      text('HTTToan', document.paymentMethod),
      adjustment,
    ].join(''),
  );

  const party = (tag: string, who: Party) =>
    element(
      tag,
      [
        text('Ten', who.name),
        who.taxId ? text('MST', who.taxId) : '',
        who.address ? text('DChi', who.address) : '',
      ].join(''),
    );

  const lines = element(
    'DSHHDVu',
    document.lines
      .map((line, index) =>
        element(
          'HHDVu',
          [
            text('TChat', '1'),
            text('STT', String(index + 1)),
            text('THHDVu', line.description),
            text('DVTinh', line.unit),
            text('SLuong', line.quantity),
            text('DGia', unitPrice(line.amount, line.quantity, currency)),
            text('ThTien', money(line.amount)),
            text('TSuat', line.rate),
          ].join(''),
        ),
      )
      .join(''),
  );

  const totals = element(
    'TToan',
    [
      element(
        'THTTLTSuat',
        rates
          .map(([rate, figures]) =>
            element(
              'LTSuat',
              [
                text('TSuat', rate),
                text('ThTien', money(figures.net)),
                text('TThue', money(figures.tax)),
              ].join(''),
            ),
          )
          .join(''),
      ),
      text('TgTCThue', money(document.net)),
      text('TgTThue', money(document.tax)),
      text('TgTTTBSo', money(gross)),
      text('TgTTTBChu', amountInVietnameseWords(gross, currency)),
    ].join(''),
  );

  const body = element(
    'DLHDon',
    [
      general,
      element(
        'NDHDon',
        [party('NBan', document.seller), party('NMua', document.buyer), lines, totals].join(''),
      ),
    ].join(''),
    ' Id="data"',
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n<HDon>${body}<DSCKS><NBan/></DSCKS></HDon>\n`;
}

/**
 * Net per unit, to the currency's precision and four places more, rounded
 * half up — in integers, like every other amount here. A float would print
 * 1,250.00 of pavers at 12.5 m² as a price with a stray ninth decimal.
 */
export function unitPrice(amount: bigint, quantity: string, currency: CurrencyCode): string {
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(quantity);
  if (!match) return '0';
  const places = match[2]?.length ?? 0;
  const scaledQuantity = BigInt(`${match[1] ?? '0'}${match[2] ?? ''}`);
  if (scaledQuantity === 0n) return '0';
  const precision = exponentOf(currency) + 4;
  // amount is in 10^-exponent; price wanted in 10^-precision per whole unit.
  const numerator = amount * 10n ** BigInt(places + 4);
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const scaled = (magnitude * 2n + scaledQuantity) / (scaledQuantity * 2n);
  const digits = scaled.toString().padStart(precision + 1, '0');
  const whole = digits.slice(0, digits.length - precision);
  const fraction = digits.slice(digits.length - precision).replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function element(tag: string, content: string, attributes = ''): string {
  return `<${tag}${attributes}>${content}</${tag}>`;
}

function text(tag: string, value: string): string {
  return element(tag, escape(value));
}

function escape(value: string): string {
  return (
    value
      // Characters XML 1.0 forbids outright: most C0 controls, the two
      // non-characters and — `u` mode matches them only when unpaired — lone
      // surrogates. Left in, the provider rejects the whole invoice.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]|[\uD800-\uDFFF]/gu, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  );
}

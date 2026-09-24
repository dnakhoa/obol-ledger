import type { WriteOffReason } from '@/server/domain/costing';
import type { Locale } from './locales';

/**
 * The sentences the ledger writes into its own books.
 *
 * Kept apart from the interface dictionary on purpose, because they are a
 * different kind of thing. An interface string is a label on a button: change
 * the language and it changes with it, and nothing is lost. These become the
 * description on a posted entry — part of the accounting record, printed on a
 * report, handed to an auditor, and unchangeable afterwards because the entry
 * is append-only. They follow the *tenant's* language and are written once.
 *
 * Which is also why there is no fallback that quietly substitutes English: a
 * tenant whose locale is unrecognised gets English because English is the
 * column default, not because a lookup missed.
 */
export type LedgerMessages = {
  /** An entry that exists to undo another one. */
  readonly reversalOf: (description: string) => string;
  readonly closingEntry: (month: string) => string;
  readonly reopening: (month: string) => string;
  readonly revaluation: (month: string) => string;
  readonly stockReceived: (item: string, reference?: string | undefined) => string;
  readonly costOfGoodsSold: (item: string, reference?: string | undefined) => string;
  readonly importedDelivery: (reference?: string | undefined) => string;
  /** Freight, duty and handling put into the cost of the goods. */
  readonly landedCost: (description: string) => string;
  /** Stock that left without being sold, and why. */
  readonly stockWrittenOff: (
    item: string,
    reason: string,
    reference?: string | undefined,
  ) => string;
  readonly writeOffReason: (reason: WriteOffReason) => string;
  /** An invoice raised against stock: revenue and its cost in one entry. */
  readonly saleInvoiced: (reference: string, customer: string) => string;
  readonly creditNoteIssued: (reference: string, invoice: string, customer: string) => string;
};

const withReference = (base: string, reference?: string | undefined): string =>
  reference ? `${base} (${reference})` : base;

const en: LedgerMessages = {
  reversalOf: (description) => `Reversal of ${description}`,
  closingEntry: (month) => `Closing entry for ${month}`,
  reopening: (month) => `Reopening ${month}`,
  revaluation: (month) => `Foreign exchange revaluation, ${month}`,
  stockReceived: (item, reference) => withReference(`Stock received: ${item}`, reference),
  costOfGoodsSold: (item, reference) => withReference(`Cost of goods sold: ${item}`, reference),
  importedDelivery: (reference) => withReference('Imported delivery', reference),
  landedCost: (description) => `Landed cost: ${description}`,
  stockWrittenOff: (item, reason, reference) =>
    withReference(`Stock written off: ${item} — ${reason}`, reference),
  writeOffReason: (reason) =>
    ({
      damaged: 'damaged',
      expired: 'past its date',
      lost: 'lost',
      count_shortfall: 'short at stocktake',
      other: 'other',
    })[reason],
  saleInvoiced: (reference, customer) => `Sale ${reference} to ${customer}`,
  creditNoteIssued: (reference, invoice, customer) =>
    `Credit note ${reference} against ${invoice} — ${customer}`,
};

/**
 * The Vietnamese is written in the register an accountant uses on a voucher,
 * not translated from the English above.
 *
 * `Nhập kho` and `Xuất kho` are what the two stock movements are called — they
 * are the names of the vouchers themselves (phiếu nhập kho, phiếu xuất kho) —
 * and `Giá vốn hàng bán` is account 632 under Thông tư 200. A literal
 * rendering of "stock received" would be understood and would still read as
 * something a foreign system wrote.
 */
const vi: LedgerMessages = {
  reversalOf: (description) => `Bút toán điều chỉnh cho: ${description}`,
  closingEntry: (month) => `Bút toán kết chuyển cuối kỳ ${month}`,
  reopening: (month) => `Mở lại kỳ ${month}`,
  revaluation: (month) => `Đánh giá lại chênh lệch tỷ giá cuối kỳ ${month}`,
  stockReceived: (item, reference) => withReference(`Nhập kho: ${item}`, reference),
  costOfGoodsSold: (item, reference) => withReference(`Giá vốn hàng bán: ${item}`, reference),
  importedDelivery: (reference) => withReference('Nhập kho theo dữ liệu chuyển đổi', reference),
  landedCost: (description) => `Chi phí thu mua: ${description}`,
  // `Xuất hủy` is the voucher a Vietnamese warehouse raises for goods leaving
  // for any reason but a sale; the reason follows it the way it would on the
  // biên bản that justifies it.
  stockWrittenOff: (item, reason, reference) =>
    withReference(`Xuất hủy hàng hóa: ${item} — ${reason}`, reference),
  writeOffReason: (reason) =>
    ({
      damaged: 'hàng hỏng, vỡ',
      expired: 'hết hạn sử dụng',
      lost: 'mất mát',
      count_shortfall: 'thiếu khi kiểm kê',
      other: 'lý do khác',
    })[reason],
  saleInvoiced: (reference, customer) => `Bán hàng theo hóa đơn ${reference} — ${customer}`,
  creditNoteIssued: (reference, invoice, customer) =>
    `Giảm trừ doanh thu ${reference} cho hóa đơn ${invoice} — ${customer}`,
};

/**
 * 帳簿に記帳される文言。
 *
 * 反対仕訳, 月次決算振替仕訳 and 売上原価 are the terms that appear on a Japanese
 * voucher; the reference is wrapped in full-width parentheses because that is
 * what sits correctly beside full-width text.
 */
const ja: LedgerMessages = {
  reversalOf: (description) => `反対仕訳：${description}`,
  closingEntry: (month) => `${month} 月次決算振替仕訳`,
  reopening: (month) => `${month} の締めを解除`,
  revaluation: (month) => `${month} 為替換算差損益の計上`,
  stockReceived: (item, reference) =>
    reference ? `入庫：${item}（${reference}）` : `入庫：${item}`,
  costOfGoodsSold: (item, reference) =>
    reference ? `売上原価：${item}（${reference}）` : `売上原価：${item}`,
  importedDelivery: (reference) =>
    reference ? `データ移行による入庫（${reference}）` : 'データ移行による入庫',
  landedCost: (description) => `仕入諸掛：${description}`,
  stockWrittenOff: (item, reason, reference) =>
    reference ? `商品廃棄：${item}（${reason}・${reference}）` : `商品廃棄：${item}（${reason}）`,
  // 棚卸減耗 is the term for a stocktake shortfall on a Japanese voucher; the
  // others are the plain words a warehouse uses.
  writeOffReason: (reason) =>
    ({
      damaged: '破損',
      expired: '期限切れ',
      lost: '紛失',
      count_shortfall: '棚卸減耗',
      other: 'その他',
    })[reason],
  saleInvoiced: (reference, customer) => `売上：${reference}（${customer}）`,
  creditNoteIssued: (reference, invoice, customer) =>
    `返品・値引：${reference}（${invoice}・${customer}）`,
};

const LEDGER: Record<Locale, LedgerMessages> = { en, vi, ja };

export function ledgerMessages(locale: Locale): LedgerMessages {
  return LEDGER[locale] ?? en;
}

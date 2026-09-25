import type { AccountType } from '@/server/domain/account';
import type { ChartTemplate } from '@/server/domain/chart';
import type { CostingMethod } from '@/server/domain/costing';
import type { LedgerError, LedgerErrorCode } from '@/server/domain/errors';
import type { TaxTreatment } from '@/server/domain/tax';
import type { TransactionStatus } from '@/server/domain/transaction-status';
import { groupDecimalString } from '../format';
import { isUnit, toQuantityString, unitLabel } from '../quantity';
import { dateFormats } from './dates';
import type { Locale } from './locales';
import { separatorsFor } from './separators';

/**
 * The ledger's refusals, in the reader's language.
 *
 * English is not in here, and that is the point rather than an omission. The
 * English sentence is `describe()` in `src/server/domain/errors.ts`, which the
 * HTTP API returns as the `detail` of a problem document and which stays
 * English for the integrator reading it (ADR 14). Keeping a second copy here
 * would give that sentence two owners, and the first edit to one of them
 * would make the dashboard and the API disagree about why a request failed.
 * So this module holds only the translations, and `describeError` in
 * `src/server/i18n.ts` — which is allowed to import the domain at runtime,
 * where `lib/` is not — picks between them.
 *
 * Every variant has an entry in every language, and each entry receives its
 * own variant, already narrowed. A new `LedgerError` without a Vietnamese and
 * a Japanese sentence does not compile.
 */
export type ErrorMessages = {
  readonly [Code in LedgerErrorCode]: (error: Extract<LedgerError, { code: Code }>) => string;
};

/** Every language except the one `describe()` already speaks. */
export type TranslatedLocale = Exclude<Locale, 'en'>;

/**
 * Figures, dates and units written the way the rest of the screen writes
 * them, so the number in the message is the number beside it.
 *
 * Money goes through the locale's separators, as every amount on the page
 * does — `10,00 USD` in Vietnamese. Quantities do not: the stock screens show
 * `24.687` in every language, and an error that wrote `24,687` beside it
 * would read as a different quantity, which in Vietnamese it would be.
 */
function writing(locale: TranslatedLocale) {
  const separators = separatorsFor(locale);
  const dates = dateFormats(locale);

  // Periods arrive as `2026-08-01` and dates as `2026-03-31`. Anything else is
  // quoted as it came, since an error is the worst place to throw a second one.
  const asDate = (value: string): Date | undefined =>
    /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00.000Z`) : undefined;

  return {
    money: (value: string) => groupDecimalString(value, separators),
    quantity: (scaled: string, precision: number) =>
      /^-?\d+$/u.test(scaled) ? toQuantityString(BigInt(scaled), precision) : scaled,
    unit: (unit: string) => (isUnit(unit) ? unitLabel(unit) : unit),
    month: (value: string) => {
      const date = asDate(value);
      return date ? dates.month(date) : value;
    },
    day: (value: string) => {
      const date = asDate(value);
      return date ? dates.day(date) : value;
    },
  };
}

/** A name from a closed list, or the raw value if the list has grown since. */
function named<Key extends string>(names: Record<Key, string>, key: string): string {
  return Object.hasOwn(names, key) ? names[key as Key] : key;
}

const vn = writing('vi');

/** `Tháng 8/2026` heads a table column; inside a sentence it is `kỳ tháng 8/2026`. */
const viPeriod = (value: string) => `kỳ ${vn.month(value).toLowerCase()}`;
const viPeriodOpening = (value: string) => `Kỳ ${vn.month(value).toLowerCase()}`;

const VI_STATUS: Record<TransactionStatus, string> = {
  pending: 'chờ xử lý',
  posted: 'đã ghi sổ',
  archived: 'đã hủy',
};

const VI_ACCOUNT_TYPE: Record<AccountType, string> = {
  asset: 'tài sản',
  liability: 'nợ phải trả',
  equity: 'vốn chủ sở hữu',
  revenue: 'doanh thu',
  expense: 'chi phí',
};

/** Named as Thông tư 200 names them, which is what an accountant will recognise. */
const VI_METHOD: Record<CostingMethod, string> = {
  fifo: 'nhập trước, xuất trước',
  weighted_average: 'bình quân gia quyền',
  specific: 'thực tế đích danh',
  lifo: 'nhập sau, xuất trước (LIFO)',
};

const VI_CHART: Record<ChartTemplate, string> = {
  generic: 'hệ thống tài khoản chung (theo IFRS)',
  au_nz: 'hệ thống tài khoản của Úc và New Zealand',
  us_gaap: 'hệ thống tài khoản theo US GAAP',
  jp: 'hệ thống tài khoản của Nhật Bản',
  vn_tt200: 'hệ thống tài khoản theo Thông tư 200',
  vn_tt133: 'hệ thống tài khoản theo Thông tư 133',
};

const VI_TREATMENT: Record<TaxTreatment, string> = {
  vat: 'thuế GTGT',
  reverse_charge: 'thuế nhà thầu nước ngoài',
  sales_tax: 'thuế bán hàng (Hoa Kỳ)',
};

/**
 * Written as the accountant would say it, not as the English is built.
 *
 * A posting is a *dòng hạch toán*, a reversal is *ghi đảo* and produces a
 * *bút toán điều chỉnh*, a period is *khóa sổ*, and input and output VAT are
 * *thuế GTGT đầu vào* and *đầu ra* — the words already on the screens these
 * messages appear on. Where the English names a role by its identifier
 * (`retained_earnings`), the Vietnamese names the account it means and keeps
 * the identifier, because that is what the settings screen will show.
 */
const vi: ErrorMessages = {
  account_not_found: (e) => `Không tìm thấy tài khoản có mã ${e.accountId}.`,
  account_closed: (e) => `Tài khoản ${e.accountId} đã đóng, không thể ghi sổ vào tài khoản này.`,
  currency_mismatch: (e) =>
    e.accountId
      ? `Tài khoản ${e.accountId} được theo dõi bằng ${e.expected}, không phải ${e.received}.`
      : `Cần ${e.expected} nhưng lại nhận được ${e.received}.`,
  unbalanced_transaction: (e) =>
    `Tổng Nợ và tổng Có chênh lệch ${vn.money(e.residual)} ${e.currency}; một bút toán cân đối thì chênh lệch phải bằng 0.`,
  too_few_postings: (e) =>
    `Bút toán kép cần ít nhất hai dòng hạch toán, bút toán này chỉ có ${e.count}.`,
  zero_amount_posting: (e) =>
    `Dòng hạch toán ở vị trí ${e.index} có số tiền bằng 0, nên không ghi nhận được gì.`,
  duplicate_account_in_transaction: (e) =>
    `Tài khoản ${e.accountId} xuất hiện nhiều lần trong bút toán; hãy gộp các dòng đó thành một.`,
  insufficient_funds: (e) =>
    `Tài khoản ${e.accountId} chỉ còn ${vn.money(e.available)} ${e.currency} nhưng cần ${vn.money(e.requested)} ${e.currency}, và tài khoản này không được phép chi vượt số dư.`,
  idempotency_key_reused: (e) =>
    `Khóa chống trùng lặp ${e.key} đã được dùng cho một yêu cầu có nội dung khác.`,
  entry_not_found: (e) => `Không tìm thấy bút toán có mã ${e.transactionId}.`,
  entry_not_settled: (e) =>
    e.entryStatus === 'pending'
      ? `Bút toán ${e.transactionId} vẫn đang chờ xử lý, nên chưa có tiền nào dịch chuyển để điều chỉnh. Hãy hủy bút toán thay vì điều chỉnh.`
      : `Bút toán ${e.transactionId} đã bị hủy trước khi hoàn tất, nên không có tiền nào dịch chuyển và không có gì để điều chỉnh.`,
  already_reversed: (e) =>
    `Bút toán ${e.transactionId} đã được ghi đảo bằng bút toán ${e.reversedBy}; ghi đảo thêm lần nữa sẽ làm khoản điều chỉnh bị tính hai lần.`,
  invalid_status_transition: (e) =>
    e.from === 'pending'
      ? `Bút toán ${e.transactionId} không thể chuyển từ “${named(VI_STATUS, e.from)}” sang “${named(VI_STATUS, e.to)}”; bút toán đang chờ xử lý chỉ có thể được ghi sổ hoặc hủy.`
      : `Bút toán ${e.transactionId} ${named(VI_STATUS, e.from)} nên không thể thay đổi nữa. Hãy ghi một bút toán điều chỉnh.`,
  stale_account_version: (e) =>
    `Tài khoản ${e.accountId} đang ở phiên bản ${e.actual}, không phải ${e.expected}; tài khoản đã thay đổi kể từ lúc bạn mở. Hãy tải lại rồi thử lại.`,
  endpoint_not_found: (e) => `Không tìm thấy địa chỉ nhận webhook có mã ${e.endpointId}.`,
  endpoint_url_taken: (e) =>
    `${e.url} đã được đăng ký. Hãy cập nhật các sự kiện mà địa chỉ đó đăng ký nhận thay vì thêm địa chỉ thứ hai, nếu không mọi sự kiện sẽ bị gửi hai lần.`,
  delivery_not_found: (e) => `Không tìm thấy lượt gửi webhook có mã ${e.deliveryId}.`,
  period_already_closed: (e) =>
    `${viPeriodOpening(e.periodMonth)} đã khóa sổ. Hãy mở lại kỳ này trước khi khóa sổ lần nữa.`,
  period_not_closed: (e) =>
    `${viPeriodOpening(e.periodMonth)} chưa khóa sổ, nên không có gì để mở lại.`,
  period_not_finished: (e) =>
    `${viPeriodOpening(e.periodMonth)} chưa kết thúc. Khóa sổ lúc này sẽ chặn cả những nghiệp vụ chưa phát sinh.`,
  earlier_period_open: (e) =>
    `${viPeriodOpening(e.open)} vẫn chưa khóa sổ. Khóa sổ ${viPeriod(e.periodMonth)} trước sẽ kết chuyển lợi nhuận của một tháng chưa khóa sang tháng sau, nên các kỳ phải được khóa sổ theo thứ tự.`,
  retained_earnings_missing: () =>
    'Chưa có tài khoản nào được chỉ định là lợi nhuận sau thuế chưa phân phối, nên lợi nhuận của kỳ không có chỗ để kết chuyển. Hãy gán vai trò retained_earnings cho một tài khoản vốn chủ sở hữu.',
  fx_rate_required: (e) =>
    `Tài khoản ${e.accountId} được theo dõi bằng ${e.currency}, còn sổ sách ghi bằng ${e.functional}. Hãy nhập tỷ giá hoặc số tiền quy đổi ra ${e.functional} cho dòng hạch toán đó — tự đoán tỷ giá thì sổ vẫn cân nhưng số liệu sai sự thật.`,
  invalid_fx_rate: (e) =>
    `“${e.rate}” không phải là số dương có tối đa mười chữ số thập phân, nên không dùng làm tỷ giá cho dòng hạch toán vào tài khoản ${e.accountId} được.`,
  rate_not_found: (e) =>
    `Chưa có tỷ giá ${e.base}/${e.quote} nào vào ngày đó hoặc trước ngày đó. Hãy nhập tỷ giá, hoặc ghi tỷ giá kèm theo bút toán.`,
  amount_not_representable: (e) =>
    `Số tiền “${e.amount}” không ghi được bằng ${e.currency}, là loại tiền của tài khoản ${e.accountId}.`,
  revaluation_required: (e) =>
    `${viPeriodOpening(e.periodMonth)} còn số dư ngoại tệ (${e.accounts.join(', ')}) chưa được đánh giá lại theo tỷ giá cuối kỳ. Khóa sổ lúc này sẽ chốt một bảng cân đối kế toán theo tỷ giá đã cũ. Hãy đánh giá lại chênh lệch tỷ giá cho kỳ này trước đã.`,
  fx_account_missing: () =>
    'Chưa có tài khoản nào được chỉ định để ghi nhận chênh lệch tỷ giá, nên khoản chênh lệch không có chỗ để hạch toán. Hãy gán vai trò fx_gain_loss cho một tài khoản doanh thu hoặc chi phí.',
  currency_imbalance: (e) =>
    `Các dòng hạch toán bằng ${e.currency} cộng lại được ${vn.money(e.residual)} thay vì bằng 0. Chênh lệch tỷ giá chỉ được xử lý khi từng loại tiền đã tự cân đối — nếu không, bút toán điều chỉnh sẽ che mất một số tiền bị nhập sai.`,
  item_not_found: (e) => `Không tìm thấy mặt hàng có mã ${e.itemId}.`,
  item_archived: (e) =>
    `Mặt hàng ${e.itemId} đã ngừng theo dõi, nên không nhập kho hay xuất kho được. Hãy mở lại mặt hàng trước.`,
  sku_taken: (e) =>
    `Mã hàng ${e.sku} đã được dùng cho một mặt hàng khác. Phiếu nhập kho và phiếu xuất kho dựa vào mã hàng để biết hàng nào đã dịch chuyển, nên mã hàng không được trùng.`,
  insufficient_stock: (e) =>
    `Chỉ còn ${vn.quantity(e.available, e.precision)} ${vn.unit(e.unit)} tồn kho, nhưng cần xuất ${vn.quantity(e.requested, e.precision)} ${vn.unit(e.unit)}. Chưa có gì được ghi sổ — hãy lập phiếu nhập kho còn thiếu, hoặc sửa lại số lượng.`,
  cost_layer_not_found: (e) => `Không tìm thấy lô có mã ${e.layerId}. Có thể lô này đã xuất hết.`,
  cost_layer_required: (e) =>
    `Mặt hàng ${e.itemId} tính giá xuất kho theo phương pháp thực tế đích danh, nên phải chỉ rõ xuất từ lô nào. Đó chính là ý nghĩa của phương pháp này: hàng của lô này không thay thế được cho hàng của lô bên cạnh.`,
  costing_method_not_permitted: (e) =>
    `Không được dùng phương pháp ${named(VI_METHOD, e.method)} với ${named(VI_CHART, e.chartTemplate)}. LIFO được phép theo US GAAP nhưng bị cấm theo IFRS và chế độ kế toán Việt Nam, nên chỉ sổ sách theo chuẩn mực Hoa Kỳ mới dùng được.`,
  inventory_account_not_functional: (e) =>
    `Tài khoản ${e.accountId} được theo dõi bằng ${e.currency}, trong khi hàng tồn kho phải ghi sổ bằng ${e.functional}. Hàng tồn kho là khoản mục phi tiền tệ: giá trị ghi sổ được cố định theo tỷ giá ngày nhập kho, nên nếu chính tài khoản đó tính bằng ngoại tệ thì sẽ phải đánh giá lại một con số không bao giờ được thay đổi.`,
  account_wrong_type: (e) =>
    `Tài khoản ${e.accountId} là tài khoản ${named(VI_ACCOUNT_TYPE, e.actual)}, trong khi ở đây cần tài khoản ${named(VI_ACCOUNT_TYPE, e.expected)}.`,
  shipment_reference_taken: (e) =>
    `Số tham chiếu ${e.reference} đã được dùng cho một lô hàng khác. Hóa đơn cước vận chuyển dựa vào số tham chiếu để tìm đúng container, nên số này không được trùng.`,
  shipment_not_found: (e) => `Không tìm thấy lô hàng có mã ${e.shipmentId}.`,
  shipment_has_no_stock: (e) =>
    `Lô hàng ${e.shipmentId} chưa có lần nhập kho nào, nên khoản chi phí này không có hàng để phân bổ vào. Hãy nhập kho hàng về trước.`,
  mixed_units: (e) =>
    `Các lô này đo bằng ${e.units.map(vn.unit).join(' và ')}, nên không phân bổ chi phí theo số lượng được — làm vậy là cộng đơn vị này với đơn vị kia. Hãy phân bổ theo giá trị hoặc theo trọng lượng.`,
  weight_missing: (e) =>
    `Có ${e.layerIds.length} lô trong lô hàng này chưa ghi trọng lượng, và coi chúng như không có trọng lượng sẽ dồn toàn bộ chi phí sang các lô còn lại. Hãy ghi trọng lượng, hoặc phân bổ theo giá trị.`,
  debit_account_required: () =>
    'Khoản chi phí không tính vào giá gốc hàng hóa — chẳng hạn thuế GTGT hàng nhập khẩu được khấu trừ — cần có tài khoản riêng để ghi Nợ.',
  tax_code_name_taken: (e) => `Đã có một thuế suất khác tên là ${e.name}.`,
  tax_code_not_found: (e) => `Không tìm thấy thuế suất đang sử dụng nào có ID ${e.taxCodeId}.`,
  sales_tax_is_not_reclaimable: () =>
    'Thuế bán hàng (sales tax) của Hoa Kỳ không bao giờ được khấu trừ khi mua hàng, nên thuế suất loại này không có tài khoản thuế đầu vào. Nếu gán cho nó một tài khoản, doanh nghiệp sẽ tích lũy một khoản phải thu từ một bang không hề nợ mình — sổ sách vẫn cân đối hoàn toàn trong khi tài sản đó là không có thật.',
  tax_account_missing: (e) =>
    `Thuế suất này (loại ${named(VI_TREATMENT, e.treatment)}) chưa có tài khoản thuế ${e.side === 'input' ? 'đầu vào' : 'đầu ra'}, nên không hạch toán được phần đó của bút toán.`,
  period_already_filed: (e) =>
    `${viPeriodOpening(e.periodMonth)} đã nằm trong một tờ khai đã nộp. Tờ khai là chứng từ và không bao giờ bị sửa — muốn thay đổi, hãy nộp tờ khai bổ sung cho cùng kỳ.`,
  tax_payable_account_missing: () =>
    'Khi nộp tờ khai, số thuế phải nộp được kết chuyển khỏi các tài khoản thuế sang một khoản nợ mà doanh nghiệp thực sự thanh toán, nên trước hết phải có tài khoản thuế phải nộp Nhà nước.',
  nothing_to_file: (e) =>
    `Từ ${vn.day(e.periodStart)} đến ${vn.day(e.periodEnd)} không phát sinh thuế đầu ra hay đầu vào nào, nên không có gì để kê khai.`,
  earlier_return_unfiled: (e) =>
    `${viPeriodOpening(e.unfiled)} chưa được kê khai, và kê khai ${viPeriod(e.periodMonth)} trước sẽ làm mất số thuế còn được khấu trừ của kỳ đó — số thuế chưa khấu trừ hết được chuyển sang tờ khai kỳ sau, nên các tờ khai phải được nộp theo thứ tự.`,
  entry_owned_by_stock: (e) =>
    `Bút toán ${e.transactionId} do sổ kho ghi, nên đảo nó ở đây sẽ thay đổi tài khoản mà không thay đổi các lô hàng đứng sau — và từ đó hai bên sẽ lệch nhau mà không còn gì giải thích vì sao. Hãy điều chỉnh từ trang kho: xuất hủy, hoặc bổ sung chi phí cho lô hàng.`,
  sale_has_no_lines: () =>
    'Hóa đơn không có dòng hàng nào thì không xuất kho và không có doanh thu. Hãy thêm các mặt hàng được bán.',
  sale_reference_taken: (e) =>
    `Hóa đơn số ${e.reference} đã được lập. Mỗi số hóa đơn chỉ dùng một lần — hai hóa đơn trùng số là cách để khách trả một hóa đơn trong khi báo cáo tuổi nợ mãi mãi coi hóa đơn kia là chưa thanh toán.`,
  sale_not_found: (e) => `Không tìm thấy hóa đơn bán hàng có mã ${e.saleId}.`,
  due_before_invoice: (e) =>
    `Hóa đơn lập ngày ${e.invoicedOn} nhưng hạn thanh toán là ${e.dueOn}, sớm hơn ngày lập. Thường đó là gõ nhầm năm, và nó sẽ khiến một hóa đơn vừa lập bị tính là quá hạn nhiều tháng.`,
  account_code_required: (e) =>
    `${capitalise(VI_CHART[e.chartTemplate as ChartTemplate] ?? e.chartTemplate)} quy định số hiệu cho mọi tài khoản — theo Thông tư 200, chữ số đầu chính là loại tài khoản — nên tài khoản này cũng cần một số hiệu.`,
  account_code_disagrees: (e) =>
    `Theo Thông tư 200, chữ số đầu của số hiệu là loại tài khoản, và ${e.accountCode} không bắt đầu bằng chữ số của loại này: 1 và 2 là tài sản, 3 là nợ phải trả, 4 là vốn chủ sở hữu, 5 và 7 là doanh thu, 6 và 8 là chi phí.`,
  account_code_taken: (e) =>
    `Đã có tài khoản khác mang số hiệu ${e.accountCode}. Mỗi số hiệu chỉ gắn với một tài khoản, nếu không báo cáo sắp theo số hiệu sẽ gộp hai tài khoản vào một chỗ.`,
  open_items_not_permitted: () =>
    'Chỉ khoản phải thu hoặc phải trả mới có công nợ để theo dõi theo tuổi nợ. Tài khoản loại này không có tuổi nợ.',
  payment_terms_need_open_items: () =>
    'Thời hạn thanh toán cho biết khi nào khách hàng hoặc nhà cung cấp phải trả, nên chỉ có nghĩa với tài khoản theo dõi công nợ. Hãy đánh dấu ô đó, hoặc để trống thời hạn.',
  credit_note_reference_taken: (e) => `Số phiếu ${e.reference} đã được dùng. Hãy chọn số khác.`,
  credit_note_not_found: (e) => `Không tìm thấy phiếu giảm trừ ${e.creditNoteId}.`,
  credit_note_has_no_lines: () =>
    'Hãy nhập số lượng trả lại hoặc số tiền giảm cho ít nhất một dòng.',
  credit_line_not_on_sale: (e) => `Dòng này không thuộc hóa đơn ${e.saleId}.`,
  credit_line_repeated: () => 'Một dòng hóa đơn bị nhập hai lần. Hãy gộp thành một dòng.',
  credit_exceeds_sale: (e) =>
    e.limit === 'quantity'
      ? `${e.sku} chỉ còn ${vn.quantity(e.remaining, e.precision)} ${vn.unit(e.unit)} có thể trả lại; bạn đã nhập ${vn.quantity(e.requested, e.precision)}.`
      : `${e.sku} chỉ còn ${vn.money(e.remaining)} ${e.currency} có thể giảm; bạn đã nhập ${vn.money(e.requested)}.`,
  credit_before_sale: (e) =>
    `Ngày phiếu giảm trừ không được trước ngày hóa đơn (${vn.day(e.invoicedOn)}).`,
  supplier_return_reference_taken: (e) =>
    `Số phiếu trả hàng ${e.reference} đã được dùng. Hãy chọn số khác.`,
  supplier_return_not_found: (e) => `Không tìm thấy phiếu trả hàng ${e.supplierReturnId}.`,
  supplier_refund_exceeds_lot: (e) =>
    `Lô hàng này chỉ còn ${vn.money(e.remaining)} ${e.currency} có thể được hoàn; bạn đã nhập ${vn.money(e.requested)}.`,
  supplier_return_before_receipt: (e) =>
    `Ngày trả hàng không được trước ngày nhận lô hàng (${vn.day(e.receivedOn)}).`,
  supplier_return_tax_needs_local_currency: (e) =>
    `Lô hàng này mua bằng ${e.currency}. Chỉ điều chỉnh thuế được cho hàng mua bằng ${e.functional}; thuế nhập khẩu được khấu trừ qua hải quan, không qua nhà cung cấp.`,
  supplier_account_required: () => 'Hãy chọn tài khoản nhà cung cấp hoặc ngân hàng nhận lại tiền.',
  supplier_return_exceeds_lot: (e) =>
    `Lô hàng này chỉ còn ${vn.quantity(e.remaining, e.precision)} ${vn.unit(e.unit)} có thể trả lại; bạn đã nhập ${vn.quantity(e.requested, e.precision)}.`,
};

const jp = writing('ja');

const JA_STATUS: Record<TransactionStatus, string> = {
  pending: '未決済',
  posted: '記帳済み',
  archived: '取消済み',
};

const JA_ACCOUNT_TYPE: Record<AccountType, string> = {
  asset: '資産',
  liability: '負債',
  equity: '純資産',
  revenue: '収益',
  expense: '費用',
};

const JA_METHOD: Record<CostingMethod, string> = {
  fifo: '先入先出法',
  weighted_average: '移動平均法',
  specific: '個別法',
  lifo: '後入先出法（LIFO）',
};

const JA_CHART: Record<ChartTemplate, string> = {
  generic: '汎用（IFRS準拠）',
  au_nz: 'オーストラリア・ニュージーランド',
  us_gaap: '米国会計基準',
  jp: '日本基準',
  vn_tt200: 'ベトナム（通達200号）',
  vn_tt133: 'ベトナム（通達133号）',
};

const JA_TREATMENT: Record<TaxTreatment, string> = {
  vat: '消費税',
  reverse_charge: 'リバースチャージ',
  sales_tax: '売上税（米国）',
};

/**
 * 仕訳, 勘定科目, 締め and 仮払・仮受消費税 are the words on a Japanese voucher
 * and on the screens around these messages, so the sentences are built from
 * them rather than from the English. Polite form throughout, because the
 * reader is being told why their own button did nothing.
 *
 * The LIFO sentence says one thing the English does not: a Japanese reader
 * will know LIFO from before 2010, when JGAAP still allowed it, and deserves
 * to be told that their own standard withdrew it too.
 */
const ja: ErrorMessages = {
  account_not_found: (e) => `ID ${e.accountId} の勘定科目が見つかりません。`,
  account_closed: (e) => `勘定科目 ${e.accountId} は閉鎖されているため、記帳できません。`,
  currency_mismatch: (e) =>
    e.accountId
      ? `勘定科目 ${e.accountId} の通貨は ${e.expected} で、${e.received} ではありません。`
      : `${e.expected} が必要ですが、${e.received} が指定されました。`,
  unbalanced_transaction: (e) =>
    `借方と貸方の差額が ${jp.money(e.residual)} ${e.currency} あります。貸借が一致した仕訳だけが記帳できます。`,
  too_few_postings: (e) => `複式簿記の仕訳には2行以上が必要ですが、この仕訳は ${e.count} 行です。`,
  zero_amount_posting: (e) => `位置 ${e.index} の仕訳行は金額がゼロのため、何も記録されません。`,
  duplicate_account_in_transaction: (e) =>
    `勘定科目 ${e.accountId} が複数の行に使われています。1行にまとめてください。`,
  insufficient_funds: (e) =>
    `勘定科目 ${e.accountId} の残高は ${jp.money(e.available)} ${e.currency} ですが、${jp.money(e.requested)} ${e.currency} が必要です。この勘定科目は残高を超える払出しが認められていません。`,
  idempotency_key_reused: (e) =>
    `冪等キー ${e.key} は、内容の異なるリクエストで既に使用されています。`,
  entry_not_found: (e) => `ID ${e.transactionId} の仕訳が見つかりません。`,
  entry_not_settled: (e) =>
    e.entryStatus === 'pending'
      ? `仕訳 ${e.transactionId} はまだ未決済で、訂正すべき資金の移動がありません。訂正ではなく取り消してください。`
      : `仕訳 ${e.transactionId} は決済前に取り消されたため、資金は動いておらず、訂正するものはありません。`,
  already_reversed: (e) =>
    `仕訳 ${e.transactionId} には既に反対仕訳 ${e.reversedBy} が起票されています。もう一度起票すると訂正が二重になります。`,
  invalid_status_transition: (e) =>
    e.from === 'pending'
      ? `仕訳 ${e.transactionId} を「${named(JA_STATUS, e.from)}」から「${named(JA_STATUS, e.to)}」に変更することはできません。未決済の仕訳は、記帳するか取り消すことしかできません。`
      : `仕訳 ${e.transactionId} は既に「${named(JA_STATUS, e.from)}」のため変更できません。反対仕訳を起票してください。`,
  stale_account_version: (e) =>
    `勘定科目 ${e.accountId} のバージョンは ${e.expected} ではなく ${e.actual} です。読み込んだ後に変更されています。再読み込みしてからやり直してください。`,
  endpoint_not_found: (e) => `ID ${e.endpointId} の Webhook 送信先が見つかりません。`,
  endpoint_url_taken: (e) =>
    `${e.url} は既に登録されています。2つ目を追加するとすべてのイベントが二重に届くため、既存の送信先の購読内容を更新してください。`,
  delivery_not_found: (e) => `ID ${e.deliveryId} の Webhook 配信が見つかりません。`,
  period_already_closed: (e) =>
    `${jp.month(e.periodMonth)}は既に締められています。もう一度締めるには、先に締めを解除してください。`,
  period_not_closed: (e) =>
    `${jp.month(e.periodMonth)}は締められていないため、解除するものはありません。`,
  period_not_finished: (e) =>
    `${jp.month(e.periodMonth)}はまだ終わっていません。今締めると、これから発生する取引を記帳できなくなります。`,
  earlier_period_open: (e) =>
    `${jp.month(e.open)}がまだ締められていません。先に${jp.month(e.periodMonth)}を締めると、締めていない月の損益が翌月に持ち越されるため、会計期間は古い順に締めてください。`,
  retained_earnings_missing: () =>
    '繰越利益剰余金に指定された勘定科目がないため、当期の損益の振替先がありません。純資産の勘定科目のいずれかに retained_earnings の役割を設定してください。',
  fx_rate_required: (e) =>
    `勘定科目 ${e.accountId} は ${e.currency} 建てで、帳簿は ${e.functional} で記帳されています。その行の為替レートか ${e.functional} 換算額を入力してください。レートを推測すると、貸借は一致しても事実と異なる帳簿になります。`,
  invalid_fx_rate: (e) =>
    `「${e.rate}」は小数点以下10桁以内の正の数ではないため、勘定科目 ${e.accountId} への仕訳行の為替レートとして使えません。`,
  rate_not_found: (e) =>
    `その日付以前の ${e.base}/${e.quote} の為替レートが登録されていません。レートを登録するか、仕訳と一緒に入力してください。`,
  amount_not_representable: (e) =>
    `金額「${e.amount}」は、勘定科目 ${e.accountId} の通貨である ${e.currency} では表せません。`,
  revaluation_required: (e) =>
    `${jp.month(e.periodMonth)}には期末レートで換算替えしていない外貨建て残高（${e.accounts.join('、')}）があります。今締めると、古いレートの貸借対照表が確定してしまいます。先に外貨建て残高の換算替えを行ってください。`,
  fx_account_missing: () =>
    '為替差損益に指定された勘定科目がないため、為替差額の計上先がありません。収益または費用の勘定科目のいずれかに fx_gain_loss の役割を設定してください。',
  currency_imbalance: (e) =>
    `${e.currency} の仕訳行の合計がゼロではなく ${jp.money(e.residual)} です。為替差額を調整できるのは通貨ごとに貸借が一致している場合だけです。そうでなければ、入力ミスの金額が調整に紛れて見えなくなります。`,
  item_not_found: (e) => `ID ${e.itemId} の品目が見つかりません。`,
  item_archived: (e) =>
    `品目 ${e.itemId} は使用を停止しているため、入庫も出庫もできません。先に使用を再開してください。`,
  sku_taken: (e) =>
    `品目コード ${e.sku} は既に別の品目で使われています。入出庫は品目コードで対象を特定するため、重複できません。`,
  insufficient_stock: (e) =>
    `在庫は ${jp.quantity(e.available, e.precision)} ${jp.unit(e.unit)} しかありませんが、${jp.quantity(e.requested, e.precision)} ${jp.unit(e.unit)} の出庫が指定されました。何も記帳していません。記録漏れの入庫を登録するか、数量を修正してください。`,
  cost_layer_not_found: (e) =>
    `ID ${e.layerId} のロットが見つかりません。既に全量を出庫している可能性があります。`,
  cost_layer_required: (e) =>
    `品目 ${e.itemId} は個別法で評価しているため、出庫するロットを指定してください。それがこの方法の意味です。このロットの品は、隣のロットの品と置き換えられません。`,
  costing_method_not_permitted: (e) =>
    `${named(JA_METHOD, e.method)}は${named(JA_CHART, e.chartTemplate)}の帳簿では使用できません。LIFO は米国会計基準では認められていますが、IFRS とベトナムの会計基準では禁止されており（日本基準でも2010年に廃止）、米国の帳簿でのみ利用できます。`,
  inventory_account_not_functional: (e) =>
    `勘定科目 ${e.accountId} は ${e.currency} 建てですが、棚卸資産は ${e.functional} で計上する必要があります。棚卸資産は非貨幣性項目で、帳簿価額は入庫日のレートで確定します。勘定科目そのものを外貨建てにすると、決して動かしてはならない金額を換算替えすることになります。`,
  account_wrong_type: (e) =>
    `勘定科目 ${e.accountId} は${named(JA_ACCOUNT_TYPE, e.actual)}の科目ですが、ここでは${named(JA_ACCOUNT_TYPE, e.expected)}の科目が必要です。`,
  shipment_reference_taken: (e) =>
    `伝票番号 ${e.reference} は既に別の船積で使われています。運賃の請求書はこの番号で該当するコンテナを特定するため、重複できません。`,
  shipment_not_found: (e) => `ID ${e.shipmentId} の船積が見つかりません。`,
  shipment_has_no_stock: (e) =>
    `船積 ${e.shipmentId} には入荷が登録されていないため、この費用を按分する先がありません。先に入荷を登録してください。`,
  mixed_units: (e) =>
    `これらのロットは ${e.units.map(jp.unit).join(' と ')} で計量されているため、数量基準では按分できません。異なる単位を足し合わせることになるためです。価額基準か重量基準で按分してください。`,
  weight_missing: (e) =>
    `この船積のロットのうち ${e.layerIds.length} 件に重量が記録されていません。重量ゼロとして扱うと、費用の全額が残りのロットに按分されてしまいます。重量を記録するか、価額基準で按分してください。`,
  debit_account_required: () =>
    '取得原価に含めない費用（控除対象の輸入消費税など）には、借方に計上する専用の勘定科目が必要です。',
  tax_code_name_taken: (e) => `「${e.name}」という名称の税率は既に登録されています。`,
  tax_code_not_found: (e) => `ID ${e.taxCodeId} の有効な税率が見つかりません。`,
  sales_tax_is_not_reclaimable: () =>
    '米国の売上税は仕入時に控除されることがないため、売上税の税率には仮払側の勘定科目がありません。設定すると、支払義務のない州に対する債権が積み上がり、貸借は一致したまま架空の資産が計上されます。',
  tax_account_missing: (e) =>
    `この${named(JA_TREATMENT, e.treatment)}の税率には${e.side === 'input' ? '仮払消費税' : '仮受消費税'}の勘定科目が設定されていないため、仕訳のその側を計上できません。`,
  period_already_filed: (e) =>
    `${jp.month(e.periodMonth)}は既に申告済みの期間に含まれています。申告書は証憑として残すもので、書き換えません。変更するには、同じ期間の修正申告を行ってください。`,
  tax_payable_account_missing: () =>
    '申告すると、納付すべき税額は仮受・仮払の勘定から、実際に支払う一つの負債へ振り替えられます。そのため、先に未払消費税等の勘定科目が必要です。',
  nothing_to_file: (e) =>
    `${jp.day(e.periodStart)}から${jp.day(e.periodEnd)}までに仮受消費税も仮払消費税も発生していないため、申告するものはありません。`,
  earlier_return_unfiled: (e) =>
    `${jp.month(e.unfiled)}がまだ申告されていません。先に${jp.month(e.periodMonth)}を申告すると、その期間の控除不足額が宙に浮きます。控除不足額は翌期の申告に繰り越されるため、申告は古い期間から順に行ってください。`,
  entry_owned_by_stock: (e) =>
    `仕訳 ${e.transactionId} は在庫記録が作成したものです。ここで取り消すと勘定だけが動き、その裏付けとなるロットは動かないため、以後両者が食い違ったままになります。在庫画面から修正してください（廃棄の計上、または入荷への追加諸掛）。`,
  sale_has_no_lines: () =>
    '明細のない請求書は、何も出庫せず売上も生みません。販売する品目を追加してください。',
  sale_reference_taken: (e) =>
    `請求書番号 ${e.reference} はすでに発行済みです。請求書番号は一度しか使えません。同じ番号が二つあると、得意先が一方を支払っても、もう一方が売掛金年齢表で未払いのまま残り続けます。`,
  sale_not_found: (e) => `ID ${e.saleId} の販売が見つかりません。`,
  due_before_invoice: (e) =>
    `請求日は ${e.invoicedOn} ですが、支払期日の ${e.dueOn} はそれより前です。多くは年の入力ミスで、このままでは発行したばかりの請求書が何か月も延滞と表示されます。`,
  account_code_required: () =>
    'この勘定科目体系ではすべての勘定に科目コードが必要です（ベトナムの Thông tư 200 では先頭の数字が科目の区分を表します）。この勘定にもコードを付けてください。',
  account_code_disagrees: (e) =>
    `Thông tư 200 では科目コードの先頭の数字が区分を表しますが、${e.accountCode} はこの区分の数字で始まっていません。1・2 は資産、3 は負債、4 は純資産、5・7 は収益、6・8 は費用です。`,
  account_code_taken: (e) =>
    `科目コード ${e.accountCode} は別の勘定がすでに使っています。コードは一つの勘定を指すもので、重複するとコード順の帳票で二つが同じ位置に並びます。`,
  open_items_not_permitted: () =>
    '未決済残高として管理できるのは債権か債務の勘定だけです。この区分の勘定には年齢がありません。',
  payment_terms_need_open_items: () =>
    '支払条件は得意先や仕入先がいつ支払うかを表すものなので、未決済残高として管理する勘定でのみ意味を持ちます。そちらにチェックを入れるか、条件を空欄にしてください。',
  credit_note_reference_taken: (e) =>
    `伝票番号 ${e.reference} は既に使われています。別の番号を指定してください。`,
  credit_note_not_found: (e) => `返品・値引伝票 ${e.creditNoteId} が見つかりません。`,
  credit_note_has_no_lines: () => '少なくとも一行に、返品数量または値引額を入力してください。',
  credit_line_not_on_sale: (e) => `この明細は請求書 ${e.saleId} のものではありません。`,
  credit_line_repeated: () => '同じ請求明細が二回入力されています。一行にまとめてください。',
  credit_exceeds_sale: (e) =>
    e.limit === 'quantity'
      ? `${e.sku} で返品できる残りは ${jp.quantity(e.remaining, e.precision)} ${jp.unit(e.unit)} です（入力：${jp.quantity(e.requested, e.precision)}）。`
      : `${e.sku} で値引できる残りは ${jp.money(e.remaining)} ${e.currency} です（入力：${jp.money(e.requested)}）。`,
  credit_before_sale: (e) =>
    `返品・値引伝票の日付は請求書の日付（${jp.day(e.invoicedOn)}）より前にできません。`,
  supplier_return_reference_taken: (e) =>
    `返品番号 ${e.reference} は既に使われています。別の番号を指定してください。`,
  supplier_return_not_found: (e) => `仕入返品 ${e.supplierReturnId} が見つかりません。`,
  supplier_refund_exceeds_lot: (e) =>
    `この入荷で返金を受けられる残りは ${jp.money(e.remaining)} ${e.currency} です（入力：${jp.money(e.requested)}）。`,
  supplier_return_before_receipt: (e) =>
    `返品日は入荷日（${jp.day(e.receivedOn)}）より前にできません。`,
  supplier_return_tax_needs_local_currency: (e) =>
    `この入荷は ${e.currency} 建てです。消費税を戻せるのは ${e.functional} 建ての仕入だけです。輸入消費税は仕入先ではなく税関を通じて控除します。`,
  supplier_account_required: () => '返金する仕入先の勘定、または銀行口座を選んでください。',
  supplier_return_exceeds_lot: (e) =>
    `この入荷で返品できる残りは ${jp.quantity(e.remaining, e.precision)} ${jp.unit(e.unit)} です（入力：${jp.quantity(e.requested, e.precision)}）。`,
};

const TRANSLATIONS: Record<TranslatedLocale, ErrorMessages> = { vi, ja };

/** A refusal in Vietnamese or Japanese. For every language, see `describeError`. */
export function translateError(error: LedgerError, locale: TranslatedLocale): string {
  // TypeScript cannot follow that the entry picked by `error.code` is the one
  // whose parameter is this very variant, so the lookup is widened by hand.
  // The table's own type is what guarantees every code has a sentence.
  const render = TRANSLATIONS[locale][error.code] as (error: LedgerError) => string;
  return render(error);
}

/** The chart names sit mid-sentence elsewhere; this one opens a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

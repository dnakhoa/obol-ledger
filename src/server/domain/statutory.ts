/**
 * Vietnam's statutory financial statements, as data.
 *
 * A Vietnamese balance sheet is not a list of accounts: it is a prescribed
 * form, each line (chỉ tiêu) with a fixed code (mã số), filled from the
 * balances of particular accounts. Receivables are split by the side of each
 * customer's balance — money owed to the business on line 131, money received
 * in advance on 312 — and contra accounts such as accumulated depreciation
 * print as negatives beside what they reduce.
 *
 * The forms are defined here as data and filled by one function, so the two
 * regimes a business may keep its books under — Thông tư 200 for enterprises
 * generally, Thông tư 133 for small and medium ones — are two tables rather
 * than two programs. Any account with a balance that no line claims is
 * reported, not dropped: a statement that quietly leaves out an account
 * still adds up, and is wrong.
 *
 * The layouts follow the appendices of each circular. They should be checked
 * against the official templates by an accountant before a statement is
 * signed; see docs/adr/0026-statutory-statements.md.
 */

export type StatutoryForm = 'B01-DN' | 'B02-DN' | 'B01a-DNN' | 'B02-DNN';
export type StatutoryKind = 'balance_sheet' | 'income_statement';

/**
 * How an account's balance feeds a line.
 *
 * - `debit`: only a debit balance, as a positive — a customer who owes us.
 * - `credit`: only a credit balance, as a positive — a customer who has paid
 *   in advance, reported on the other side of the balance sheet.
 * - `asset`: the whole debit-positive balance — cash, stock.
 * - `liability`: the whole balance, credit presented positive.
 * - `contra`: the debit-positive balance as it stands, so a credit balance
 *   such as accumulated depreciation prints negative beside its asset.
 */
export type Side = 'debit' | 'credit' | 'asset' | 'liability' | 'contra';

export type Source = { readonly prefixes: readonly string[]; readonly side: Side };

export type FormLine = {
  readonly code: string;
  readonly vi: string;
  readonly en: string;
  /** 0 for a section heading, 1 for a group, 2 for a line within it. */
  readonly level: 0 | 1 | 2;
  /** Filled from account balances. */
  readonly sources?: readonly Source[];
  /** Or the sum of other lines; a leading `-` subtracts. */
  readonly sum?: readonly string[];
  /** The line that takes the year's unclosed result: retained earnings. */
  readonly result?: boolean;
};

export type FormDefinition = {
  readonly form: StatutoryForm;
  readonly kind: StatutoryKind;
  readonly titleVi: string;
  readonly titleEn: string;
  readonly lines: readonly FormLine[];
  /** For a balance sheet: the two totals that must agree. */
  readonly totals?: readonly [string, string];
};

const s = (side: Side, ...prefixes: string[]): Source => ({ prefixes, side });

// ---- Thông tư 200: Mẫu B01-DN ------------------------------------------------

const B01_DN: FormDefinition = {
  form: 'B01-DN',
  kind: 'balance_sheet',
  titleVi: 'Bảng cân đối kế toán',
  titleEn: 'Statement of financial position',
  totals: ['270', '440'],
  lines: [
    {
      code: '100',
      level: 0,
      vi: 'A. TÀI SẢN NGẮN HẠN',
      en: 'A. Current assets',
      sum: ['110', '120', '130', '140', '150'],
    },
    {
      code: '110',
      level: 1,
      vi: 'I. Tiền và các khoản tương đương tiền',
      en: 'I. Cash and cash equivalents',
      sum: ['111', '112'],
    },
    {
      code: '111',
      level: 2,
      vi: '1. Tiền',
      en: '1. Cash',
      sources: [s('asset', '111', '112', '113')],
    },
    {
      code: '112',
      level: 2,
      vi: '2. Các khoản tương đương tiền',
      en: '2. Cash equivalents',
      sources: [],
    },
    {
      code: '120',
      level: 1,
      vi: 'II. Đầu tư tài chính ngắn hạn',
      en: 'II. Short-term financial investments',
      sum: ['121', '122', '123'],
    },
    {
      code: '121',
      level: 2,
      vi: '1. Chứng khoán kinh doanh',
      en: '1. Trading securities',
      sources: [s('asset', '121')],
    },
    {
      code: '122',
      level: 2,
      vi: '2. Dự phòng giảm giá chứng khoán kinh doanh',
      en: '2. Provision for trading securities',
      sources: [s('contra', '2291')],
    },
    {
      code: '123',
      level: 2,
      vi: '3. Đầu tư nắm giữ đến ngày đáo hạn',
      en: '3. Held-to-maturity investments',
      sources: [s('asset', '128')],
    },
    {
      code: '130',
      level: 1,
      vi: 'III. Các khoản phải thu ngắn hạn',
      en: 'III. Short-term receivables',
      sum: ['131', '132', '136', '137', '139'],
    },
    {
      code: '131',
      level: 2,
      vi: '1. Phải thu ngắn hạn của khách hàng',
      en: '1. Trade receivables',
      sources: [s('debit', '131')],
    },
    {
      code: '132',
      level: 2,
      vi: '2. Trả trước cho người bán ngắn hạn',
      en: '2. Advances to suppliers',
      sources: [s('debit', '331')],
    },
    {
      code: '136',
      level: 2,
      vi: '6. Phải thu ngắn hạn khác',
      en: '6. Other receivables',
      sources: [s('debit', '136', '1385', '1388', '334', '338', '141', '244')],
    },
    {
      code: '137',
      level: 2,
      vi: '7. Dự phòng phải thu ngắn hạn khó đòi',
      en: '7. Provision for doubtful receivables',
      sources: [s('contra', '2293')],
    },
    {
      code: '139',
      level: 2,
      vi: '8. Tài sản thiếu chờ xử lý',
      en: '8. Shortages awaiting resolution',
      sources: [s('asset', '1381')],
    },
    { code: '140', level: 1, vi: 'IV. Hàng tồn kho', en: 'IV. Inventories', sum: ['141', '149'] },
    {
      code: '141',
      level: 2,
      vi: '1. Hàng tồn kho',
      en: '1. Inventories',
      sources: [s('asset', '151', '152', '153', '154', '155', '156', '157', '158')],
    },
    {
      code: '149',
      level: 2,
      vi: '2. Dự phòng giảm giá hàng tồn kho',
      en: '2. Provision for inventories',
      sources: [s('contra', '2294')],
    },
    {
      code: '150',
      level: 1,
      vi: 'V. Tài sản ngắn hạn khác',
      en: 'V. Other current assets',
      sum: ['151', '152', '153'],
    },
    {
      code: '151',
      level: 2,
      vi: '1. Chi phí trả trước ngắn hạn',
      en: '1. Prepaid expenses',
      sources: [s('asset', '242')],
    },
    {
      code: '152',
      level: 2,
      vi: '2. Thuế GTGT được khấu trừ',
      en: '2. Deductible VAT',
      sources: [s('asset', '133')],
    },
    {
      code: '153',
      level: 2,
      vi: '3. Thuế và các khoản khác phải thu Nhà nước',
      en: '3. Taxes receivable from the State',
      sources: [s('debit', '333')],
    },
    {
      code: '200',
      level: 0,
      vi: 'B. TÀI SẢN DÀI HẠN',
      en: 'B. Non-current assets',
      sum: ['220', '240', '250', '260'],
    },
    {
      code: '220',
      level: 1,
      vi: 'II. Tài sản cố định',
      en: 'II. Fixed assets',
      sum: ['221', '227'],
    },
    {
      code: '221',
      level: 2,
      vi: '1. Tài sản cố định hữu hình',
      en: '1. Tangible fixed assets',
      sum: ['222', '223'],
    },
    { code: '222', level: 2, vi: '- Nguyên giá', en: '- Cost', sources: [s('asset', '211')] },
    {
      code: '223',
      level: 2,
      vi: '- Giá trị hao mòn lũy kế',
      en: '- Accumulated depreciation',
      sources: [s('contra', '2141'), s('contra', '214')],
    },
    {
      code: '227',
      level: 2,
      vi: '3. Tài sản cố định vô hình',
      en: '3. Intangible fixed assets',
      sum: ['228', '229'],
    },
    { code: '228', level: 2, vi: '- Nguyên giá', en: '- Cost', sources: [s('asset', '213')] },
    {
      code: '229',
      level: 2,
      vi: '- Giá trị hao mòn lũy kế',
      en: '- Accumulated amortisation',
      sources: [s('contra', '2143')],
    },
    {
      code: '240',
      level: 1,
      vi: 'IV. Tài sản dở dang dài hạn',
      en: 'IV. Long-term work in progress',
      sum: ['242'],
    },
    {
      code: '242',
      level: 2,
      vi: '2. Chi phí xây dựng cơ bản dở dang',
      en: '2. Construction in progress',
      sources: [s('asset', '241')],
    },
    {
      code: '250',
      level: 1,
      vi: 'V. Đầu tư tài chính dài hạn',
      en: 'V. Long-term financial investments',
      sum: ['251', '252', '253', '254'],
    },
    {
      code: '251',
      level: 2,
      vi: '1. Đầu tư vào công ty con',
      en: '1. Investments in subsidiaries',
      sources: [s('asset', '221')],
    },
    {
      code: '252',
      level: 2,
      vi: '2. Đầu tư vào công ty liên doanh, liên kết',
      en: '2. Investments in associates and joint ventures',
      sources: [s('asset', '222')],
    },
    {
      code: '253',
      level: 2,
      vi: '3. Đầu tư góp vốn vào đơn vị khác',
      en: '3. Other equity investments',
      sources: [s('asset', '228')],
    },
    {
      code: '254',
      level: 2,
      vi: '4. Dự phòng đầu tư tài chính dài hạn',
      en: '4. Provision for long-term investments',
      sources: [s('contra', '2292')],
    },
    {
      code: '260',
      level: 1,
      vi: 'VI. Tài sản dài hạn khác',
      en: 'VI. Other non-current assets',
      sum: ['262'],
    },
    {
      code: '262',
      level: 2,
      vi: '2. Tài sản thuế thu nhập hoãn lại',
      en: '2. Deferred tax assets',
      sources: [s('asset', '243')],
    },
    { code: '270', level: 0, vi: 'TỔNG CỘNG TÀI SẢN', en: 'TOTAL ASSETS', sum: ['100', '200'] },
    { code: '300', level: 0, vi: 'C. NỢ PHẢI TRẢ', en: 'C. Liabilities', sum: ['310', '330'] },
    {
      code: '310',
      level: 1,
      vi: 'I. Nợ ngắn hạn',
      en: 'I. Current liabilities',
      sum: ['311', '312', '313', '314', '315', '319', '320', '322'],
    },
    {
      code: '311',
      level: 2,
      vi: '1. Phải trả người bán ngắn hạn',
      en: '1. Trade payables',
      sources: [s('credit', '331')],
    },
    {
      code: '312',
      level: 2,
      vi: '2. Người mua trả tiền trước ngắn hạn',
      en: '2. Advances from customers',
      sources: [s('credit', '131')],
    },
    {
      code: '313',
      level: 2,
      vi: '3. Thuế và các khoản phải nộp Nhà nước',
      en: '3. Taxes payable to the State',
      sources: [s('credit', '333')],
    },
    {
      code: '314',
      level: 2,
      vi: '4. Phải trả người lao động',
      en: '4. Payables to employees',
      sources: [s('credit', '334')],
    },
    {
      code: '315',
      level: 2,
      vi: '5. Chi phí phải trả ngắn hạn',
      en: '5. Accrued expenses',
      sources: [s('liability', '335')],
    },
    {
      code: '319',
      level: 2,
      vi: '9. Phải trả ngắn hạn khác',
      en: '9. Other payables',
      sources: [s('credit', '338', '344', '136', '1388')],
    },
    {
      code: '320',
      level: 2,
      vi: '10. Vay và nợ thuê tài chính ngắn hạn',
      en: '10. Short-term borrowings',
      sources: [s('liability', '341')],
    },
    {
      code: '322',
      level: 2,
      vi: '12. Quỹ khen thưởng, phúc lợi',
      en: '12. Bonus and welfare fund',
      sources: [s('liability', '353')],
    },
    {
      code: '330',
      level: 1,
      vi: 'II. Nợ dài hạn',
      en: 'II. Non-current liabilities',
      sum: ['341'],
    },
    {
      code: '341',
      level: 2,
      vi: '11. Thuế thu nhập hoãn lại phải trả',
      en: '11. Deferred tax liabilities',
      sources: [s('liability', '347')],
    },
    { code: '400', level: 0, vi: 'D. VỐN CHỦ SỞ HỮU', en: "D. Owners' equity", sum: ['410'] },
    {
      code: '410',
      level: 1,
      vi: 'I. Vốn chủ sở hữu',
      en: "I. Owners' equity",
      sum: ['411', '412', '414', '415', '417', '418', '421'],
    },
    {
      code: '411',
      level: 2,
      vi: '1. Vốn góp của chủ sở hữu',
      en: "1. Owners' contributed capital",
      sources: [s('liability', '4111', '411')],
    },
    {
      code: '412',
      level: 2,
      vi: '2. Thặng dư vốn cổ phần',
      en: '2. Share premium',
      sources: [s('liability', '4112')],
    },
    {
      code: '414',
      level: 2,
      vi: '4. Vốn khác của chủ sở hữu',
      en: "4. Other owners' capital",
      sources: [s('liability', '4118')],
    },
    {
      code: '415',
      level: 2,
      vi: '5. Cổ phiếu quỹ',
      en: '5. Treasury shares',
      sources: [s('liability', '419')],
    },
    {
      code: '417',
      level: 2,
      vi: '7. Chênh lệch tỷ giá hối đoái',
      en: '7. Foreign exchange differences',
      sources: [s('liability', '413')],
    },
    {
      code: '418',
      level: 2,
      vi: '8. Quỹ đầu tư phát triển',
      en: '8. Development investment fund',
      sources: [s('liability', '414')],
    },
    {
      code: '421',
      level: 2,
      vi: '11. Lợi nhuận sau thuế chưa phân phối',
      en: '11. Undistributed profit after tax',
      sources: [s('liability', '421')],
      result: true,
    },
    {
      code: '440',
      level: 0,
      vi: 'TỔNG CỘNG NGUỒN VỐN',
      en: 'TOTAL LIABILITIES AND EQUITY',
      sum: ['300', '400'],
    },
  ],
};

// ---- Thông tư 200: Mẫu B02-DN ------------------------------------------------

const B02_DN: FormDefinition = {
  form: 'B02-DN',
  kind: 'income_statement',
  titleVi: 'Báo cáo kết quả hoạt động kinh doanh',
  titleEn: 'Statement of income',
  lines: [
    {
      code: '01',
      level: 1,
      vi: '1. Doanh thu bán hàng và cung cấp dịch vụ',
      en: '1. Revenue from sales and services',
      sources: [s('liability', '511')],
    },
    {
      code: '02',
      level: 1,
      vi: '2. Các khoản giảm trừ doanh thu',
      en: '2. Revenue deductions',
      sources: [s('asset', '521')],
    },
    {
      code: '10',
      level: 0,
      vi: '3. Doanh thu thuần về bán hàng và cung cấp dịch vụ',
      en: '3. Net revenue',
      sum: ['01', '-02'],
    },
    {
      code: '11',
      level: 1,
      vi: '4. Giá vốn hàng bán',
      en: '4. Cost of goods sold',
      sources: [s('asset', '632')],
    },
    {
      code: '20',
      level: 0,
      vi: '5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ',
      en: '5. Gross profit',
      sum: ['10', '-11'],
    },
    {
      code: '21',
      level: 1,
      vi: '6. Doanh thu hoạt động tài chính',
      en: '6. Financial income',
      sources: [s('liability', '515')],
    },
    {
      code: '22',
      level: 1,
      vi: '7. Chi phí tài chính',
      en: '7. Financial expenses',
      sources: [s('asset', '635')],
    },
    {
      code: '25',
      level: 1,
      vi: '8. Chi phí bán hàng',
      en: '8. Selling expenses',
      sources: [s('asset', '641')],
    },
    {
      code: '26',
      level: 1,
      vi: '9. Chi phí quản lý doanh nghiệp',
      en: '9. General and administrative expenses',
      sources: [s('asset', '642')],
    },
    {
      code: '30',
      level: 0,
      vi: '10. Lợi nhuận thuần từ hoạt động kinh doanh',
      en: '10. Operating profit',
      sum: ['20', '21', '-22', '-25', '-26'],
    },
    {
      code: '31',
      level: 1,
      vi: '11. Thu nhập khác',
      en: '11. Other income',
      sources: [s('liability', '711')],
    },
    {
      code: '32',
      level: 1,
      vi: '12. Chi phí khác',
      en: '12. Other expenses',
      sources: [s('asset', '811')],
    },
    { code: '40', level: 0, vi: '13. Lợi nhuận khác', en: '13. Other profit', sum: ['31', '-32'] },
    {
      code: '50',
      level: 0,
      vi: '14. Tổng lợi nhuận kế toán trước thuế',
      en: '14. Profit before tax',
      sum: ['30', '40'],
    },
    {
      code: '51',
      level: 1,
      vi: '15. Chi phí thuế TNDN hiện hành',
      en: '15. Current income tax',
      sources: [s('asset', '8211')],
    },
    {
      code: '52',
      level: 1,
      vi: '16. Chi phí thuế TNDN hoãn lại',
      en: '16. Deferred income tax',
      sources: [s('asset', '8212')],
    },
    {
      code: '60',
      level: 0,
      vi: '17. Lợi nhuận sau thuế thu nhập doanh nghiệp',
      en: '17. Profit after tax',
      sum: ['50', '-51', '-52'],
    },
  ],
};

// ---- Thông tư 133: Mẫu B01a-DNN and B02-DNN ----------------------------------

const B01A_DNN: FormDefinition = {
  form: 'B01a-DNN',
  kind: 'balance_sheet',
  titleVi: 'Báo cáo tình hình tài chính',
  titleEn: 'Statement of financial position',
  totals: ['200', '500'],
  lines: [
    {
      code: '110',
      level: 1,
      vi: 'I. Tiền và các khoản tương đương tiền',
      en: 'I. Cash and cash equivalents',
      sources: [s('asset', '111', '112', '113')],
    },
    {
      code: '120',
      level: 1,
      vi: 'II. Đầu tư tài chính',
      en: 'II. Financial investments',
      sum: ['121', '122', '123', '124'],
    },
    {
      code: '121',
      level: 2,
      vi: '1. Chứng khoán kinh doanh',
      en: '1. Trading securities',
      sources: [s('asset', '121')],
    },
    {
      code: '122',
      level: 2,
      vi: '2. Đầu tư nắm giữ đến ngày đáo hạn',
      en: '2. Held-to-maturity investments',
      sources: [s('asset', '128')],
    },
    {
      code: '123',
      level: 2,
      vi: '3. Đầu tư góp vốn vào đơn vị khác',
      en: '3. Equity investments in other entities',
      sources: [s('asset', '228')],
    },
    {
      code: '124',
      level: 2,
      vi: '4. Dự phòng tổn thất đầu tư tài chính',
      en: '4. Provision for investment losses',
      sources: [s('contra', '2291', '2292')],
    },
    {
      code: '130',
      level: 1,
      vi: 'III. Các khoản phải thu',
      en: 'III. Receivables',
      sum: ['131', '132', '134', '135', '136'],
    },
    {
      code: '131',
      level: 2,
      vi: '1. Phải thu của khách hàng',
      en: '1. Trade receivables',
      sources: [s('debit', '131')],
    },
    {
      code: '132',
      level: 2,
      vi: '2. Trả trước cho người bán',
      en: '2. Advances to suppliers',
      sources: [s('debit', '331')],
    },
    {
      code: '134',
      level: 2,
      vi: '4. Phải thu khác',
      en: '4. Other receivables',
      sources: [s('debit', '136', '1386', '1388', '334', '338', '141')],
    },
    {
      code: '135',
      level: 2,
      vi: '5. Tài sản thiếu chờ xử lý',
      en: '5. Shortages awaiting resolution',
      sources: [s('asset', '1381')],
    },
    {
      code: '136',
      level: 2,
      vi: '6. Dự phòng phải thu khó đòi',
      en: '6. Provision for doubtful receivables',
      sources: [s('contra', '2293')],
    },
    { code: '140', level: 1, vi: 'IV. Hàng tồn kho', en: 'IV. Inventories', sum: ['141', '142'] },
    {
      code: '141',
      level: 2,
      vi: '1. Hàng tồn kho',
      en: '1. Inventories',
      sources: [s('asset', '151', '152', '153', '154', '155', '156', '157')],
    },
    {
      code: '142',
      level: 2,
      vi: '2. Dự phòng giảm giá hàng tồn kho',
      en: '2. Provision for inventories',
      sources: [s('contra', '2294')],
    },
    { code: '150', level: 1, vi: 'V. Tài sản cố định', en: 'V. Fixed assets', sum: ['151', '152'] },
    {
      code: '151',
      level: 2,
      vi: '- Nguyên giá',
      en: '- Cost',
      sources: [s('asset', '211', '213')],
    },
    {
      code: '152',
      level: 2,
      vi: '- Giá trị hao mòn lũy kế',
      en: '- Accumulated depreciation',
      sources: [s('contra', '214')],
    },
    {
      code: '160',
      level: 1,
      vi: 'VI. Bất động sản đầu tư',
      en: 'VI. Investment property',
      sources: [s('asset', '217')],
    },
    {
      code: '170',
      level: 1,
      vi: 'VII. Xây dựng cơ bản dở dang',
      en: 'VII. Construction in progress',
      sources: [s('asset', '241')],
    },
    {
      code: '180',
      level: 1,
      vi: 'VIII. Tài sản khác',
      en: 'VIII. Other assets',
      sum: ['181', '182'],
    },
    {
      code: '181',
      level: 2,
      vi: '1. Thuế GTGT được khấu trừ',
      en: '1. Deductible VAT',
      sources: [s('asset', '133')],
    },
    {
      code: '182',
      level: 2,
      vi: '2. Tài sản khác',
      en: '2. Other assets',
      sources: [s('asset', '242'), s('debit', '333')],
    },
    {
      code: '200',
      level: 0,
      vi: 'TỔNG CỘNG TÀI SẢN',
      en: 'TOTAL ASSETS',
      sum: ['110', '120', '130', '140', '150', '160', '170', '180'],
    },
    {
      code: '300',
      level: 0,
      vi: 'I. NỢ PHẢI TRẢ',
      en: 'I. Liabilities',
      sum: ['311', '312', '313', '314', '315', '316', '318', '319'],
    },
    {
      code: '311',
      level: 2,
      vi: '1. Phải trả người bán',
      en: '1. Trade payables',
      sources: [s('credit', '331')],
    },
    {
      code: '312',
      level: 2,
      vi: '2. Người mua trả tiền trước',
      en: '2. Advances from customers',
      sources: [s('credit', '131')],
    },
    {
      code: '313',
      level: 2,
      vi: '3. Thuế và các khoản phải nộp Nhà nước',
      en: '3. Taxes payable to the State',
      sources: [s('credit', '333')],
    },
    {
      code: '314',
      level: 2,
      vi: '4. Phải trả người lao động',
      en: '4. Payables to employees',
      sources: [s('credit', '334')],
    },
    {
      code: '315',
      level: 2,
      vi: '5. Phải trả khác',
      en: '5. Other payables',
      sources: [s('liability', '335'), s('credit', '338', '136', '1388')],
    },
    {
      code: '316',
      level: 2,
      vi: '6. Vay và nợ thuê tài chính',
      en: '6. Borrowings',
      sources: [s('liability', '341')],
    },
    {
      code: '318',
      level: 2,
      vi: '8. Dự phòng phải trả',
      en: '8. Provisions',
      sources: [s('liability', '352')],
    },
    {
      code: '319',
      level: 2,
      vi: '9. Quỹ khen thưởng, phúc lợi',
      en: '9. Bonus and welfare fund',
      sources: [s('liability', '353')],
    },
    {
      code: '400',
      level: 0,
      vi: 'II. VỐN CHỦ SỞ HỮU',
      en: "II. Owners' equity",
      sum: ['411', '412', '413', '414', '415', '416', '417'],
    },
    {
      code: '411',
      level: 2,
      vi: '1. Vốn góp của chủ sở hữu',
      en: "1. Owners' contributed capital",
      sources: [s('liability', '4111', '411')],
    },
    {
      code: '412',
      level: 2,
      vi: '2. Thặng dư vốn cổ phần',
      en: '2. Share premium',
      sources: [s('liability', '4112')],
    },
    {
      code: '413',
      level: 2,
      vi: '3. Vốn khác của chủ sở hữu',
      en: "3. Other owners' capital",
      sources: [s('liability', '4118')],
    },
    {
      code: '414',
      level: 2,
      vi: '4. Cổ phiếu quỹ',
      en: '4. Treasury shares',
      sources: [s('liability', '419')],
    },
    {
      code: '415',
      level: 2,
      vi: '5. Chênh lệch tỷ giá hối đoái',
      en: '5. Foreign exchange differences',
      sources: [s('liability', '413')],
    },
    {
      code: '416',
      level: 2,
      vi: '6. Các quỹ thuộc vốn chủ sở hữu',
      en: "6. Owners' funds",
      sources: [s('liability', '418')],
    },
    {
      code: '417',
      level: 2,
      vi: '7. Lợi nhuận sau thuế chưa phân phối',
      en: '7. Undistributed profit after tax',
      sources: [s('liability', '421')],
      result: true,
    },
    {
      code: '500',
      level: 0,
      vi: 'TỔNG CỘNG NGUỒN VỐN',
      en: 'TOTAL LIABILITIES AND EQUITY',
      sum: ['300', '400'],
    },
  ],
};

const B02_DNN: FormDefinition = {
  form: 'B02-DNN',
  kind: 'income_statement',
  titleVi: 'Báo cáo kết quả hoạt động kinh doanh',
  titleEn: 'Statement of income',
  lines: [
    {
      code: '01',
      level: 1,
      vi: '1. Doanh thu bán hàng và cung cấp dịch vụ',
      en: '1. Revenue from sales and services',
      sources: [s('liability', '511')],
    },
    {
      code: '02',
      level: 1,
      vi: '2. Các khoản giảm trừ doanh thu',
      en: '2. Revenue deductions',
      sources: [],
    },
    {
      code: '10',
      level: 0,
      vi: '3. Doanh thu thuần về bán hàng và cung cấp dịch vụ',
      en: '3. Net revenue',
      sum: ['01', '-02'],
    },
    {
      code: '11',
      level: 1,
      vi: '4. Giá vốn hàng bán',
      en: '4. Cost of goods sold',
      sources: [s('asset', '632')],
    },
    {
      code: '20',
      level: 0,
      vi: '5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ',
      en: '5. Gross profit',
      sum: ['10', '-11'],
    },
    {
      code: '21',
      level: 1,
      vi: '6. Doanh thu hoạt động tài chính',
      en: '6. Financial income',
      sources: [s('liability', '515')],
    },
    {
      code: '22',
      level: 1,
      vi: '7. Chi phí tài chính',
      en: '7. Financial expenses',
      sources: [s('asset', '635')],
    },
    {
      code: '24',
      level: 1,
      vi: '8. Chi phí quản lý kinh doanh',
      en: '8. Selling, general and administrative expenses',
      sources: [s('asset', '642')],
    },
    {
      code: '30',
      level: 0,
      vi: '9. Lợi nhuận thuần từ hoạt động kinh doanh',
      en: '9. Operating profit',
      sum: ['20', '21', '-22', '-24'],
    },
    {
      code: '31',
      level: 1,
      vi: '10. Thu nhập khác',
      en: '10. Other income',
      sources: [s('liability', '711')],
    },
    {
      code: '32',
      level: 1,
      vi: '11. Chi phí khác',
      en: '11. Other expenses',
      sources: [s('asset', '811')],
    },
    { code: '40', level: 0, vi: '12. Lợi nhuận khác', en: '12. Other profit', sum: ['31', '-32'] },
    {
      code: '50',
      level: 0,
      vi: '13. Tổng lợi nhuận kế toán trước thuế',
      en: '13. Profit before tax',
      sum: ['30', '40'],
    },
    {
      code: '51',
      level: 1,
      vi: '14. Chi phí thuế TNDN',
      en: '14. Income tax expense',
      sources: [s('asset', '821')],
    },
    {
      code: '60',
      level: 0,
      vi: '15. Lợi nhuận sau thuế thu nhập doanh nghiệp',
      en: '15. Profit after tax',
      sum: ['50', '-51'],
    },
  ],
};

export const STATUTORY_FORMS: Record<StatutoryForm, FormDefinition> = {
  'B01-DN': B01_DN,
  'B02-DN': B02_DN,
  'B01a-DNN': B01A_DNN,
  'B02-DNN': B02_DNN,
};

/** The two forms a business keeps, by the circular its chart follows. */
export function formsFor(chartTemplate: string): {
  readonly balanceSheet: StatutoryForm;
  readonly incomeStatement: StatutoryForm;
} | null {
  if (chartTemplate === 'vn_tt200') return { balanceSheet: 'B01-DN', incomeStatement: 'B02-DN' };
  if (chartTemplate === 'vn_tt133') return { balanceSheet: 'B01a-DNN', incomeStatement: 'B02-DNN' };
  return null;
}

export type AccountFigure = {
  readonly accountId: string;
  readonly code: string | null;
  readonly name: string;
  /** Debit-positive, in the functional currency. */
  readonly balance: bigint;
};

export type FilledLine = FormLine & { readonly amount: bigint };

export type FilledForm = {
  readonly definition: FormDefinition;
  readonly lines: readonly FilledLine[];
  /** Accounts with a balance no line claims. Empty on a statement that is complete. */
  readonly unplaced: readonly AccountFigure[];
  /** For a balance sheet: whether assets equal liabilities and equity. */
  readonly balanced: boolean | null;
};

/**
 * Fills a form from account figures.
 *
 * Each account is claimed by the line whose prefix matches its code most
 * specifically for the side its balance is on — `1311` goes to a `131` line,
 * but a `2141` line beats a `214` one. `result` is the year's unclosed
 * profit, presented on retained earnings, so a balance sheet drawn mid-year
 * balances without a closing entry.
 */
export function fillForm(
  definition: FormDefinition,
  figures: readonly AccountFigure[],
  result = 0n,
): FilledForm {
  const direct = new Map<string, bigint>();
  const unplaced: AccountFigure[] = [];

  for (const figure of figures) {
    if (figure.balance === 0n) continue;
    const claim = claimFor(definition, figure);
    if (!claim) {
      unplaced.push(figure);
      continue;
    }
    direct.set(claim.line, (direct.get(claim.line) ?? 0n) + claim.amount);
  }

  const amounts = new Map<string, bigint>();
  const byCode = new Map(definition.lines.map((line) => [line.code, line]));
  const valueOf = (code: string, seen: Set<string> = new Set()): bigint => {
    const known = amounts.get(code);
    if (known !== undefined) return known;
    const line = byCode.get(code);
    if (!line || seen.has(code)) return 0n;
    seen.add(code);
    let value = direct.get(code) ?? 0n;
    if (line.result) value += result;
    for (const term of line.sum ?? []) {
      value += term.startsWith('-') ? -valueOf(term.slice(1), seen) : valueOf(term, seen);
    }
    amounts.set(code, value);
    return value;
  };

  const lines = definition.lines.map((line) => ({ ...line, amount: valueOf(line.code) }));
  const balanced = definition.totals
    ? valueOf(definition.totals[0]) === valueOf(definition.totals[1])
    : null;
  return { definition, lines, unplaced, balanced };
}

function claimFor(
  definition: FormDefinition,
  figure: AccountFigure,
): { line: string; amount: bigint } | null {
  const code = figure.code ?? '';
  if (!code) return null;
  let best: { line: string; amount: bigint; length: number } | null = null;
  for (const line of definition.lines) {
    for (const source of line.sources ?? []) {
      const amount = sideAmount(source.side, figure.balance);
      if (amount === null) continue;
      for (const prefix of source.prefixes) {
        if (!code.startsWith(prefix)) continue;
        if (!best || prefix.length > best.length) {
          best = { line: line.code, amount, length: prefix.length };
        }
      }
    }
  }
  return best ? { line: best.line, amount: best.amount } : null;
}

/** What a debit-positive balance contributes on a side, or null when that side does not take it. */
function sideAmount(side: Side, balance: bigint): bigint | null {
  switch (side) {
    case 'debit':
      return balance > 0n ? balance : null;
    case 'credit':
      return balance < 0n ? -balance : null;
    case 'asset':
    case 'contra':
      return balance;
    case 'liability':
      return -balance;
  }
}

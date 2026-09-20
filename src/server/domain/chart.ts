import type { AccountType } from './account';

/**
 * Chart-of-accounts templates, and the thing that makes them different.
 *
 * Jurisdictions differ structurally here, not cosmetically, and a model that
 * treats every chart as a list of suggested names gets one of them wrong.
 *
 * **Conventional charts** — Australia, New Zealand, the US, most of the EU —
 * have no mandated numbering. Xero's own guidance is "choose a numbering
 * system" and to leave gaps so accounts can be inserted later; two mainstream
 * Australian products ship different defaults. A template here is a *starting
 * point the tenant edits*, and enforcing its structure would be enforcing one
 * vendor's habit as if it were a rule.
 *
 * **Statutory charts** — Vietnam's Thông tư 200/2014/TT-BTC is the one modelled
 * here — are law. The codes are prescribed, the leading digit encodes the
 * account class, and a business does not get to invent one. A template is a
 * *constraint*, and the database enforces it.
 *
 * Designing for the first and validating against the second is deliberate: a
 * model built only against a statutory chart would bake in a rigidity most of
 * the world does not have, and one built only against convention would have
 * nowhere to put a rule that actually is a rule.
 */

export const CHART_TEMPLATES = ['generic', 'au_nz', 'us_gaap', 'jp', 'vn_tt200'] as const;
export type ChartTemplate = (typeof CHART_TEMPLATES)[number];

/** Whether the template's codes are prescribed by law rather than by habit. */
export function isStatutory(template: ChartTemplate): boolean {
  return template === 'vn_tt200';
}

export type TemplateAccount = {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /** Contra accounts and accumulators legitimately hold the "wrong" sign. */
  readonly overdraft?: boolean;
  /**
   * Whether the account holds a fixed number of currency units.
   *
   * Only set where it differs from the default for the type — assets and
   * liabilities are monetary unless said otherwise, which is right for cash,
   * receivables and payables and wrong for inventory and fixed assets.
   */
  readonly monetary?: boolean;
  readonly role?: 'retained_earnings' | 'fx_gain_loss';
  /** Shown in the UI for a code whose purpose is not obvious from its name. */
  readonly note?: string;
};

export type ChartTemplateDefinition = {
  readonly id: ChartTemplate;
  readonly label: string;
  readonly summary: string;
  readonly statutory: boolean;
  readonly accounts: readonly TemplateAccount[];
};

/**
 * The generic chart, in the convention Xero teaches.
 *
 * 100–199 assets, 200–299 liabilities, 300–399 equity, 400–499 revenue,
 * 500–599 expenses, with gaps of ten so an account can be inserted later
 * without renumbering everything around it.
 */
const GENERIC: ChartTemplateDefinition = {
  id: 'generic',
  label: 'Generic (IFRS-shaped)',
  summary:
    '100s assets, 200s liabilities, 300s equity, 400s revenue, 500s expenses. Codes are a starting point — rename, renumber and add as you like.',
  statutory: false,
  accounts: [
    { code: '100', name: 'Cash', type: 'asset' },
    { code: '110', name: 'Bank Account', type: 'asset' },
    { code: '120', name: 'Accounts Receivable', type: 'asset' },
    { code: '130', name: 'Inventory', type: 'asset', monetary: false },
    { code: '150', name: 'Equipment', type: 'asset', monetary: false },
    {
      code: '160',
      name: 'Accumulated Depreciation',
      type: 'asset',
      overdraft: true,
      note: 'Contra-asset: holds a credit balance against the equipment above.',
    },
    { code: '200', name: 'Accounts Payable', type: 'liability', overdraft: true },
    { code: '210', name: 'Accrued Expenses', type: 'liability', overdraft: true },
    { code: '250', name: 'Loans Payable', type: 'liability', overdraft: true },
    { code: '300', name: "Owner's Capital", type: 'equity', overdraft: true },
    {
      code: '310',
      name: 'Retained Earnings',
      type: 'equity',
      overdraft: true,
      role: 'retained_earnings',
      note: 'Where a closed period’s profit lands.',
    },
    { code: '400', name: 'Sales', type: 'revenue', overdraft: true },
    {
      code: '410',
      name: 'Other Income',
      type: 'revenue',
      overdraft: true,
    },
    { code: '500', name: 'Cost of Goods Sold', type: 'expense' },
    { code: '520', name: 'Wages and Salaries', type: 'expense' },
    { code: '540', name: 'Rent', type: 'expense' },
    { code: '560', name: 'General Expenses', type: 'expense' },
    {
      code: '590',
      name: 'Foreign Exchange Gain/Loss',
      type: 'expense',
      overdraft: true,
      role: 'fx_gain_loss',
      note: 'Swings both ways: a favourable month leaves it with a credit balance, which is a gain.',
    },
  ],
};

/**
 * Australia and New Zealand.
 *
 * The same numbering convention, with the accounts a local business actually
 * has: GST collected and paid as separate accounts because the return is the
 * net of the two, PAYG withholding, and superannuation or KiwiSaver payable.
 *
 * These are still only defaults. Neither the ATO nor Inland Revenue mandates a
 * chart, and a bookkeeper who wants 6-xxxx for expenses is not doing anything
 * wrong.
 */
const AU_NZ: ChartTemplateDefinition = {
  id: 'au_nz',
  label: 'Australia / New Zealand',
  summary:
    'The generic convention with GST, PAYG and superannuation accounts. Nothing here is mandated — the ATO and IRD do not prescribe a chart.',
  statutory: false,
  accounts: [
    { code: '100', name: 'Cash on Hand', type: 'asset' },
    { code: '110', name: 'Business Bank Account', type: 'asset' },
    { code: '120', name: 'Accounts Receivable', type: 'asset' },
    { code: '130', name: 'Inventory', type: 'asset', monetary: false },
    {
      code: '140',
      name: 'GST Paid (Input Tax Credits)',
      type: 'asset',
      note: 'Tax paid on purchases, reclaimable from the revenue authority.',
    },
    { code: '150', name: 'Plant and Equipment', type: 'asset', monetary: false },
    {
      code: '160',
      name: 'Accumulated Depreciation',
      type: 'asset',
      overdraft: true,
      monetary: false,
      note: 'Contra-asset.',
    },
    { code: '200', name: 'Accounts Payable', type: 'liability', overdraft: true },
    {
      code: '210',
      name: 'GST Collected',
      type: 'liability',
      overdraft: true,
      note: 'Tax charged on sales, owed to the revenue authority. The return is this net of GST Paid.',
    },
    { code: '220', name: 'PAYG Withholding Payable', type: 'liability', overdraft: true },
    {
      code: '230',
      name: 'Superannuation Payable',
      type: 'liability',
      overdraft: true,
      note: 'KiwiSaver in New Zealand.',
    },
    { code: '240', name: 'Provision for Annual Leave', type: 'liability', overdraft: true },
    { code: '250', name: 'Business Loan', type: 'liability', overdraft: true },
    { code: '300', name: "Owner's Capital", type: 'equity', overdraft: true },
    { code: '305', name: "Owner's Drawings", type: 'equity' },
    {
      code: '310',
      name: 'Retained Earnings',
      type: 'equity',
      overdraft: true,
      role: 'retained_earnings',
    },
    { code: '400', name: 'Sales', type: 'revenue', overdraft: true },
    { code: '420', name: 'Interest Income', type: 'revenue', overdraft: true },
    { code: '500', name: 'Cost of Goods Sold', type: 'expense' },
    { code: '510', name: 'Freight and Customs', type: 'expense' },
    { code: '520', name: 'Wages and Salaries', type: 'expense' },
    { code: '525', name: 'Superannuation Expense', type: 'expense' },
    { code: '540', name: 'Rent', type: 'expense' },
    { code: '560', name: 'General Expenses', type: 'expense' },
    { code: '570', name: 'Depreciation', type: 'expense' },
    {
      code: '590',
      name: 'Foreign Exchange Gain/Loss',
      type: 'expense',
      overdraft: true,
      role: 'fx_gain_loss',
    },
  ],
};

/**
 * Vietnam, Thông tư 200/2014/TT-BTC.
 *
 * Every code here is prescribed. The leading digit encodes the class, and the
 * database enforces the agreement — see `drizzle/0014_account_codes.sql`.
 *
 * A subset of the 76 level-1 accounts: the ones a trading company actually
 * opens. The full list is law and available in the circular; shipping all of
 * it as a default would hand a freight forwarder a construction-in-progress
 * account and a science-and-technology development fund.
 *
 * Two accounts are worth naming for anyone checking this against the circular:
 *
 *  - **421** (lợi nhuận sau thuế chưa phân phối, undistributed profit after
 *    tax) is where a closed period's profit lands, so it carries the
 *    `retained_earnings` role.
 *  - **515** and **635** (doanh thu / chi phí hoạt động tài chính, financial
 *    income and expense) are where exchange differences legally go. The
 *    `fx_gain_loss` role is one account in this model and two in TT200, so it
 *    is attached to 635 and the gains show as a credit balance there — see
 *    `docs/adr/0011-chart-of-accounts.md` for why that is a real divergence
 *    rather than a rounding of the rules.
 */
const VN_TT200: ChartTemplateDefinition = {
  id: 'vn_tt200',
  label: 'Việt Nam — Thông tư 200/2014/TT-BTC',
  summary:
    'Statutory. Codes are prescribed by the circular and the leading digit must agree with the account class; the database enforces both.',
  statutory: true,
  accounts: [
    { code: '111', name: 'Tiền mặt', type: 'asset', note: 'Cash on hand' },
    { code: '112', name: 'Tiền gửi Ngân hàng', type: 'asset', note: 'Bank deposits' },
    { code: '131', name: 'Phải thu của khách hàng', type: 'asset', note: 'Trade receivables' },
    {
      code: '133',
      name: 'Thuế GTGT được khấu trừ',
      type: 'asset',
      note: 'Deductible input VAT — reclaimable, which is why it is an asset',
    },
    { code: '141', name: 'Tạm ứng', type: 'asset', note: 'Advances to employees' },
    {
      code: '152',
      name: 'Nguyên liệu, vật liệu',
      type: 'asset',
      monetary: false,
      note: 'Raw materials',
    },
    {
      code: '156',
      name: 'Hàng hóa',
      type: 'asset',
      monetary: false,
      note: 'Merchandise inventory',
    },
    {
      code: '211',
      name: 'Tài sản cố định hữu hình',
      type: 'asset',
      monetary: false,
      note: 'Tangible fixed assets',
    },
    {
      code: '214',
      name: 'Hao mòn tài sản cố định',
      type: 'asset',
      overdraft: true,
      note: 'Accumulated depreciation — a contra-asset, so it holds a credit balance',
    },
    {
      code: '331',
      name: 'Phải trả cho người bán',
      type: 'liability',
      overdraft: true,
      note: 'Trade payables',
    },
    {
      code: '333',
      name: 'Thuế và các khoản phải nộp Nhà nước',
      type: 'liability',
      overdraft: true,
      note: 'Taxes payable to the State, including output VAT',
    },
    {
      code: '334',
      name: 'Phải trả người lao động',
      type: 'liability',
      overdraft: true,
      note: 'Payroll payable',
    },
    {
      code: '341',
      name: 'Vay và nợ thuê tài chính',
      type: 'liability',
      overdraft: true,
      note: 'Borrowings and finance lease liabilities',
    },
    {
      code: '411',
      name: 'Vốn đầu tư của chủ sở hữu',
      type: 'equity',
      overdraft: true,
      note: "Owner's invested capital",
    },
    {
      code: '413',
      name: 'Chênh lệch tỷ giá hối đoái',
      type: 'equity',
      overdraft: true,
      note: 'Exchange differences held in equity — distinct from 515/635, which take them to profit or loss',
    },
    {
      code: '421',
      name: 'Lợi nhuận sau thuế chưa phân phối',
      type: 'equity',
      overdraft: true,
      role: 'retained_earnings',
      note: 'Undistributed profit after tax',
    },
    {
      code: '511',
      name: 'Doanh thu bán hàng và cung cấp dịch vụ',
      type: 'revenue',
      overdraft: true,
      note: 'Revenue from sales and services',
    },
    {
      code: '515',
      name: 'Doanh thu hoạt động tài chính',
      type: 'revenue',
      overdraft: true,
      note: 'Financial income, including realised exchange gains',
    },
    {
      code: '521',
      name: 'Các khoản giảm trừ doanh thu',
      type: 'revenue',
      overdraft: true,
      note: 'Revenue deductions — contra-revenue, so it holds a debit balance',
    },
    { code: '632', name: 'Giá vốn hàng bán', type: 'expense', note: 'Cost of goods sold' },
    {
      code: '635',
      name: 'Chi phí tài chính',
      type: 'expense',
      overdraft: true,
      role: 'fx_gain_loss',
      note: 'Financial expense, including realised exchange losses',
    },
    { code: '641', name: 'Chi phí bán hàng', type: 'expense', note: 'Selling expenses' },
    {
      code: '642',
      name: 'Chi phí quản lý doanh nghiệp',
      type: 'expense',
      note: 'General and administrative expenses',
    },
    { code: '711', name: 'Thu nhập khác', type: 'revenue', overdraft: true, note: 'Other income' },
    { code: '811', name: 'Chi phí khác', type: 'expense', note: 'Other expenses' },
    {
      code: '821',
      name: 'Chi phí thuế thu nhập doanh nghiệp',
      type: 'expense',
      note: 'Corporate income tax expense',
    },
  ],
};

/**
 * United States.
 *
 * Four digits, which is the convention most American small businesses and
 * their accountants use: 1000s assets, 2000s liabilities, 3000s equity, 4000s
 * revenue, 5000s cost of sales, 6000s operating expenses. Like every other
 * conventional chart it is a habit rather than a rule — no US authority
 * prescribes account numbers.
 *
 * The one structural difference from the other charts here is the tax
 * treatment, and it is not cosmetic.
 *
 * **US sales tax is not a VAT.** It is collected from the customer and
 * remitted to the state, and the business *never reclaims* tax it paid on its
 * own purchases — there is no input credit, because sales tax is levied once,
 * at the final sale. So this chart has a Sales Tax Payable liability and
 * deliberately **no input-tax asset**. Giving it one would be a modelling
 * error that quietly produces wrong numbers: a business would accumulate a
 * receivable from the state that does not exist and overstate its assets by
 * every dollar of tax it ever paid on supplies.
 *
 * Compare `jp` below, where consumption tax *is* reclaimable and the chart
 * carries both halves.
 */
const US_GAAP: ChartTemplateDefinition = {
  id: 'us_gaap',
  label: 'United States',
  summary:
    'Four-digit convention: 1000s assets, 2000s liabilities, 4000s revenue, 5000s cost of sales. Sales tax is collected and remitted, never reclaimed — so there is no input-tax account.',
  statutory: false,
  accounts: [
    { code: '1000', name: 'Cash', type: 'asset' },
    { code: '1010', name: 'Checking Account', type: 'asset' },
    { code: '1200', name: 'Accounts Receivable', type: 'asset' },
    { code: '1300', name: 'Inventory', type: 'asset', monetary: false },
    { code: '1500', name: 'Equipment', type: 'asset', monetary: false },
    {
      code: '1590',
      name: 'Accumulated Depreciation',
      type: 'asset',
      overdraft: true,
      monetary: false,
      note: 'Contra-asset.',
    },
    { code: '2000', name: 'Accounts Payable', type: 'liability', overdraft: true },
    {
      code: '2200',
      name: 'Sales Tax Payable',
      type: 'liability',
      overdraft: true,
      note: 'Collected from customers and remitted to the state. There is no matching asset: sales tax paid on purchases is a cost, not a credit.',
    },
    { code: '2300', name: 'Payroll Liabilities', type: 'liability', overdraft: true },
    { code: '2500', name: 'Notes Payable', type: 'liability', overdraft: true },
    { code: '3000', name: "Owner's Equity", type: 'equity', overdraft: true },
    {
      code: '3900',
      name: 'Retained Earnings',
      type: 'equity',
      overdraft: true,
      role: 'retained_earnings',
    },
    { code: '4000', name: 'Sales', type: 'revenue', overdraft: true },
    { code: '4900', name: 'Other Income', type: 'revenue', overdraft: true },
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense' },
    { code: '5100', name: 'Freight and Duty', type: 'expense' },
    { code: '6000', name: 'Salaries and Wages', type: 'expense' },
    { code: '6200', name: 'Rent', type: 'expense' },
    { code: '6500', name: 'General and Administrative', type: 'expense' },
    { code: '6700', name: 'Depreciation', type: 'expense' },
    {
      code: '6900',
      name: 'Foreign Exchange Gain/Loss',
      type: 'expense',
      overdraft: true,
      role: 'fx_gain_loss',
    },
  ],
};

/**
 * Japan.
 *
 * Japanese companies keep books in 勘定科目 (account titles) and, unlike
 * Vietnam, there is no single statutory chart — the Companies Act and the
 * financial statement rules prescribe the *shape* of the statements rather
 * than a numbered list of accounts, so numbering is the company's own. This
 * is a conventional chart with the titles a trading company actually uses.
 *
 * Consumption tax (消費税) is the opposite of US sales tax and the same
 * shape as VAT: it is charged on sales and reclaimable on purchases, so the
 * chart carries **both** halves — 仮払消費税, the tax paid and recoverable,
 * as an asset, and 仮受消費税, the tax collected and owed, as a liability.
 * The return is the net of the two.
 */
const JP: ChartTemplateDefinition = {
  id: 'jp',
  label: '日本 — Japan',
  summary:
    'Japanese account titles. Consumption tax is reclaimable, so the chart carries both the tax paid (仮払消費税) and the tax collected (仮受消費税) — the return is the net.',
  statutory: false,
  accounts: [
    { code: '100', name: '現金 — Cash', type: 'asset' },
    { code: '110', name: '普通預金 — Bank deposit', type: 'asset' },
    { code: '130', name: '売掛金 — Accounts receivable', type: 'asset' },
    {
      code: '140',
      name: '仮払消費税 — Consumption tax paid',
      type: 'asset',
      note: 'Reclaimable against tax collected, which is why it is an asset and not a cost.',
    },
    { code: '150', name: '商品 — Merchandise inventory', type: 'asset', monetary: false },
    { code: '160', name: '製品 — Finished goods', type: 'asset', monetary: false },
    { code: '200', name: '機械装置 — Machinery and equipment', type: 'asset', monetary: false },
    {
      code: '290',
      name: '減価償却累計額 — Accumulated depreciation',
      type: 'asset',
      overdraft: true,
      monetary: false,
      note: 'Contra-asset.',
    },
    { code: '300', name: '買掛金 — Accounts payable', type: 'liability', overdraft: true },
    { code: '310', name: '未払金 — Accrued payables', type: 'liability', overdraft: true },
    {
      code: '320',
      name: '仮受消費税 — Consumption tax received',
      type: 'liability',
      overdraft: true,
      note: 'Collected on sales and owed to the tax office, net of 仮払消費税.',
    },
    { code: '350', name: '前受金 — Advances from customers', type: 'liability', overdraft: true },
    { code: '400', name: '資本金 — Share capital', type: 'equity', overdraft: true },
    {
      code: '490',
      name: '繰越利益剰余金 — Retained earnings',
      type: 'equity',
      overdraft: true,
      role: 'retained_earnings',
    },
    { code: '500', name: '売上高 — Sales', type: 'revenue', overdraft: true },
    { code: '590', name: '営業外収益 — Non-operating income', type: 'revenue', overdraft: true },
    { code: '600', name: '売上原価 — Cost of sales', type: 'expense' },
    { code: '610', name: '荷造運賃 — Packing and freight', type: 'expense' },
    { code: '700', name: '給料手当 — Salaries and allowances', type: 'expense' },
    {
      code: '750',
      name: '販売費及び一般管理費 — Selling, general and administrative',
      type: 'expense',
    },
    { code: '780', name: '減価償却費 — Depreciation expense', type: 'expense' },
    {
      code: '790',
      name: '為替差損益 — Foreign exchange gain/loss',
      type: 'expense',
      overdraft: true,
      role: 'fx_gain_loss',
    },
  ],
};

export const CHART_TEMPLATE_DEFINITIONS: Record<ChartTemplate, ChartTemplateDefinition> = {
  generic: GENERIC,
  au_nz: AU_NZ,
  us_gaap: US_GAAP,
  jp: JP,
  vn_tt200: VN_TT200,
};

/**
 * TT200's leading digit, mapped onto this model's five account types.
 *
 * The mapping is not one-to-one, and the places it is not are the interesting
 * ones:
 *
 *  - **1 and 2 are both assets** (current and non-current). A balance sheet
 *    distinguishes them; the posting rules do not.
 *  - **5 and 7 are both revenue** (operating revenue, other income), and
 *    **6 and 8 are both expenses** (operating, other). Again a presentation
 *    distinction rather than a posting one.
 *  - **9 has no equivalent at all.** 911 is a clearing account that exists for
 *    the duration of a period close and holds nothing outside it. It is
 *    deliberately absent — see the ADR.
 */
export const TT200_DIGIT_TYPES: Record<string, AccountType> = {
  '1': 'asset',
  '2': 'asset',
  '3': 'liability',
  '4': 'equity',
  '5': 'revenue',
  '6': 'expense',
  '7': 'revenue',
  '8': 'expense',
};

/** Whether a code's leading digit agrees with the type, under TT200. */
export function agreesWithTt200(code: string, type: AccountType): boolean {
  const expected = TT200_DIGIT_TYPES[code.slice(0, 1)];
  return expected !== undefined && expected === type;
}

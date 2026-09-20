/**
 * The interface in English.
 *
 * This object is the *shape*: every other language is typed as `typeof en`, so
 * a missing key is a compile error rather than an English word appearing in
 * the middle of a Vietnamese sentence. A half-translated interface is the
 * failure mode worth engineering against, because it is invisible to whoever
 * did the translating.
 *
 * Values that take arguments are functions rather than templates with
 * placeholders. `{count} deliveries` forces every language to put the number
 * in the same place and leaves the formatting to a regex; a function puts the
 * whole sentence under the translator's control and under the type checker's.
 */
export const en = {
  common: {
    appName: 'Obol',
    signIn: 'Sign in',
    signOut: 'Sign out',
    search: 'Search…',
    cancel: 'Cancel',
    back: 'Back',
    none: 'None',
    reading: (org: string) => `Reading ${org}`,
    colourTheme: 'Colour theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    language: 'Language',
    skipToContent: 'Skip to content',
    working: 'Working…',
  },

  nav: {
    primary: 'Primary',
    overview: 'Overview',
    accounts: 'Accounts',
    stock: 'Stock',
    journal: 'Journal',
    reports: 'Reports',
    monthEnd: 'Month end',
    newEntry: 'New entry',
    webhooks: 'Webhooks',
    api: 'API',
    settings: 'Settings',
    morePages: 'More pages',
  },

  overview: {
    title: 'Overview',
    description: 'Every figure below is derived from postings that are balanced by construction.',
    postEntry: 'Post an entry',

    balanced: 'The books balance',
    notBalanced: 'The books do not balance',
    balancedBody: 'Debits equal credits across every currency, with a residual of exactly zero.',
    notBalancedBody:
      'A residual other than zero means cached balances no longer match their postings.',
    debits: 'Debits',
    credits: 'Credits',
    residual: 'Residual',

    cashAndAssets: 'Cash & assets',
    debitNormalBalances: 'Debit-normal balances',
    revenue: 'Revenue',
    revenueDetail: 'Credit-normal, shown positive',
    expenses: 'Expenses',
    entriesPosted: 'Entries posted',
    entriesDetail: (postings: string, accounts: number) =>
      `${postings} postings across ${accounts} accounts`,

    volumeTitle: 'Daily posting volume',
    volumeHint: 'Debit side only, last 30 days — every entry has an equal credit.',

    positionTitle: 'Position by class',
    positionHint: 'Assets + Expenses = Liabilities + Equity + Revenue',
    positionEmpty: 'No accounts yet',
    positionEmptyBody: 'Open an account to start recording entries.',
    positionCaption: 'Total balance by account class',
    klass: 'Class',
    accountCount: 'Accounts',
    balanceIn: (currency: string) => `Balance (${currency})`,
    debitSide: 'Debit side',
    creditSide: 'Credit side',
    equationHolds: 'Equation holds',
    equationBroken: 'Equation broken',

    recentTitle: 'Recent entries',
    fullJournal: 'Full journal',
    journalEmpty: 'The journal is empty',
    journalEmptyBody: 'Post your first entry to see it appear here.',
    recentCaption: 'The six most recent journal entries',
    date: 'Date',
    entryDescription: 'Description',
    accounts: 'Accounts',
    amount: 'Amount',
  },

  accounts: {
    title: 'Chart of accounts',
    description:
      'Grouped by class. Balances are shown the way an accountant reads them — positive means healthy, whichever side the account normally sits on.',
    postEntry: 'Post an entry',

    emptyTitle: 'No accounts yet',
    emptyBody:
      'Accounts are created through the API. Run pnpm db:seed to load a month of example books.',

    asset: 'Assets',
    liability: 'Liabilities',
    equity: 'Equity',
    revenue: 'Revenue',
    expense: 'Expenses',

    assetBlurb: 'What the business owns. Debits increase these.',
    liabilityBlurb: 'What the business owes. Credits increase these.',
    equityBlurb: "The owners' residual claim. Credits increase these.",
    revenueBlurb: 'Income earned. Credits increase these.',
    expenseBlurb: 'Costs incurred. Debits increase these.',

    normalDebit: 'Debit-normal',
    normalCredit: 'Credit-normal',

    tableCaption: (group: string) => `${group} accounts and balances`,
    code: 'Code',
    account: 'Account',
    identifier: 'Identifier',
    overdraft: 'Overdraft',
    balance: 'Balance',
    statement: 'Statement',
    closed: 'Closed',
    overdraftAllowed: 'Allowed',
    overdraftBlocked: 'Blocked',

    overdraftNote:
      'Accounts with overdraft blocked cannot be pushed below zero. That rule is enforced by a CHECK constraint in Postgres as well as by the service, so it holds even for a writer that bypasses this application.',
  },

  stock: {
    title: 'Stock',
    description:
      'Every delivery is kept as its own lot with its own price. When something ships, the ledger works out what it cost from the lots it came from — and tells you which ones.',
    importButton: 'Import from a spreadsheet',

    inTheYard: 'What is in the yard',
    inTheYardHint: 'Values are what you paid, not what you will sell it for.',
    tableCaption: 'Products held, with quantity on hand and cost value',
    product: 'Product',
    onHand: 'On hand',
    deliveriesOpen: 'Deliveries open',
    costedBy: 'Costed by',
    value: 'Value',
    totalValue: 'Total stock value',
    justThisProduct: 'just this product',

    emptyTitle: 'No products yet',
    emptyBody:
      'Add the things you buy and sell. Once a product exists you can book deliveries against it, and the ledger will work out what each shipment cost.',

    addProduct: 'Add a product',
    addProductHint:
      'A product is anything you buy in and sell on. You need one before you can book a delivery.',
    addProductButton: 'Add product',
    needAccounts:
      'You need an asset account for the stock to sit in and an expense account for the cost of sales. Open them on the',
    chartOfAccountsLink: 'chart of accounts',
    firstSuffix: 'first.',

    productCode: 'Product code',
    productCodeHint: 'What you call it on a packing list.',
    name: 'Name',
    namePlaceholder: 'Granite paver 600×600',
    measuredIn: 'Measured in',
    measuredInHint: 'Square metres, tonnes, pieces — whatever you invoice in.',
    costingMethod: 'Costing method',
    costingMethodHint: 'Leave as the company default unless this product is one-of-a-kind.',
    companyDefault: 'Company default',
    stockAccount: 'Stock account',
    stockAccountHint: 'Where the value sits while you hold it.',
    cogsAccount: 'Cost of sales account',
    cogsAccountHint: 'Where the cost goes when it ships.',

    methodFifo: 'Oldest delivery first',
    methodLifo: 'Newest delivery first',
    methodAverage: 'Average across deliveries',
    methodSpecific: 'Delivery picked by hand',
    methodFifoOption: 'Oldest delivery first (FIFO)',
    methodAverageOption: 'Average across deliveries',
    methodSpecificOption: 'Pick the delivery by hand',
  },

  product: {
    allStock: 'All stock',
    measuredInSuffix: (unit: string) => `measured in ${unit}`,
    onHand: 'On hand',
    whatItCost: 'What it cost you',
    deliveriesStillOpen: 'Deliveries still open',

    lotsTitle: 'Deliveries you still hold',
    lotsHint: 'Oldest first — the order they will be used in unless you say otherwise.',
    lotsCaption: 'Open deliveries, oldest first',
    reference: 'Reference',
    arrived: 'Arrived',
    left: 'Left',
    paidForLot: 'Paid for the lot',
    valueOfRemainder: 'Value of what is left',
    ofTotal: (total: string) => `of ${total}`,
    delivery: 'Delivery',
    openingBalance: 'Opening balance',
    nothingOnHand: 'Nothing on hand',
    nothingOnHandBody:
      'Book in a delivery below and it will appear here as its own lot, with its own price.',

    receiveTitle: 'Book in a delivery',
    receiveHint:
      'This opens a new lot and posts the purchase to the ledger in one go, so the stock records and the accounts cannot disagree.',
    receiveButton: 'Book in this delivery',
    howMuchArrived: (unit: string) => `How much arrived (${unit})`,
    decimalHint: (places: number) =>
      places > 0 ? `Up to ${places} decimal places.` : 'Whole units.',
    paidInTotal: 'What you paid in total',
    paidInTotalHint: 'The whole delivery, not the unit price.',
    paidIn: 'Paid in',
    paidFrom: 'Paid from / owed to',
    paidFromHint: 'The bank account it left, or the supplier you now owe.',
    dateArrived: 'Date it arrived',
    referenceHint: 'Container or invoice number. This is what the costing report will show you.',
    needCreditAccount: 'Open a bank account or a supplier payable on the',

    issueTitle: 'Ship it out',
    issueHint:
      'The ledger works out what it cost from the lots it came from, and refuses if there is not enough.',
    issueButton: 'Ship it out',
    howMuchWentOut: (unit: string) => `How much went out (${unit})`,
    dateShipped: 'Date it shipped',
    issueReferenceHint: 'Your sales order or invoice number.',
    whichDelivery: 'Which delivery',
    whichDeliveryOptional: 'Which delivery (optional)',
    whichDeliveryRequiredHint:
      'This product is costed one piece at a time, so the delivery has to be named.',
    whichDeliveryOptionalHint: 'Leave blank and the oldest delivery is used first.',
    chooseDelivery: 'Choose a delivery…',
    oldestFirst: 'Oldest first',
    lotOption: (reference: string, quantity: string) => `${reference} — ${quantity} left`,
    nothingToShip: 'There is nothing on hand to ship. Book in a delivery first.',

    movementsTitle: 'Everything that has moved',
    movementsHint:
      'Each shipment shows which deliveries it was costed from. This is the working you would otherwise keep in a spreadsheet.',
    movementsCaption: 'Stock movements, most recent first',
    date: 'Date',
    whatHappened: 'What happened',
    quantity: 'Quantity',
    costedFrom: 'Costed from',
    cost: 'Cost',
    deliveryIn: 'Delivery in',
    shippedOut: 'Shipped out',
    nothingMoved: 'Nothing has moved yet',
    nothingMovedBody: 'Deliveries and shipments will be listed here.',
  },

  journal: {
    title: 'Journal',
    description:
      'Every entry, newest first, with its postings. Entries are append-only: a mistake is corrected by posting a reversing entry, never by editing history.',
    entries: 'Entries',
    noMatches: 'No entries match those filters',
    noMatchesBody:
      'Try a shorter search term, or widen the account filter. The journal itself is unchanged.',
    clearFilters: 'Clear filters',
    empty: 'Nothing posted yet',
    emptyBody:
      'The journal is empty. Post an entry, or run pnpm db:seed to load a month of example books.',
    postEntry: 'Post an entry',
    caption: 'Journal entries with their postings',
    date: 'Date',
    descriptionOrAccount: 'Description / account',
    amount: 'Amount',
    debit: 'Debit',
    credit: 'Credit',
    reversed: 'Reversed',
    reversal: 'Reversal',
    balanced: 'Balanced',
  },

  transfer: {
    title: 'Post an entry',
    description:
      'Record a journal entry. The balance is checked as you type, again in the domain layer, and a third time by Postgres at COMMIT.',
  },

  reports: {
    title: 'Reports',
    description:
      'The two statements a ledger exists to produce. Both are derived from the same postings as everything else — no separate reporting store to fall out of step.',
    sheetBalances: 'The balance sheet balances',
    sheetDoesNot: 'The balance sheet does not balance',
    assets: 'Assets',
    amount: 'Amount',
    sectionCaption: (section: string) => `${section} by account`,
    sectionEmpty: (section: string) => `No ${section.toLowerCase()} accounts in this currency.`,
    sectionTotal: (section: string) => `Total ${section}`,
    equation: 'Assets = Liabilities + Equity + retained earnings',
    liabilitiesPlusEquity: 'Liabilities + equity',
    period30: '30 days',
    period90: '90 days',
    period365: '12 months',
    balanceSheet: 'Balance sheet',
    asAt: (date: string) => `Position as at ${date}`,
    retainedEarnings: 'Retained earnings',
    incomeStatement: 'Income statement',
    reportingPeriod: 'Reporting period',
    netIncome: 'Net income',
    netIncomeHint: 'Revenue less expenses for the period',
    profit: 'Profit',
    lossOrBreakeven: 'Loss or breakeven',
  },

  monthEnd: {
    title: 'Month end',
    description:
      'Three things, in order, once a month. You can press any of them early — if it is not time yet, the ledger says why instead of doing something wrong.',
    open: 'Open',
    closed: 'Closed',
    entriesInMonth: (count: number) =>
      `${count} entries. Closing happens oldest month first, so this is the one to work on.`,
    allClosed:
      'Every month with entries in it is closed. The next one becomes available once the month has finished.',

    step1: 'Put in the exchange rates',
    step1NoForeign: (functional: string) =>
      `You only hold ${functional}, so there are no rates to enter. Nothing to do here.`,
    step1Body: (day: string, currencies: string) =>
      `On ${day}, what was one unit of each foreign currency worth? Use the rate your bank or the central bank published that day. You hold ${currencies}.`,
    step1Done: (currencies: string) => `Rates on file for ${currencies}.`,

    step2: 'Update what your foreign money is worth',
    step2NoForeign: (functional: string) =>
      `Nothing to update — every account is already in ${functional}.`,
    step2Body: (currencies: string, functional: string) =>
      `Your customers owe you in ${currencies}. Those amounts are worth a different number of ${functional} now than when you invoiced. This works out the difference and records it as income or expense.`,
    whatWillChange: 'What will change if you press this:',
    step2Button: 'Update foreign balances',
    step2Pending: 'Updating…',

    step3: 'Close the month',
    step3Body: (month: string) =>
      `After this, nobody can add or change an entry dated in ${month}. That is what makes the month's figures final. Your profit for the month moves into retained earnings. You can reopen it if you have to.`,
    step3Button: 'Close the month',
    step3Pending: 'Closing…',
    step3Confirm: (month: string) =>
      `Close ${month}? Entries dated in it can no longer be added or changed.`,

    months: 'Months',
    rateCurrency: 'Currency',
    rateWorth: (functional: string) => `Worth this many ${functional}`,
    rateSave: 'Save rate',
    rateSaving: 'Saving…',
    noMonths: 'No entries yet, so no months to close.',
    reopen: 'Reopen',
    stepNumber: (n: number) => `Step ${n}`,
  },

  aging: {
    title: 'Who owes what',
    description:
      'How long the money has been outstanding. Built from the same postings as everything else — there is no separate receivables ledger to fall out of step.',
    receivables: 'Owed to you',
    payables: 'Owed by you',
    caption: (account: string) => `${account}, oldest first`,
    invoice: 'Invoice',
    dated: 'Dated',
    age: 'Age',
    outstanding: 'Outstanding',
    days: (count: number) => `${count} days`,
    current: 'Up to 30 days',
    days31to60: '31–60 days',
    days61to90: '61–90 days',
    over90: 'Over 90 days',
    total: 'Total',
    overdue: (percent: string) => `${percent}% past 30 days`,
    emptyTitle: 'Nothing outstanding',
    emptyBody: 'Every invoice on these accounts has been settled.',
    convention:
      'Nothing records which invoice a payment settled, so the oldest open one is taken first. That is a convention, not a fact — it matters when a customer pays a later invoice and disputes an earlier one.',
    credit: 'in credit',
  },

  shipments: {
    title: 'Shipments',
    description:
      'What each container actually cost to land. Freight, duty and handling belong in the value of the stock, not in this month\u2019s expenses — and the difference is usually not small.',
    caption: 'Shipments, most recent first',
    reference: 'Reference',
    arrived: 'Arrived',
    lots: 'Lots',
    goods: 'Goods invoiced',
    charges: 'Freight & duty',
    landed: 'Landed cost',
    uplift: 'Uplift',
    emptyTitle: 'No shipments yet',
    emptyBody:
      'A shipment groups the deliveries that arrived together, so a freight invoice can be spread across them when it turns up weeks later.',
    newShipment: 'Record a shipment',
    newShipmentHint:
      'Give it the reference you already use — a container number or a bill of lading.',
    create: 'Record it',

    lotsTitle: 'What arrived',
    chargesTitle: 'What it cost to get here',
    chargesHint:
      'Each charge is spread across the lots above and raises what they are carried at. A charge that arrives after some of the stock has sold puts that part to cost of sales instead, because it cannot be added to a lot nobody has.',
    chargesCaption: 'Charges on this shipment',
    noCharges: 'No charges yet',
    noChargesBody: 'Add the freight invoice, the duty and the broker\u2019s fee as they arrive.',
    kind: 'What it is',
    chargeDescription: 'Description',
    amount: 'Amount',
    toStock: 'Onto the stock',
    toCogs: 'To cost of sales',
    notCapitalised: 'not part of the cost',

    addCharge: 'Add a charge',
    basis: 'Spread it by',
    basisValue: 'Value of each lot',
    basisQuantity: 'Quantity',
    basisWeight: 'Weight',
    basisHint: 'Ocean freight is usually charged by volume; duty is charged on value.',
    kindFreight: 'Freight',
    kindDuty: 'Import duty',
    kindInsurance: 'Insurance',
    kindHandling: 'Handling & haulage',
    kindTax: 'Import tax',
    kindOther: 'Other',
    creditAccount: 'Owed to / paid from',
    capitalise: 'Part of what the goods cost',
    capitaliseHint:
      'Yes for freight, duty and handling. No for recoverable import VAT — you get that back, so it never was a cost.',
    capitaliseYes: 'Yes — add it to the stock',
    capitaliseNo: 'No — it is reclaimable',
    debitAccount: 'Account for the reclaimable part',
    chargeDate: 'Date of the charge',
    submit: 'Add this charge',
    checkFirst: 'Check what it does',
    previewTitle: 'What this charge will do',
  },

  stockImport: {
    title: 'Import deliveries',
    description:
      'Paste the purchase history you already keep. Each row becomes a delivery with its own price, and the purchase is posted to the ledger at the same time.',

    requirementsTitle: 'What the file needs',
    requirementsHint:
      'A header row and four columns. Everything else is optional, and any column that is not one of these is ignored rather than rejected.',
    separatorsNote:
      'Tab, comma and semicolon separators are all read — pasting straight out of Excel works, and so does a file exported on a machine that uses the comma as a decimal mark.',

    colProductCode: 'Product code',
    colProductCodeHint: 'sku, code, product code, mã hàng',
    colDate: 'Date received',
    colDateHint: 'date, received, arrived, ngày — 10/01/2026 is 10 January',
    colQuantity: 'Quantity',
    colQuantityHint: 'quantity, qty, số lượng',
    colCost: 'Total cost',
    colCostHint: 'cost, total, amount, thành tiền — the whole delivery, not per unit',
    colNameUnit: 'Name and unit',
    colNameUnitHint: 'Only needed for a product that does not exist yet',
    colCurrency: 'Currency',
    colCurrencyHint: 'Defaults to the currency the books are kept in',
    colReference: 'Reference',
    colReferenceHint: 'reference, container, invoice, lot — what the costing report shows',

    yourRows: 'Your rows',
    yourRowsHint:
      'Nothing is written until you have seen every row and pressed import. If one row is wrong, none of them are imported — a half-imported set of books is worse than none.',
    pasteLabel: 'Paste your rows',
    pastePlaceholder:
      'Product Code\tName\tUnit\tDate Received\tQuantity\tTotal Cost\tContainer\nPAV-600\tGranite paver 600×600\tm2\t10/01/2026\t1000\t40000.00\tCONT-4417',
    pasteHint:
      "Select the block in Excel and paste it here, header row and all. A .csv file's contents work too.",
    chargeTo: 'Charge the deliveries to',
    chargeToHint: 'The supplier you owe, or the bank it came out of.',
    stockAccountHint: 'For any product the file opens.',
    cogsAccountHint: 'Where its cost goes later.',
    checkButton: 'Check the rows',
    checking: 'Reading…',
    importing: 'Importing…',
    importButton: (count: number) => `Import ${count} deliver${count === 1 ? 'y' : 'ies'}`,
    needAccounts:
      'You need a stock asset account, a cost-of-sales expense account and something to charge the deliveries to. Open them on the',

    separatorTab: 'Tab separated — read straight out of Excel.',
    separatorSemicolon:
      'Semicolon separated, which is what Excel writes in most of Europe and in Vietnam.',
    separatorComma: 'Comma separated.',
    ignoredColumns: (columns: string) =>
      `Columns not used: ${columns}. Nothing was lost — they are simply not part of a delivery.`,
    missingColumnsInline: (columns: string) =>
      `No ${columns} column was found. The rows below are shown as they were read, so you can see which header did not match.`,

    previewCaption: 'Every row as the ledger read it',
    importFailed: 'Nothing was imported. Fix these rows and try again.',
    row: 'Row',
    status: 'Status',
    ready: 'Ready',
    newBadge: 'new',
    fixFirst:
      'Fix the rows marked above and check again. The import is all or nothing — it will not bring in the good rows and leave the rest.',
    rowProblem: (line: number, problem: string) => `Row ${line}: ${problem}`,
  },
} as const;

/**
 * The same shape, with the strings widened.
 *
 * `as const` above makes every value a *literal* type, which is what stops a
 * key being silently dropped — but it would also insist that the Vietnamese
 * word for "Cancel" is the string `'Cancel'`. Widening a string to `string`
 * and a function to its own signature keeps the two properties worth having:
 * every key must be present, and a message taking a quantity must take a
 * quantity in every language.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

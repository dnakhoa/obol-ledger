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
    somethingWentWrong: 'Something went wrong',
    routeErrorBody:
      'This page could not be loaded. Nothing was written to the ledger — every mutation happens inside a database transaction, so a failure leaves no partial entry behind.',
    errorReference: 'Reference',
    pageNotFound: 'That page does not exist',
    keepYourOwnBooks: 'Keep your own books',
    working: 'Working…',
    refusalSignIn:
      'Sign in to keep your own books. This is the published demo, which anyone can read and nobody can change.',
    refusalNoLedger: 'This account has no ledger yet. Create one to start posting entries.',
    refusalReadOnly: 'Your role on this ledger is read-only.',
  },

  nav: {
    primary: 'Primary',
    overview: 'Overview',
    accounts: 'Accounts',
    stock: 'Stock',
    sales: 'Sales',
    journal: 'Journal',
    reports: 'Reports',
    monthEnd: 'Month end',
    tax: 'Tax',
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
    sellButton: 'Raise an invoice',

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
    writeOffTitle: 'Write stock off',
    writeOffHint:
      'Broken, past its date, lost, or short at a stocktake. Costed from the lots exactly as a sale would be, and posted to the expense you choose — so shrinkage does not hide inside cost of sales.',
    writeOffButton: 'Write it off',
    howMuchWrittenOff: (unit: string) => `How much (${unit})`,
    reason: 'Why',
    reasonDamaged: 'Damaged or broken',
    reasonExpired: 'Past its date',
    reasonLost: 'Lost',
    reasonCountShortfall: 'Short at stocktake',
    reasonOther: 'Other',
    lossAccount: 'Loss account',
    lossAccountHint: 'An expense: stock losses, breakage, obsolescence.',
    writeOffReferenceHint: 'The stocktake sheet or damage report.',
    needLossAccount: 'Open an expense account for stock losses on the',
    writtenOff: 'Written off',
    sold: 'Sold',
    soldFor: 'Sold for',
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
    enteredBy: 'Entered by',
    viaUi: 'Entered by hand',
    viaApi: 'Through the API',
    viaSystem: 'Written by the ledger',
    viaImport: 'From a spreadsheet',
    viaUnknown: 'Not recorded',
  },

  transfer: {
    title: 'Post an entry',
    description:
      'Record a journal entry. The balance is checked as you type, again in the domain layer, and a third time by Postgres at COMMIT.',
    tooMany: (seconds: number) => `Too many entries posted. Try again in ${seconds} seconds.`,
    checkFields: 'The entry could not be posted. Check the highlighted fields.',
    notAnAmount: (line: number, amount: string, currency: string) =>
      `Line ${line}: “${amount}” is not a valid amount in ${currency}.`,
    notRepresentable: (currency: string) => `Not representable in ${currency}`,
    posted: (id: string) => `Entry posted as ${id}.`,
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

    rateNotANumber: 'Enter a rate as a plain number, for example 25700.',
    rateSaved: (base: string, rate: string, functional: string, day: string) =>
      `Saved 1 ${base} = ${rate} ${functional} for ${day}.`,
    pickMonth: 'Pick a month first.',
    revalued: (count: number) =>
      `Updated ${count} foreign ${count === 1 ? 'balance' : 'balances'} to the month-end rate.`,
    nothingToRevalue:
      'Checked every foreign balance — the rates had not moved, so nothing needed changing.',
    monthClosed: (month: string) => `${month} is closed. Its figures will not change again.`,
    monthReopened: (month: string) =>
      `${month} is open again. The closing entry has been reversed, and both stay on the record.`,
  },

  misc: {
    entriesNote:
      'Each entry’s postings sum to zero — verified at COMMIT by a deferred database constraint.',
    statementNote:
      'Settled entries, newest first. The running balance is computed by Postgres over this account’s own postings, so it reconciles with the posted balance above.',
    filterMatchNote: 'Showing entries matching the filters below.',
    newer: 'Newer',
    older: 'Older',
    showingEntries: (count: number) => `Showing ${count} ${count === 1 ? 'entry' : 'entries'}`,
    showingLines: (count: number) => `Showing ${count} ${count === 1 ? 'line' : 'lines'}`,
    applyFilters: 'Apply',
    clearFilters: 'Clear',
    chartDay: 'Day',
    chartVolume: (currency: string) => `Volume (${currency})`,
    chartCaption: (currency: string) => `Daily posting volume in ${currency}`,
    alreadyReversedNote:
      'This entry has already been reversed, and an entry can only be reversed once — otherwise the correction would be applied twice.',
    reopenNote:
      'A closed month can be reopened. The original closing entry stays on the record and a reversing one cancels it, so there is always a trail.',
    signInPitch:
      'Sign in and you get a ledger of your own — your chart of accounts, your entries, your currency. The demo stays where it is.',
    overdraftNote:
      'When off, a posting that would take this account below zero is refused — by a CHECK constraint in Postgres as well as by the application. Contra accounts and most liability, equity and revenue accounts need this on.',
    settleNote:
      'Settling re-checks the overdraft rule — funds available at authorisation may be gone by now.',
    starterChartNote:
      'A starter chart of accounts comes with it. You can rename, add and close accounts afterwards.',
    exportCsv: 'Export CSV',
    tryAgain: 'Try again',
    inEffect: 'In effect',
    allAccounts: 'All accounts',
    viewJournal: 'View journal',
    viewAsTable: 'View as table',
    noActivity: 'No activity to plot yet.',
    fundsReserved: 'Funds are reserved, so they are already out of',
    retainedNote: 'Revenue less expenses, folded into equity as it would be at period close',
    reading: 'Reading',
    noDatabase: 'The ledger has no database yet',

    notFoundBody: 'The account or entry you asked for is not in this ledger.',
    backToOverview: 'Back to the overview',
    noPassword: 'No password to choose or lose. Nothing is stored that could leak one.',
    readDemo: 'Read the demo ledger',
    onboardingIntro:
      'One question before you start, because it is the one that cannot be changed later.',
    chartIsAStart: 'A starting point, not a cage \u2014 except where the law says otherwise.',

    accountFormIntro: 'A name and a class. The class determines which side increases the balance.',
    accountsNeverDeleted:
      'Accounts are never deleted. They can be closed, which keeps their history intact.',
    filterDescription: 'Description',
    filterAccount: 'Account',

    viewReversal: 'View the reversal',
    noEditing: 'Entries cannot be edited. A mistake is corrected by posting a reversing entry.',
    reverseThis: 'Reverse this entry',
    reverseNote: 'This posts a new entry, it does not delete this one',
    entryPending: 'This entry is pending',
    cancelIt: 'Cancel it',
    cancelledNote:
      'This entry was cancelled before it settled, so it never reached the balances. There is nothing to reverse \u2014 a reversal cancels money that moved, and none did.',
  },

  entry: {
    pending: 'Pending',
    cancelled: 'Cancelled',
    reversed: 'Reversed',
    reversingEntry: 'Reversing entry',
    amount: 'Amount',
    occurred: 'Occurred',
    postings: 'Postings',
    postingsHint: 'In the order the entry was written.',
    sumsToZero: 'Summing to zero, verified at COMMIT',
    metadata: 'Metadata',
    account: 'Account',
    ownedByStockTitle: 'Written by the stock records',
    ownedByStock:
      'This entry moved stock as well as money, so it cannot be reversed here — that would move the account without moving the lots behind it. Correct it from the stock pages: a write-off, or a further charge on the shipment.',
    openSale: 'Open the invoice',
    cancelledByReversal:
      'This entry was cancelled by a later reversing entry. It stays on the record; its net effect is zero.',
    cancelsEarlier: 'This entry exists to cancel an earlier one. Both stay on the record.',
    viewOriginal: 'View the original',
    reservedNotMoved: 'Reserved, not yet moved',
    cancelledNeverMoved: 'Cancelled; never moved',
    debitSideMatches: 'Debit side; credits match exactly',
    metadataHintBefore: 'The caller’s own references. Opaque to the ledger, and searchable —',
    metadataHintAfter: 'on the journal.',
  },

  statement: {
    closed: 'Closed',
    pendingNote: 'Pending \u2014 not yet in the balance',
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
    balance: 'Balance',
    title: 'Statement',
    emptyTitle: 'No postings yet',
    emptyBody:
      'Nothing has been posted to this account. It will appear here the moment something is.',
    line: 'line',
    postedBalance: 'Posted balance',
    postedHint: 'Settled entries only \u2014 what is actually there',
    available: 'Available',
    pending: 'Pending',
    pendingHint: 'Settled plus in-flight \u2014 what it becomes if everything lands',
    openAnAccount: 'Open an account',
    classHint:
      'The class you choose is not cosmetic: it decides which side increases the balance, and how the account is presented everywhere it appears.',
    reopening: 'Reopening\u2026',
  },

  forms: {
    entryDetails: 'Entry details',
    entryDetailsHint: 'What happened, and what it is denominated in.',
    description: 'Description',
    descriptionHint: 'What this entry records, e.g. \u201cInvoice 1042 settled\u201d.',
    descriptionPlaceholder: 'Coffee beans purchased',
    currency: 'Currency',
    postings: 'Postings',
    postingsHint: 'Debits and credits must total the same amount. Nothing else is a valid entry.',
    lineAccount: 'Line {n} account',
    sumToZero: 'An entry is only accepted when its postings sum to zero.',
    selectAccount: 'Select an account\u2026',
    side: 'Side',
    amount: 'Amount',
    addPosting: 'Add a posting',
    remove: 'Remove',
    incomplete: 'Incomplete',
    entryFailed: 'The entry could not be posted.',
    postEntry: 'Post the entry',
    posting: 'Posting\u2026',

    accountDetails: 'Account details',
    accountName: 'Name',
    accountNameHint: 'Unique within its currency, e.g. \u201cOperating Cash\u201d.',
    accountNamePlaceholder: 'Operating Cash',
    accountClass: 'Class',
    allowOverdraft: 'Allow overdraft',
    accountFailed: 'The account could not be opened.',
    openAccount: 'Open account',
    opening: 'Opening\u2026',
    yourLedger: 'Your ledger',
    ledgerName: 'Name',
    ledgerNameHint: 'Only you will see this.',
    chartOfAccounts: 'Chart of accounts',
    functionalCurrency: 'Functional currency',
    functionalCurrencyHint:
      'The currency your books are kept in. Every entry balances in it, so this cannot be changed later without restating everything you have posted.',
    createLedger: 'Create my ledger',
    creating: 'Creating\u2026',
    somethingWrong: 'Something went wrong.',

    searchEntries: 'Search entries\u2026',
    anyAccount: 'Any account',
    noMatch: 'No entries match. Try a shorter search term, or clear the filters.',
    pagination: 'Pagination',

    reversalDescription: 'Description for the reversing entry',
    reversalHint:
      'Optional. Defaults to \u201cReversal of \u2026\u201d, which is usually what you want.',
    postReversal: 'Post the reversing entry',
    tooManyReversals: (seconds: number) => `Too many reversals. Try again in ${seconds} seconds.`,
    noEntryGiven: 'No entry was specified.',
    reversedBy: (id: string) => `Reversed by ${id}.`,
    tooManyTransitions: (seconds: number) => `Too many requests. Try again in ${seconds} seconds.`,
    transitionUnavailable: 'That action is not available for this entry.',
    settled: 'Entry settled.',
    cancelledNothingMoved: 'Entry cancelled; nothing moved.',

    tooManyAccounts: (seconds: number) =>
      `Too many accounts created. Try again in ${seconds} seconds.`,
    accountCheckFields: 'The account could not be opened. Check the highlighted fields.',
    accountExists: (name: string, currency: string) =>
      `An account named “${name}” already exists in ${currency}.`,
    alreadyInUse: 'Already in use',
  },

  palette: {
    label: 'Search and commands',
    placeholder: 'Search accounts, entries and pages\u2026',
    results: 'Results',
    searching: 'Searching\u2026',
    pages: 'Pages',
    accounts: 'Accounts',
    entries: 'Entries',
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

  tax: {
    title: 'Tax returns',
    description:
      'What you charged, what you paid, and what that leaves owing. Filing posts the entry that clears both tax accounts, so the credit you have not used stays in the books instead of on a form.',
    codes: 'Tax rates',
    codesDescription:
      'The rates you charge and reclaim. Each one names the accounts its tax lands in, so an entry never has to be told where to put it.',
    noCodes: 'No tax rates set up yet',
    noCodesBody: 'Add the rates you charge before posting a sale or a purchase with tax on it.',
    addCode: 'Add a rate',
    codeName: 'Name',
    rate: 'Rate',
    treatment: 'Kind',
    vat: 'Value added tax',
    reverseCharge: 'Reverse charge',
    salesTax: 'Sales tax',
    inputAccount: 'Tax paid on purchases',
    outputAccount: 'Tax charged on sales',
    none: 'None',
    vatHint: 'Charged on sales, reclaimed on purchases. The ordinary case.',
    reverseChargeHint:
      'Buying a service from abroad: you account for the tax on both sides yourself, and the two cancel out.',
    salesTaxHint:
      'United States. Collected from customers and remitted; tax you pay on your own purchases is a cost, never a credit.',
    period: 'Period to file',
    periodReady: (month: string) => `${month} is ready to file`,
    nothingDue: 'Nothing to file',
    nothingDueBody:
      'Every finished month has been filed. The month you are in now can be filed once it ends.',
    sales: 'Tax charged on sales',
    purchases: 'Tax paid on purchases',
    base: 'Amount before tax',
    taxAmount: 'Tax',
    outputTax: 'Tax charged on sales',
    inputTax: 'Tax paid on purchases',
    broughtForward: 'Credit from last period',
    payable: 'To pay',
    carriedForward: 'Credit into next period',
    fileReturn: 'File this return',
    filing: 'Filing…',
    filed: 'Filed returns',
    filedCaption: 'Returns filed, most recent first',
    filedOn: 'Filed',
    periodColumn: 'Period',
    noReturns: 'No returns filed yet',
    noReturnsBody: 'Once a month with tax in it has finished, it can be filed here.',
    viewEntry: 'View entry',
    noEntry: 'Nothing to post',
    noEntryHint:
      'Nothing was charged on sales this period, so there was nothing to clear against. The whole of the tax you paid carries into the next return.',
    inOrder:
      'Returns are filed in order, oldest first. An unused credit passes from each return to the next, so skipping one would leave the next one short without anything to show it.',
    carriedExplainer:
      'You paid more tax than you charged, so there is nothing to pay. The difference is not refunded — it stays as credit and comes off the next return.',
    pickPeriod: 'Pick a period first.',
    filedNothingOwed: (credit: string) =>
      `Filed. Nothing to pay — ${credit} of credit goes into the next return.`,
    filedOwing: (payable: string) =>
      `Filed. ${payable} is now owed, and sits in the tax payable account until you pay it.`,
    codeIncomplete: 'Give the rate a name and a percentage, for example 10 or 8.25.',
    codeAdded: (name: string) => `Added ${name}.`,
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

    shipmentIncomplete: 'Give the shipment a reference and the date it arrived.',
    recorded: (reference: string) => `Recorded ${reference}.`,
    amountNotANumber: 'Enter the amount as a plain number.',
    chargeIncomplete: 'Check the amount, the description and the accounts.',
    addedToStock: (amount: string) => `Added. ${amount} went onto the stock.`,
    addedSplit: (toStock: string, toCogs: string) =>
      `Added. ${toStock} went onto the stock still held, and ${toCogs} to cost of sales for the part already sold.`,
    addedReclaimable: 'Added. Nothing was added to the stock, because this charge is reclaimable.',
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
    pasteRows: 'Paste the rows in, and choose where the deliveries are charged.',
    rowsLost: 'The rows were lost. Paste them again.',
    noColumn: (columns: string) =>
      `This file has no ${columns} column, so there is nothing to import from it yet. Check the header row.`,
    rowsNeedFixing: (problems: number, rows: number) =>
      `${problems} of ${rows} rows need fixing first. Nothing has been imported.`,
    readyToImport: (rows: number, products: number, readOnly: string) =>
      `${rows} deliver${rows === 1 ? 'y' : 'ies'} ready${products > 0 ? `, opening ${products} new product${products === 1 ? '' : 's'}` : ''}${readOnly === 'yes' ? '. Sign in to import them into your own books' : '. Nothing has been imported yet'}.`,
    imported: (lots: number, products: number) =>
      `Imported ${lots} deliver${lots === 1 ? 'y' : 'ies'}${products > 0 ? `, opening ${products} new product${products === 1 ? '' : 's'}` : ''}. Each one has been posted to the ledger too.`,
  },
  sales: {
    title: 'Sales',
    description:
      'Every invoice ships its stock and posts what it cost in the same entry, so each one knows what it made.',
    marginsButton: 'Gross margin',

    recentTitle: 'Recent invoices',
    recentHint:
      'The invoice total is in the currency it was raised in. Revenue, cost and margin are in the books’ own currency: revenue at the rate on the invoice date, cost at the rate each lot arrived at.',
    tableCaption: 'Invoices, most recent first, with their margin',
    invoice: 'Invoice',
    customer: 'Customer',
    date: 'Date',
    due: 'Due',
    onReceipt: 'On receipt',
    invoiced: 'Invoiced',
    revenue: 'Revenue',
    cost: 'Cost',
    margin: 'Margin',
    emptyTitle: 'No invoices yet',
    emptyBody:
      'Raise one below. It ships the stock, posts the receivable and the revenue, and costs the goods from the lots they came out of — in one entry.',

    newTitle: 'Raise an invoice',
    newHint:
      'The whole invoice is one entry, so the receivable, the revenue, the tax and the cost of the goods cannot disagree. If any line is short of stock, nothing is written.',
    needSetup:
      'You need a product with stock on hand, a customer account (an asset — one per customer is how aged receivables tell them apart) and a revenue account. Set them up on the',
    stockLink: 'stock page',
    andThe: 'and the',
    invoiceNumber: 'Invoice number',
    invoiceNumberHint: 'Issued once. Customers pay against it.',
    customerAccount: 'Customer',
    customerAccountHint: 'Their receivable account, or a bank account for a cash sale.',
    revenueAccount: 'Revenue account',
    currency: 'Invoiced in',
    currencyHint:
      'An export is invoiced in the buyer’s currency; the rate on the invoice date is used.',
    taxCode: 'Tax',
    noTax: 'No tax',
    invoiceDate: 'Invoice date',
    dueDate: 'Payment due',
    dueDateHint: 'Leave blank for payment on receipt. Aged receivables count from this date.',
    linesLegend: 'Lines',
    product: 'Product',
    quantity: (unit: string) => `Quantity (${unit})`,
    lineTotal: 'Line total before tax',
    lot: 'Lot',
    byMethod: 'By costing method',
    addLine: 'Add a line',
    removeLine: (line: number) => `Remove line ${line}`,
    lineLabel: (line: number) => `Line ${line}`,
    submit: 'Raise invoice',

    allSales: 'All sales',
    linesTitle: 'Lines',
    linesHint:
      'What each line was sold for, what it cost from the lots, and which lots it shipped from.',
    linesCaption: 'Invoice lines with revenue, cost and margin',
    shippedFrom: 'Shipped from',
    net: 'Net',
    tax: 'Tax',
    gross: 'Total',
    viewEntry: 'The journal entry',
    marginOf: (percent: string) => `${percent} margin`,

    // Outcomes of the form.
    checkForm: 'Fill in an invoice number, a customer, a revenue account and at least one line.',
    checkLine: (line: number) => `Line ${line}: choose a product and enter a quantity and a total.`,
    tooManyDecimals: (line: number, places: number) =>
      places === 0
        ? `Line ${line}: this product is counted in whole units.`
        : `Line ${line}: this product is measured to ${places} decimal place${places === 1 ? '' : 's'}.`,
    amountNotRepresentable: (line: number, currency: string) =>
      `Line ${line}: that total has more decimal places than ${currency} allows.`,
    raised: (reference: string, margin: string) =>
      `Raised ${reference}. The stock has shipped, and the invoice made ${margin}.`,
  },

  margins: {
    title: 'Gross margin',
    description:
      'What was made on what was sold, by product and by customer. Revenue at the rate on each invoice’s date, cost at the rate each lot arrived at — the only two figures that add up across currencies.',
    month: 'Month',
    previous: 'Previous month',
    next: 'Next month',
    revenue: 'Revenue',
    cost: 'Cost of sales',
    margin: 'Gross margin',
    marginPercent: 'Margin %',
    invoices: 'Invoices',
    byProduct: 'By product',
    byProductHint:
      'Freight and duty that arrived after the goods had gone went straight to cost of sales. They are shown separately and included in cost: they belong to the product, not to any one invoice.',
    byProductCaption: 'Gross margin by product, largest contribution first',
    byCustomer: 'By customer',
    byCustomerHint:
      'Late freight and duty are not in these figures, because they cannot be attributed to a customer — which is why the two tables’ costs differ by exactly that amount.',
    byCustomerCaption: 'Gross margin by customer, largest contribution first',
    product: 'Product',
    customer: 'Customer',
    sold: 'Sold',
    lateCharges: 'Late freight & duty',
    total: 'Total',
    emptyTitle: 'Nothing sold this month',
    emptyBody: 'Invoices raised on the Sales page appear here, costed from the lots they shipped.',
  },

  reconcile: {
    title: 'Stock against the accounts',
    agrees: 'The stock records agree with the accounts',
    agreesBody:
      'Every inventory account holds exactly what its open lots are worth. Nothing has been posted to stock except by moving stock.',
    disagrees: 'The stock records and the accounts disagree',
    disagreesBody:
      'Something was posted straight to an inventory account without moving any stock, so every margin costed from the lots is out by the difference. The entries responsible are listed; reverse them, or record the stock movement they stood for.',
    caption: 'Inventory accounts against the lots behind them',
    account: 'Account',
    products: 'Products',
    ledger: 'In the accounts',
    lots: 'In the lots',
    difference: 'Difference',
    unexplained: 'Posted without moving stock',
  },

  stockOutcome: {
    checkProduct: 'Fill in a code, a name and a unit of measure.',
    added: (name: string) => `Added ${name}. You can book a delivery against it now.`,
    plainNumber: 'Enter a plain number, for example 1250 or 24.687.',
    checkQuantityAndAmount: 'Check the quantity and the amount.',
    checkQuantity: 'Check the quantity.',
    tooManyDecimals: (places: number) =>
      places === 0
        ? 'This product is counted in whole units.'
        : `This product is measured to ${places} decimal place${places === 1 ? '' : 's'}. Round the quantity, or change the product’s precision.`,
    quantityPlain: 'Enter the quantity as a plain number.',
    amountPlain: 'Enter the amount paid as a plain number.',
    bookedIn: (quantity: string, unit: string) =>
      `Booked in ${quantity} ${unit}. The purchase has been posted to the ledger as well.`,
    lotsJoiner: ' then ',
    shippedFrom: (lots: string) =>
      `Shipped, costed from ${lots}. The cost of goods sold has been posted.`,
    shipped: 'Shipped, and the cost of goods sold has been posted.',
    chooseReason: 'Say why the stock is being written off.',
    writtenOff: (quantity: string, unit: string) => `Wrote off ${quantity} ${unit}.`,
    writtenOffFrom: (quantity: string, unit: string, lots: string) =>
      `Wrote off ${quantity} ${unit}, costed from ${lots}.`,
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

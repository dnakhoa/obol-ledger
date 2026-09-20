import type { Messages } from './en';

/**
 * 日本語の画面表示。
 *
 * Typed as `Messages`, so a key left untranslated will not compile.
 *
 * The accounting vocabulary is the one the National Tax Agency and the ASBJ
 * use, not a translation of the English. 棚卸資産の評価方法 are named exactly as
 * 法人税法 names them — 先入先出法, 移動平均法, 個別法 — because those are the
 * phrases on the election form a company files, and a literal rendering of
 * "oldest delivery first" would read as something a foreign system invented.
 *
 * 後入先出法 (LIFO) appears in the list of *labels* because an American tenant
 * may use it and a Japanese reader may still need to see what it says. It is
 * not offered as a choice here: Japan removed it from GAAP in 2008 to converge
 * with IAS 2, and a CHECK constraint refuses it outside a US chart.
 *
 * Japanese has no plural inflection either, so a count and its noun never
 * disagree.
 */
export const ja: Messages = {
  common: {
    appName: 'Obol',
    signIn: 'ログイン',
    signOut: 'ログアウト',
    search: '検索…',
    cancel: 'キャンセル',
    back: '戻る',
    none: 'なし',
    reading: (org) => `${org} の帳簿を表示中`,
    colourTheme: '表示テーマ',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    themeSystem: 'システム設定',
    language: '言語',
    skipToContent: '本文へスキップ',
    working: '処理中…',
  },

  nav: {
    primary: 'メインナビゲーション',
    overview: '概要',
    accounts: '勘定科目',
    stock: '在庫',
    journal: '仕訳帳',
    reports: '帳票',
    monthEnd: '月次決算',
    newEntry: '仕訳入力',
    webhooks: 'Webhook',
    api: 'API',
    settings: '設定',
    morePages: 'その他のページ',
  },

  overview: {
    title: '概要',
    description: '以下の数値はすべて、貸借が一致した仕訳から計算されています。',
    postEntry: '仕訳を入力',

    balanced: '帳簿は一致しています',
    notBalanced: '帳簿が一致していません',
    balancedBody: 'すべての通貨で借方と貸方が一致し、差額はちょうど 0 です。',
    notBalancedBody: '差額が 0 でない場合、保存された残高が元の仕訳と食い違っています。',
    debits: '借方合計',
    credits: '貸方合計',
    residual: '差額',

    cashAndAssets: '現預金・資産',
    debitNormalBalances: '借方残高となる勘定',
    revenue: '収益',
    revenueDetail: '貸方残高、正の数で表示',
    expenses: '費用',
    entriesPosted: '登録済み仕訳',
    entriesDetail: (postings, accounts) => `${accounts} 勘定にわたり ${postings} 行`,

    volumeTitle: '日次の仕訳金額',
    volumeHint: '直近 30 日、借方のみ — 各仕訳には同額の貸方があります。',

    positionTitle: '勘定区分別の残高',
    positionHint: '資産 + 費用 = 負債 + 純資産 + 収益',
    positionEmpty: '勘定科目がまだありません',
    positionEmptyBody: '勘定科目を作成すると、仕訳の記帳を始められます。',
    positionCaption: '勘定区分ごとの残高合計',
    klass: '勘定区分',
    accountCount: '勘定科目数',
    balanceIn: (currency) => `残高（${currency}）`,
    debitSide: '借方',
    creditSide: '貸方',
    equationHolds: '貸借は一致',
    equationBroken: '貸借が不一致',

    recentTitle: '最近の仕訳',
    fullJournal: '仕訳帳をすべて見る',
    journalEmpty: '仕訳帳は空です',
    journalEmptyBody: '最初の仕訳を入力すると、ここに表示されます。',
    recentCaption: '直近 6 件の仕訳',
    date: '日付',
    entryDescription: '摘要',
    accounts: '勘定科目',
    amount: '金額',
  },

  accounts: {
    title: '勘定科目',
    description:
      '勘定区分ごとにまとめています。残高は経理担当者が読む形 — その勘定が本来どちら側に立つかにかかわらず、正の数が正常です。',
    postEntry: '仕訳を入力',

    emptyTitle: '勘定科目がまだありません',
    emptyBody:
      '勘定科目は API から作成します。pnpm db:seed で 1 か月分のサンプル帳簿を読み込めます。',

    asset: '資産',
    liability: '負債',
    equity: '純資産',
    revenue: '収益',
    expense: '費用',

    assetBlurb: '会社が保有するもの。借方で増加します。',
    liabilityBlurb: '会社が負っているもの。貸方で増加します。',
    equityBlurb: '株主に帰属する残余持分。貸方で増加します。',
    revenueBlurb: '計上した収益。貸方で増加します。',
    expenseBlurb: '発生した費用。借方で増加します。',

    normalDebit: '通常は借方残高',
    normalCredit: '通常は貸方残高',

    tableCaption: (group) => `${group}の勘定科目と残高`,
    code: 'コード',
    account: '勘定科目名',
    identifier: '識別子',
    overdraft: 'マイナス残高',
    balance: '残高',
    statement: '明細',
    closed: '閉鎖済み',
    overdraftAllowed: '許可',
    overdraftBlocked: '不可',

    overdraftNote:
      'マイナス残高を許可していない勘定は、0 を下回ることができません。この規則はサービス層だけでなく Postgres の CHECK 制約でも担保されているため、このアプリケーションを経由しない書き込みに対しても有効です。',
  },

  stock: {
    title: '在庫',
    description:
      '入荷のたびに、その単価のまま別ロットとして記録します。出庫すると、実際に引き当てたロットから売上原価を計算し、どのロットから引き当てたかも表示します。',
    importButton: '表計算から取り込む',

    inTheYard: '現在の在庫',
    inTheYardHint: '金額は取得原価です。販売価格ではありません。',
    tableCaption: '保有品目と在庫数量・金額',
    product: '品目',
    onHand: '在庫数量',
    deliveriesOpen: '残ロット数',
    costedBy: '評価方法',
    value: '金額',
    totalValue: '在庫金額合計',
    justThisProduct: 'この品目のみ',

    emptyTitle: '品目がまだありません',
    emptyBody:
      '仕入れて販売するものを登録してください。品目を登録すると入荷を記録でき、出庫ごとの売上原価が自動で計算されます。',

    addProduct: '品目を追加',
    addProductHint:
      '品目とは、仕入れて販売するもののことです。入荷を記録するには先に品目が必要です。',
    addProductButton: '品目を追加',
    needAccounts: '在庫金額を計上する資産勘定と、売上原価の費用勘定が必要です。',
    chartOfAccountsLink: '勘定科目',
    firstSuffix: 'で先に作成してください。',

    productCode: '品目コード',
    productCodeHint: '梱包明細に記載している呼び名です。',
    name: '品目名',
    namePlaceholder: '御影石平板 600×600',
    measuredIn: '単位',
    measuredInHint: '平方メートル、トン、個 — 請求書に使う単位です。',
    costingMethod: '棚卸資産の評価方法',
    costingMethodHint: '一点物でなければ、会社の既定のままで構いません。',
    companyDefault: '会社の既定',
    stockAccount: '棚卸資産勘定',
    stockAccountHint: '保有している間、金額を計上する勘定です。',
    cogsAccount: '売上原価勘定',
    cogsAccountHint: '出庫時に原価を振り替える勘定です。',

    methodFifo: '先入先出法',
    methodLifo: '後入先出法',
    methodAverage: '移動平均法',
    methodSpecific: '個別法',
    methodFifoOption: '先入先出法（FIFO）',
    methodAverageOption: '移動平均法',
    methodSpecificOption: '個別法（出庫時にロットを指定）',
  },

  product: {
    allStock: '在庫一覧',
    measuredInSuffix: (unit) => `単位：${unit}`,
    onHand: '在庫数量',
    whatItCost: '在庫金額',
    deliveriesStillOpen: '残ロット数',

    lotsTitle: '保有中のロット',
    lotsHint: '古い順 — 指定がなければこの順で引き当てます。',
    lotsCaption: '残高のあるロット、古い順',
    reference: '伝票番号',
    arrived: '入荷日',
    left: '残数量',
    paidForLot: 'ロット取得価額',
    valueOfRemainder: '残数量の金額',
    ofTotal: (total) => `/ ${total}`,
    delivery: '入荷',
    openingBalance: '期首残高',
    nothingOnHand: '在庫がありません',
    nothingOnHandBody: '下から入荷を登録すると、その単価のまま 1 ロットとしてここに表示されます。',

    receiveTitle: '入庫を登録',
    receiveHint:
      'ロットの開設と仕入仕訳の計上を同時に行うため、在庫の記録と会計帳簿が食い違うことはありません。',
    receiveButton: 'この入荷を登録',
    howMuchArrived: (unit) => `入荷数量（${unit}）`,
    decimalHint: (places) =>
      places > 0 ? `小数点以下 ${places} 桁まで。` : '整数で入力してください。',
    paidInTotal: '支払総額',
    paidInTotalHint: '単価ではなく、ロット全体の金額です。',
    paidIn: '通貨',
    paidFrom: '支払元 / 買掛先',
    paidFromHint: '支払った預金口座、または未払いの仕入先です。',
    dateArrived: '入荷日',
    referenceHint: 'コンテナ番号または請求書番号。原価計算の明細に表示されます。',
    needCreditAccount: '預金口座または買掛金の勘定を',

    issueTitle: '出庫を登録',
    issueHint: '引き当てたロットから売上原価を計算します。在庫が足りない場合は登録を拒否します。',
    issueButton: '出庫を登録',
    howMuchWentOut: (unit) => `出庫数量（${unit}）`,
    dateShipped: '出庫日',
    issueReferenceHint: '受注番号または売上請求書番号。',
    whichDelivery: '引き当てるロット',
    whichDeliveryOptional: '引き当てるロット（任意）',
    whichDeliveryRequiredHint: 'この品目は個別法で評価するため、ロットの指定が必須です。',
    whichDeliveryOptionalHint: '未指定の場合は古いロットから引き当てます。',
    chooseDelivery: 'ロットを選択…',
    oldestFirst: '古いロットから',
    lotOption: (reference, quantity) => `${reference} — 残 ${quantity}`,
    nothingToShip: '出庫できる在庫がありません。先に入荷を登録してください。',

    movementsTitle: '入出庫の履歴',
    movementsHint:
      '出庫ごとに、どのロットから原価を引き当てたかを表示します。通常は表計算で管理している計算そのものです。',
    movementsCaption: '入出庫履歴、新しい順',
    date: '日付',
    whatHappened: '摘要',
    quantity: '数量',
    costedFrom: '引当ロット',
    cost: '原価',
    deliveryIn: '入庫',
    shippedOut: '出庫',
    nothingMoved: '入出庫の記録がありません',
    nothingMovedBody: '入庫と出庫がここに一覧で表示されます。',
  },

  journal: {
    title: '仕訳帳',
    description:
      'すべての仕訳を新しい順に、明細行とあわせて表示します。仕訳は追記のみ — 誤りは反対仕訳で訂正し、履歴を書き換えることはありません。',
    entries: '仕訳',
    noMatches: '条件に一致する仕訳はありません',
    noMatchesBody:
      '検索語を短くするか、勘定科目の絞り込みを広げてください。仕訳帳自体は変わりません。',
    clearFilters: '絞り込みを解除',
    empty: 'まだ仕訳がありません',
    emptyBody:
      '仕訳帳は空です。仕訳を入力するか、pnpm db:seed で 1 か月分のサンプル帳簿を読み込んでください。',
    postEntry: '仕訳を入力',
    caption: '仕訳と明細行',
    date: '日付',
    descriptionOrAccount: '摘要 / 勘定科目',
    amount: '金額',
    debit: '借方',
    credit: '貸方',
    reversed: '訂正済み',
    reversal: '反対仕訳',
    balanced: '貸借一致',
  },

  transfer: {
    title: '仕訳を入力',
    description:
      '仕訳を記帳します。貸借の一致は入力中に検証され、ドメイン層でもう一度、そして COMMIT 時に Postgres が三度目の検証を行います。',
  },

  reports: {
    title: '帳票',
    description:
      '会計帳簿が作成するために存在する 2 つの計算書です。どちらも他と同じ仕訳から計算しており、食い違う余地のある別の集計テーブルはありません。',
    sheetBalances: '貸借対照表は一致しています',
    sheetDoesNot: '貸借対照表が一致していません',
    assets: '資産',
    amount: '金額',
    sectionCaption: (section) => `勘定科目別の${section}`,
    sectionEmpty: (section) => `この通貨に${section}の勘定科目はありません。`,
    sectionTotal: (section) => `${section}合計`,
    equation: '資産 = 負債 + 純資産 + 繰越利益剰余金',
    liabilitiesPlusEquity: '負債 + 純資産',
    period30: '30 日',
    period90: '90 日',
    period365: '12 か月',
    balanceSheet: '貸借対照表',
    asAt: (date) => `${date} 現在の残高`,
    retainedEarnings: '繰越利益剰余金',
    incomeStatement: '損益計算書',
    reportingPeriod: '対象期間',
    netIncome: '当期純利益',
    netIncomeHint: '当期の収益から費用を差し引いた額',
    profit: '利益',
    lossOrBreakeven: '損失または収支均衡',
  },

  monthEnd: {
    title: '月次決算',
    description:
      '月に一度、順番に 3 つの作業を行います。早めに押しても構いません — まだその時期でなければ、誤った処理をする代わりに理由を表示します。',
    open: '未締め',
    closed: '締め済み',
    entriesInMonth: (count) => `仕訳 ${count} 件。締めは古い月から行うため、この月が対象です。`,
    allClosed: '仕訳のある月はすべて締め済みです。次の月は、その月が終わると対象になります。',

    step1: '為替レートを入力',
    step1NoForeign: (functional) =>
      `保有通貨は ${functional} のみのため、入力するレートはありません。この手順で行うことはありません。`,
    step1Body: (day, currencies) =>
      `${day} 時点で、各外貨 1 単位はいくらでしたか。取引銀行または中央銀行がその日に公表したレートを使用してください。保有通貨は ${currencies} です。`,
    step1Done: (currencies) => `${currencies} のレートを登録済みです。`,

    step2: '外貨建残高を換算し直す',
    step2NoForeign: (functional) =>
      `換算し直すものはありません — すべての勘定が ${functional} です。`,
    step2Body: (currencies, functional) =>
      `得意先からの債権は ${currencies} 建です。請求時と現在とでは ${functional} 換算額が異なります。この手順でその差額を計算し、収益または費用として計上します。`,
    whatWillChange: 'このボタンを押すと、次の金額が変わります：',
    step2Button: '外貨建残高を更新',
    step2Pending: '更新中…',

    step3: '月次を締める',
    step3Body: (month) =>
      `締めた後は、${month} 付の仕訳を追加も変更もできなくなります。それによってその月の数値が確定します。当月の損益は繰越利益剰余金へ振り替えられます。必要であれば締めを解除できます。`,
    step3Button: '月次を締める',
    step3Pending: '締め処理中…',
    step3Confirm: (month) =>
      `${month} を締めますか。この月付の仕訳は追加も変更もできなくなります。`,

    months: '月次一覧',
    rateCurrency: '通貨',
    rateWorth: (functional) => `${functional} 換算額`,
    rateSave: 'レートを保存',
    rateSaving: '保存中…',
    noMonths: '仕訳がないため、締める月はまだありません。',
    reopen: '締めを解除',
    stepNumber: (n) => `手順 ${n}`,
  },

  shipments: {
    title: '輸入船積',
    description:
      'コンテナ 1 本を荷揚げするまでに実際にかかった額です。海上運賃・関税・荷役費は仕入諸掛として棚卸資産の価額に含めるべきもので、当月の費用ではありません。その差は通常、小さくありません。',
    caption: '船積、新しい順',
    reference: '伝票番号',
    arrived: '入荷日',
    lots: 'ロット数',
    goods: '仕入本体価額',
    charges: '運賃・関税',
    landed: '取得原価',
    uplift: '上乗せ率',
    emptyTitle: '船積がまだありません',
    emptyBody:
      '船積は同じ便で到着した入荷をまとめる単位です。数週間後に運賃請求書が届いたとき、その入荷に按分できるようになります。',
    newShipment: '船積を登録',
    newShipmentHint: '普段お使いの番号で — コンテナ番号または船荷証券番号。',
    create: '登録',

    lotsTitle: '到着した品目',
    chargesTitle: '荷揚げまでにかかった費用',
    chargesHint:
      '各費用は上のロットに按分され、その取得原価を引き上げます。一部を販売した後に費用が判明した場合、その分は売上原価に計上します。すでに無いロットに加算することはできないためです。',
    chargesCaption: 'この船積にかかった費用',
    noCharges: '費用がまだありません',
    noChargesBody: '運賃請求書・関税・通関業者手数料を、届いた順に追加してください。',
    kind: '費用の種類',
    chargeDescription: '摘要',
    amount: '金額',
    toStock: '棚卸資産へ',
    toCogs: '売上原価へ',
    notCapitalised: '取得原価に含めない',

    addCharge: '費用を追加',
    basis: '按分基準',
    basisValue: 'ロットの価額',
    basisQuantity: '数量',
    basisWeight: '重量',
    basisHint: '海上運賃は容積、関税は価額を基準とするのが通例です。',
    kindFreight: '運賃',
    kindDuty: '関税',
    kindInsurance: '保険料',
    kindHandling: '荷役・国内運送',
    kindTax: '輸入時の税',
    kindOther: 'その他',
    creditAccount: '未払先 / 支払元',
    capitalise: '取得原価に含めるか',
    capitaliseHint:
      '運賃・関税・荷役費は含めます。控除対象の輸入消費税は含めません — 還付されるため、そもそも原価ではありません。',
    capitaliseYes: '含める — 棚卸資産に加算',
    capitaliseNo: '含めない — 控除対象',
    debitAccount: '控除対象分を計上する勘定',
    chargeDate: '発生日',
    submit: 'この費用を追加',
    checkFirst: '結果を確認',
    previewTitle: 'この費用による変化',
  },

  stockImport: {
    title: '表計算から取り込む',
    description:
      '普段お使いの仕入履歴をそのまま貼り付けてください。1 行が 1 ロットになり、仕入仕訳も同時に計上されます。',

    requirementsTitle: '必要な列',
    requirementsHint:
      '見出し行と 4 つの列があれば十分です。その他の列は任意で、一覧にない列はエラーにせず読み飛ばします。',
    separatorsNote:
      'タブ・カンマ・セミコロンのいずれの区切りも読み取れます。Excel から直接貼り付けても、小数点にカンマを使う環境で書き出したファイルでも構いません。',

    colProductCode: '品目コード',
    colProductCodeHint: 'sku, code, product code, 品目コード',
    colDate: '入荷日',
    colDateHint: 'date, received, arrived, 日付 — 10/01/2026 は 1 月 10 日',
    colQuantity: '数量',
    colQuantityHint: 'quantity, qty, 数量',
    colCost: '金額',
    colCostHint: 'cost, total, amount, 金額 — 単価ではなくロット全体の金額',
    colNameUnit: '品目名と単位',
    colNameUnitHint: '未登録の品目の場合のみ必要です',
    colCurrency: '通貨',
    colCurrencyHint: '既定は帳簿の記帳通貨です',
    colReference: '伝票番号',
    colReferenceHint: 'reference, container, invoice, 伝票番号 — 原価計算の明細に表示されます',

    yourRows: '貼り付けたデータ',
    yourRowsHint:
      '全行を確認して取込を押すまで、帳簿には何も書き込まれません。1 行でも誤りがあれば 1 行も取り込みません — 途中まで取り込まれた帳簿は、取り込まないより厄介です。',
    pasteLabel: 'ここに行を貼り付け',
    pastePlaceholder:
      '品目コード\t品名\t単位\t日付\t数量\t金額\t伝票番号\nPAV-600\t御影石平板 600×600\tm2\t10/01/2026\t1000\t4000000\tCONT-4417',
    pasteHint: 'Excel で範囲を選択し、見出し行ごと貼り付けてください。.csv の中身でも構いません。',
    chargeTo: '貸方勘定',
    chargeToHint: '未払いの仕入先、または支払った預金口座です。',
    stockAccountHint: 'このファイルで新規作成される品目すべてに適用します。',
    cogsAccountHint: '後日、出庫時に原価を振り替える勘定です。',
    checkButton: '内容を確認',
    checking: '読み取り中…',
    importing: '取込中…',
    importButton: (count) => `${count} 件のロットを取り込む`,
    needAccounts: '棚卸資産の資産勘定、売上原価の費用勘定、および貸方勘定が必要です。',

    separatorTab: 'タブ区切り — Excel から直接貼り付けられています。',
    separatorSemicolon: 'セミコロン区切り。欧州や東南アジアの Excel が書き出す形式です。',
    separatorComma: 'カンマ区切り。',
    ignoredColumns: (columns) =>
      `使用しない列：${columns}。失われたものはありません — 入荷の情報に含まれないだけです。`,
    missingColumnsInline: (columns) =>
      `${columns} の列が見つかりません。下の行は読み取った内容をそのまま表示しています。どの見出しが一致しなかったか確認してください。`,

    previewCaption: '読み取った内容を 1 行ずつ表示',
    importFailed: '取り込みは行われませんでした。以下の行を修正して再度お試しください。',
    row: '行',
    status: '状態',
    ready: '取込可能',
    newBadge: '新規',
    fixFirst:
      '上で印の付いた行を修正し、もう一度確認してください。取込は全件か 0 件かのいずれかで、正しい行だけを取り込むことはしません。',
    rowProblem: (line, problem) => `${line} 行目：${problem}`,
  },
};

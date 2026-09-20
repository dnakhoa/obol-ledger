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
    row: '行',
    status: '状態',
    ready: '取込可能',
    newBadge: '新規',
    fixFirst:
      '上で印の付いた行を修正し、もう一度確認してください。取込は全件か 0 件かのいずれかで、正しい行だけを取り込むことはしません。',
    rowProblem: (line, problem) => `${line} 行目：${problem}`,
  },
};

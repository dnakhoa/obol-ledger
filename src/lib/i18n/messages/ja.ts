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
    somethingWentWrong: 'エラーが発生しました',
    routeErrorBody:
      'このページを読み込めませんでした。帳簿には何も書き込まれていません — 変更はすべてデータベースのトランザクション内で行われるため、失敗しても中途半端な仕訳は残りません。',
    errorReference: '参照番号',
    pageNotFound: 'そのページは存在しません',
    keepYourOwnBooks: '自分の帳簿をつける',
    working: '処理中…',
    refusalSignIn:
      'ご自身の帳簿をつけるにはサインインしてください。これは公開デモで、誰でも閲覧できますが変更はできません。',
    refusalNoLedger: 'このアカウントにはまだ帳簿がありません。作成すると記帳を始められます。',
    refusalReadOnly: 'この帳簿でのあなたの権限は閲覧のみです。',
  },

  nav: {
    primary: 'メインナビゲーション',
    overview: '概要',
    accounts: '勘定科目',
    stock: '在庫',
    sales: '販売',
    journal: '仕訳帳',
    reports: '帳票',
    monthEnd: '月次決算',
    tax: '消費税',
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
    sellButton: '請求書を発行',

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
    writeOffTitle: '在庫の廃棄・減耗',
    writeOffHint:
      '破損、期限切れ、紛失、棚卸での不足。販売と同じくロットから原価を計算し、選んだ費用科目に計上します。減耗が売上原価に紛れ込むことはありません。',
    writeOffButton: '廃棄を計上',
    howMuchWrittenOff: (unit) => `数量（${unit}）`,
    reason: '理由',
    reasonDamaged: '破損',
    reasonExpired: '期限切れ',
    reasonLost: '紛失',
    reasonCountShortfall: '棚卸減耗',
    reasonOther: 'その他',
    lossAccount: '損失の計上科目',
    lossAccountHint: '費用科目：棚卸減耗損、商品廃棄損など。',
    writeOffReferenceHint: '棚卸表または破損報告書の番号。',
    needLossAccount: '在庫損失用の費用科目を',
    writtenOff: '廃棄',
    sold: '販売',
    soldFor: '売上',
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
    enteredBy: '入力者',
    viaUi: '手入力',
    viaApi: 'API 経由',
    viaSystem: 'システムが記帳',
    viaImport: '表計算から取込',
    viaUnknown: '記録なし',
  },

  transfer: {
    title: '仕訳を入力',
    description:
      '仕訳を記帳します。貸借の一致は入力中に検証され、ドメイン層でもう一度、そして COMMIT 時に Postgres が三度目の検証を行います。',
    tooMany: (seconds) =>
      `短時間に多くの仕訳が記帳されました。${seconds} 秒後にもう一度お試しください。`,
    checkFields: '仕訳を記帳できませんでした。強調表示された項目を確認してください。',
    notAnAmount: (line, amount, currency) =>
      `${line} 行目：「${amount}」は ${currency} の金額として正しくありません。`,
    notRepresentable: (currency) => `${currency} では表せない金額です`,
    posted: (id) => `仕訳 ${id} を記帳しました。`,
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

    rateNotANumber: '為替レートは桁区切りを付けず、数字のみで入力してください（例：25700）。',
    rateSaved: (base, rate, functional, day) =>
      `${day} の為替レート 1 ${base} = ${rate} ${functional} を登録しました。`,
    pickMonth: '先に月を選んでください。',
    revalued: (count) => `外貨建て残高 ${count} 件を期末レートで換算替えしました。`,
    nothingToRevalue:
      'すべての外貨建て残高を確認しました。レートに変動がないため、換算替えは不要でした。',
    monthClosed: (month) => `${month}を締めました。この月の数値は今後変わりません。`,
    monthReopened: (month) =>
      `${month}の締めを解除しました。決算振替仕訳には反対仕訳を起票し、どちらも記録に残っています。`,
  },

  misc: {
    entriesNote:
      '各仕訳の明細行の合計は 0 になります — COMMIT 時に遅延制約でデータベースが検証します。',
    statementNote:
      '記帳済みの仕訳を新しい順に。残高は Postgres がこの勘定自身の明細行から計算するため、上の記帳済み残高と一致します。',
    filterMatchNote: '下の絞り込み条件に一致する仕訳を表示しています。',
    newer: '新しい方へ',
    older: '古い方へ',
    showingEntries: (count) => `仕訳 ${count} 件を表示中`,
    showingLines: (count) => `${count} 行を表示中`,
    applyFilters: '適用',
    clearFilters: 'クリア',
    chartDay: '日付',
    chartVolume: (currency) => `金額（${currency}）`,
    chartCaption: (currency) => `${currency} 建ての日次仕訳金額`,
    alreadyReversedNote:
      'この仕訳はすでに赤伝処理済みで、赤伝は一度しか切れません — でなければ訂正が二重に効いてしまいます。',
    reopenNote:
      '締めた月は再開できます。元の締め仕訳は帳簿に残したまま、取消仕訳で相殺するので、経緯は必ず追えます。',
    signInPitch:
      'サインインすると自分の帳簿が持てます — 自分の勘定科目、自分の仕訳、自分の通貨で。デモはそのまま残ります。',
    overdraftNote:
      'オフのとき、この勘定をマイナスにする仕訳は拒否されます — アプリケーションだけでなく Postgres の CHECK 制約によって。評価勘定、および負債・純資産・収益の多くはオンが必要です。',
    settleNote:
      '決済時にマイナス残高の可否を再確認します — 承認時点で足りていた資金が、いまは無いかもしれません。',
    starterChartNote: '初期の勘定科目表が付いてきます。あとから名称変更、追加、閉鎖ができます。',
    exportCsv: 'CSV を書き出す',
    tryAgain: '再試行',
    inEffect: '有効',
    allAccounts: 'すべての勘定科目',
    viewJournal: '仕訳帳を見る',
    viewAsTable: '表で見る',
    noActivity: 'まだ図示できる発生がありません。',
    fundsReserved: '資金が拘束されているため、すでに差し引かれています：',
    retainedNote: '収益から費用を差し引き、期末と同様に純資産へ振り替えた額',
    reading: '表示中',
    noDatabase: 'データベースがまだ設定されていません',

    notFoundBody: 'お探しの勘定科目または仕訳は、この帳簿にはありません。',
    backToOverview: '概要へ戻る',
    noPassword:
      'パスワードを考える必要も、忘れる心配もありません。漏れうるものを保存していません。',
    readDemo: 'デモ帳簿を見る',
    onboardingIntro: '始める前にひとつだけ。後から変更できない項目だからです。',
    chartIsAStart: '出発点であって、縛りではありません \u2014 法令が定める場合を除いて。',

    accountFormIntro: '名称と勘定区分。区分がどちら側で残高が増えるかを決めます。',
    accountsNeverDeleted: '勘定科目は削除されません。閉鎖はでき、履歴はそのまま残ります。',
    filterDescription: '摘要',
    filterAccount: '勘定科目',

    viewReversal: '反対仕訳を見る',
    noEditing: '仕訳は編集できません。誤りは反対仕訳を記帳して訂正します。',
    reverseThis: 'この仕訳を訂正',
    reverseNote: 'これは新しい仕訳を記帳するもので、この仕訳を削除するものではありません',
    entryPending: 'この仕訳は未決済です',
    cancelIt: '取り消す',
    cancelledNote:
      'この仕訳は決済前に取り消されたため、残高には一度も反映されていません。訂正するものはありません \u2014 反対仕訳は実際に動いた金額を打ち消すものであり、ここでは何も動いていないからです。',
  },

  entry: {
    pending: '未決済',
    cancelled: '取消済み',
    reversed: '訂正済み',
    reversingEntry: '反対仕訳',
    amount: '金額',
    occurred: '発生日',
    postings: '明細行',
    postingsHint: '仕訳を入力した順に表示しています。',
    sumsToZero: '合計 0、COMMIT 時に検証済み',
    metadata: '付帯情報',
    account: '勘定科目',
    ownedByStockTitle: '在庫記録が作成した仕訳',
    ownedByStock:
      'この仕訳は金額と同時に在庫も動かしたため、ここでは取り消せません。取り消すと勘定だけが動き、その裏付けとなるロットは動きません。在庫画面から修正してください（廃棄の計上、または入荷への追加諸掛）。',
    openSale: '請求書を開く',
    cancelledByReversal:
      'この仕訳は後の反対仕訳によって取り消されました。記録には残り、正味の影響はゼロです。',
    cancelsEarlier: 'この仕訳は以前の仕訳を取り消すためのものです。どちらも記録に残ります。',
    viewOriginal: '元の仕訳を見る',
    reservedNotMoved: '引当済み、未移動',
    cancelledNeverMoved: '取消済み、移動なし',
    debitSideMatches: '借方合計（貸方と一致）',
    metadataHintBefore: '呼び出し側の参照情報です。台帳は解釈しませんが、検索できます —',
    metadataHintAfter: '（仕訳帳）。',
  },

  statement: {
    closed: '閉鎖済み',
    pendingNote: '未決済 \u2014 残高には未反映',
    date: '日付',
    description: '摘要',
    amount: '金額',
    balance: '残高',
    title: '勘定明細',
    emptyTitle: '明細がありません',
    emptyBody: 'この勘定にはまだ記帳がありません。記帳されるとここに表示されます。',
    line: '行',
    postedBalance: '確定残高',
    postedHint: '決済済みの仕訳のみ \u2014 実際にある額',
    available: '利用可能額',
    pending: '未決済',
    pendingHint: '確定分と未決済分の合計 \u2014 すべて確定した場合の額',
    openAnAccount: '勘定科目を作成',
    classHint:
      '勘定区分は見た目の問題ではありません。どちら側で残高が増えるか、そしてこの勘定がどこでどう表示されるかを決めます。',
    reopening: '解除中\u2026',
  },

  forms: {
    entryDetails: '仕訳の情報',
    entryDetailsHint: '取引の内容と、計上する通貨。',
    description: '摘要',
    descriptionHint: 'この仕訳が記録する内容。例：「請求書 1042 入金」',
    descriptionPlaceholder: '原材料の仕入',
    currency: '通貨',
    postings: '明細行',
    postingsHint:
      '借方合計と貸方合計は一致していなければなりません。一致しないものは仕訳ではありません。',
    lineAccount: '{n} 行目の勘定科目',
    sumToZero: '明細行の合計が 0 になったときにのみ、仕訳として受け付けられます。',
    selectAccount: '勘定科目を選択\u2026',
    side: '貸借',
    amount: '金額',
    addPosting: '行を追加',
    remove: '削除',
    incomplete: '入力が不足しています',
    entryFailed: '仕訳を記帳できませんでした。',
    postEntry: '仕訳を記帳',
    posting: '記帳中\u2026',

    accountDetails: '勘定科目の情報',
    accountName: '勘定科目名',
    accountNameHint: '同一通貨内で重複しないこと。例：「当座預金」',
    accountNamePlaceholder: '普通預金',
    accountClass: '勘定区分',
    allowOverdraft: 'マイナス残高を許可',
    accountFailed: '勘定科目を作成できませんでした。',
    openAccount: '勘定科目を作成',
    opening: '作成中\u2026',
    yourLedger: 'あなたの帳簿',
    ledgerName: '名称',
    ledgerNameHint: 'あなたにだけ表示されます。',
    chartOfAccounts: '勘定科目体系',
    functionalCurrency: '機能通貨',
    functionalCurrencyHint:
      '帳簿を記帳する通貨です。すべての仕訳はこの通貨で貸借一致するため、後から変更するには記帳済みのすべてを付け直す必要があります。',
    createLedger: '帳簿を作成',
    creating: '作成中\u2026',
    somethingWrong: 'エラーが発生しました。',

    searchEntries: '仕訳を検索\u2026',
    anyAccount: 'すべての勘定科目',
    noMatch: '該当する仕訳はありません。検索語を短くするか、絞り込みを解除してください。',
    pagination: 'ページ送り',

    reversalDescription: '反対仕訳の摘要',
    reversalHint: '任意。既定は「反対仕訳：\u2026」で、通常はそのままで構いません。',
    postReversal: '反対仕訳を記帳',
    tooManyReversals: (seconds) =>
      `短時間に多くの反対仕訳が起票されました。${seconds} 秒後にもう一度お試しください。`,
    noEntryGiven: '仕訳が指定されていません。',
    reversedBy: (id) => `反対仕訳 ${id} を起票しました。`,
    tooManyTransitions: (seconds) =>
      `短時間に多くの操作が行われました。${seconds} 秒後にもう一度お試しください。`,
    transitionUnavailable: 'この仕訳ではその操作は行えません。',
    settled: '仕訳を決済しました。',
    cancelledNothingMoved: '仕訳を取り消しました。残高は動いていません。',

    tooManyAccounts: (seconds) =>
      `短時間に多くの勘定科目が作成されました。${seconds} 秒後にもう一度お試しください。`,
    accountCheckFields: '勘定科目を作成できませんでした。強調表示された項目を確認してください。',
    accountExists: (name, currency) => `${currency} 建ての勘定科目「${name}」は既に存在します。`,
    alreadyInUse: '既に使われています',
    accountCode: '科目コード',
    accountCodeHint: '数字のみ。法定の勘定科目体系では必須で、先頭の数字が区分を表します。',
    accountCodeRequiredHint:
      '必須：Thông tư 200 では先頭の数字が区分です（131 は売掛金、331 は買掛金）。',
    openItems: '得意先・仕入先として管理',
    openItemsNote:
      '残高は未決済の請求書の集まりなので、売掛金・買掛金の年齢表に表示されます。得意先ごとに勘定を分けると、年齢表で区別できます。',
    paymentTerms: '支払条件（日数）',
    paymentTermsHint: '支払までの猶予日数。空欄なら 30 日、0 なら受領時払いです。',
  },

  palette: {
    label: '検索とコマンド',
    placeholder: '勘定科目・仕訳・ページを検索\u2026',
    results: '検索結果',
    searching: '検索中\u2026',
    pages: 'ページ',
    accounts: '勘定科目',
    entries: '仕訳',
  },

  aging: {
    title: '債権債務の年齢表',
    description:
      '未回収・未払がどれだけ滞留しているかを示します。他と同じ仕訳から作成しており、食い違う余地のある別の補助元帳はありません。',
    receivables: '売掛金',
    payables: '買掛金',
    caption: (account) => `${account}、古い順`,
    invoice: '請求書番号',
    dated: '日付',
    outstanding: '残高',
    current: '期日前',
    days1to30: '延滞 1〜30 日',
    days31to60: '延滞 31〜60 日',
    days61to90: '延滞 61〜90 日',
    over90: '延滞 90 日超',
    due: '支払期日',
    late: '延滞',
    lateDays: (count) => `${count} 日`,
    notYetDue: 'なし',
    terms: (days) => (days === 0 ? '受領時払い' : `${days} 日サイト`),
    termsAssumed: (days) => `${days} 日サイトを仮定（勘定に支払条件の設定なし）`,
    total: '合計',
    overdue: (percent) => `期日超過 ${percent}%`,
    emptyTitle: '未決済の残高はありません',
    emptyBody: 'これらの勘定の請求はすべて決済済みです。',
    convention:
      '入金がどの請求書に対応するかは記録されていないため、古いものから順に充当しています。これは事実ではなく約束事です — 得意先が後の請求書を支払い、前の請求書に異議を唱えている場合には違いが出ます。',
    dueConvention:
      '延滞日数は請求書自体の支払期日から数えます（販売画面で発行した請求書にはすべてあります）。ない場合は勘定の支払条件、それも未設定なら 30 日とみなします。',
    credit: '過入金',
  },

  tax: {
    title: '消費税申告',
    description:
      '預かった消費税、支払った消費税、そして差引の納付額です。申告すると両方の仮勘定を精算する仕訳が起票されるため、控除しきれなかった分は申告書の上ではなく帳簿に残ります。',
    codes: '税率',
    codesDescription:
      '売上に課す税率と仕入で控除する税率です。それぞれに計上先の勘定科目を紐づけてあるので、伝票ごとに指定する必要はありません。',
    noCodes: '税率が未登録です',
    noCodesBody: '消費税のある売上・仕入を入力する前に、税率を登録してください。',
    addCode: '税率を追加',
    codeName: '名称',
    rate: '税率',
    treatment: '区分',
    vat: '消費税',
    reverseCharge: 'リバースチャージ',
    salesTax: '売上税（米国）',
    inputAccount: '仮払消費税',
    outputAccount: '仮受消費税',
    none: 'なし',
    vatHint: '売上で預かり、仕入で控除します。通常の区分です。',
    reverseChargeHint:
      '国外事業者から役務の提供を受けた場合。買手が売手の分もあわせて申告し、両者は相殺されます。',
    salesTaxHint: '米国。顧客から預かって納付します。仕入で払った税は費用であり、控除できません。',
    period: '申告対象期間',
    periodReady: (month: string) => `${month}分を申告できます`,
    nothingDue: '申告するものはありません',
    nothingDueBody: '終了した期間はすべて申告済みです。当月は終了後に申告できます。',
    sales: '課税売上と仮受消費税',
    purchases: '課税仕入と仮払消費税',
    base: '税抜金額',
    taxAmount: '消費税額',
    outputTax: '仮受消費税',
    inputTax: '仮払消費税（控除対象）',
    broughtForward: '前期からの控除不足額',
    payable: '納付税額',
    carriedForward: '翌期へ繰り越す控除不足額',
    fileReturn: 'この期間を申告する',
    filing: '申告中…',
    filed: '申告済みの期間',
    filedCaption: '申告済みの期間、新しい順',
    filedOn: '申告日',
    periodColumn: '対象期間',
    noReturns: '申告済みの期間はありません',
    noReturnsBody: '消費税の発生した月が終了すると、ここで申告できます。',
    viewEntry: '仕訳を見る',
    noEntry: '起票なし',
    noEntryHint:
      'この期間は仮受消費税が発生していないため、精算する相手がありません。支払った消費税はそのまま翌期へ繰り越されます。',
    inOrder:
      '申告は古い期間から順に行います。控除しきれなかった額は次の期間へ引き継がれるため、間を飛ばすと次の期間の期首額が欠けたまま気づけません。',
    carriedExplainer:
      '仮払消費税が仮受消費税を上回ったため、今期の納付はありません。差額は還付されず、翌期の控除に回ります。',
    pickPeriod: '先に申告対象期間を選んでください。',
    filedNothingOwed: (credit) =>
      `申告しました。納付税額はありません。控除不足額 ${credit} は翌期の申告に繰り越されます。`,
    filedOwing: (payable) =>
      `申告しました。納付税額は ${payable} で、納付するまで未払消費税等の勘定に計上されます。`,
    codeIncomplete: '名称と税率（％）を入力してください。例：10 または 8',
    codeAdded: (name) => `${name} を追加しました。`,
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

    shipmentIncomplete: '伝票番号と入荷日を入力してください。',
    recorded: (reference) => `${reference} を登録しました。`,
    amountNotANumber: '金額は桁区切りを付けず、数字のみで入力してください。',
    chargeIncomplete: '金額・摘要・勘定科目を確認してください。',
    addedToStock: (amount) => `追加しました。${amount} を棚卸資産に加算しました。`,
    addedSplit: (toStock, toCogs) =>
      `追加しました。${toStock} を在庫として残っている分に加算し、販売済みの分の ${toCogs} を売上原価に計上しました。`,
    addedReclaimable: '追加しました。この費用は控除対象のため、棚卸資産には加算していません。',
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
    pasteRows: '行を貼り付け、入庫の貸方勘定を選んでください。',
    rowsLost: '行のデータが失われました。もう一度貼り付けてください。',
    noColumn: (columns) =>
      `このファイルには ${columns} 列がないため、まだ取り込めるものがありません。見出し行を確認してください。`,
    rowsNeedFixing: (problems, rows) =>
      `${rows} 行のうち ${problems} 行を先に修正する必要があります。何も取り込んでいません。`,
    readyToImport: (rows, products, readOnly) =>
      `${rows} 件の入庫を取り込む準備ができました${products > 0 ? `（新しい品目 ${products} 件を作成）` : ''}。${readOnly === 'yes' ? 'ご自身の帳簿に取り込むにはサインインしてください。' : 'まだ何も取り込んでいません。'}`,
    imported: (lots, products) =>
      `${lots} 件の入庫を取り込みました${products > 0 ? `（新しい品目 ${products} 件を作成）` : ''}。それぞれ仕訳も記帳しました。`,
  },
  sales: {
    title: '販売',
    description:
      '請求書ごとに出庫と売上原価の計上を同じ仕訳で行うため、どの請求書もその利益がわかります。',
    marginsButton: '売上総利益',

    recentTitle: '最近の請求書',
    recentHint:
      '請求額は請求書の通貨で表示します。売上・原価・粗利は記帳通貨で、売上は請求日のレート、原価は各ロットの入庫日のレートによります。',
    tableCaption: '請求書（新しい順）と粗利',
    invoice: '請求書番号',
    customer: '得意先',
    date: '日付',
    due: '支払期日',
    onReceipt: '30 日（仮定）',
    invoiced: '請求額',
    revenue: '売上',
    cost: '原価',
    margin: '粗利',
    emptyTitle: '請求書はまだありません',
    emptyBody:
      '下のフォームから発行してください。出庫、売掛金と売上の計上、出庫したロットからの原価計算を、ひとつの仕訳で行います。',

    newTitle: '請求書を発行',
    newHint:
      '請求書全体がひとつの仕訳なので、売掛金・売上・消費税・売上原価が食い違うことはありません。在庫が足りない行がひとつでもあれば、何も記帳しません。',
    needSetup:
      '在庫のある品目、得意先の勘定（資産。得意先ごとに勘定を分けると年齢表で区別できます）、売上勘定が必要です。設定は',
    stockLink: '在庫画面',
    andThe: 'と',
    invoiceNumber: '請求書番号',
    invoiceNumberHint: '一度だけ使えます。得意先はこの番号で支払います。',
    customerAccount: '得意先',
    customerAccountHint: '得意先の売掛金勘定。現金販売なら預金勘定。',
    revenueAccount: '売上勘定',
    currency: '請求通貨',
    currencyHint: '輸出は買い手の通貨で請求します。請求日のレートを使います。',
    taxCode: '消費税',
    noTax: '税なし',
    invoiceDate: '請求日',
    dueDate: '支払期日',
    dueDateHint: '空欄なら得意先の支払条件を使います。延滞日数はこの日から数えます。',
    linesLegend: '明細',
    product: '品目',
    quantity: (unit) => `数量（${unit}）`,
    lineTotal: '税抜金額',
    lot: 'ロット',
    byMethod: '評価方法どおり',
    addLine: '行を追加',
    removeLine: (line) => `${line} 行目を削除`,
    lineLabel: (line) => `${line} 行目`,
    submit: '請求書を発行',

    allSales: 'すべての販売',
    linesTitle: '明細',
    linesHint: '各行の販売額、ロットから計算した原価、出庫元のロット。',
    linesCaption: '請求明細（売上・原価・粗利）',
    shippedFrom: '出庫元',
    net: '税抜合計',
    tax: '消費税',
    gross: '請求合計',
    viewEntry: '仕訳を見る',
    marginOf: (percent) => `粗利率 ${percent}`,

    checkForm: '請求書番号、得意先、売上勘定、明細を 1 行以上入力してください。',
    checkLine: (line) => `${line} 行目：品目を選び、数量と金額を入力してください。`,
    tooManyDecimals: (line, places) =>
      places === 0
        ? `${line} 行目：この品目は整数単位で数えます。`
        : `${line} 行目：この品目の数量は小数点以下 ${places} 桁までです。`,
    amountNotRepresentable: (line, currency) =>
      `${line} 行目：${currency} で表せる桁数を超えています。`,
    raised: (reference, margin) =>
      `${reference} を発行しました。出庫済みで、この請求書の粗利は ${margin} です。`,
  },

  margins: {
    title: '売上総利益',
    description:
      '販売したものの利益を品目別・得意先別に。売上は各請求日のレート、原価は各ロットの入庫日のレートによります。通貨をまたいで合計できるのはこの二つだけです。',
    month: '月',
    previous: '前月',
    next: '翌月',
    revenue: '売上高',
    cost: '売上原価',
    margin: '売上総利益',
    marginPercent: '粗利率',
    invoices: '請求書数',
    byProduct: '品目別',
    byProductHint:
      '商品の出荷後に届いた運賃・関税は売上原価に直接計上されています。別掲したうえで原価に含めます。特定の請求書ではなく品目に属する費用だからです。',
    byProductCaption: '品目別の売上総利益（貢献の大きい順）',
    byCustomer: '得意先別',
    byCustomerHint:
      '遅れて届いた運賃・関税は得意先に配分できないため、ここには含みません。二つの表の原価はちょうどその額だけ異なります。',
    byCustomerCaption: '得意先別の売上総利益（貢献の大きい順）',
    product: '品目',
    customer: '得意先',
    sold: '販売数量',
    lateCharges: '後着の運賃・関税',
    total: '合計',
    emptyTitle: '今月の販売はありません',
    emptyBody: '販売画面で発行した請求書が、出庫したロットの原価とともにここに表示されます。',
  },

  reconcile: {
    title: '在庫と帳簿の照合',
    agrees: '在庫記録と帳簿は一致しています',
    agreesBody:
      'どの棚卸資産勘定も、残っているロットの金額とちょうど同じです。在庫を動かさずに在庫勘定へ記帳されたものはありません。',
    disagrees: '在庫記録と帳簿が一致していません',
    disagreesBody:
      '在庫を動かさずに棚卸資産勘定へ直接記帳された仕訳があり、ロットから計算した原価がすべてその差額だけずれています。原因の仕訳を下に示します。取り消すか、それが表す入出庫を登録してください。',
    caption: '棚卸資産勘定とロットの照合',
    account: '勘定科目',
    products: '品目数',
    ledger: '帳簿残高',
    lots: 'ロット残高',
    difference: '差額',
    unexplained: '在庫を動かさない記帳',
  },

  stockOutcome: {
    checkProduct: '品目コード、名称、単位を入力してください。',
    added: (name) => `${name} を追加しました。これで入庫を登録できます。`,
    plainNumber: '1250 や 24.687 のような数値を入力してください。',
    checkQuantityAndAmount: '数量と金額を確認してください。',
    checkQuantity: '数量を確認してください。',
    tooManyDecimals: (places) =>
      places === 0
        ? 'この品目は整数単位で数えます。'
        : `この品目の数量は小数点以下 ${places} 桁までです。数量を丸めるか、品目の桁数を変更してください。`,
    quantityPlain: '数量を数値で入力してください。',
    amountPlain: '支払額を数値で入力してください。',
    bookedIn: (quantity, unit) => `${quantity} ${unit} を入庫しました。仕入の仕訳も記帳済みです。`,
    lotsJoiner: '、次に ',
    shippedFrom: (lots) => `出庫しました。原価は ${lots} から計算し、売上原価を記帳しました。`,
    shipped: '出庫し、売上原価を記帳しました。',
    chooseReason: '廃棄の理由を選んでください。',
    writtenOff: (quantity, unit) => `${quantity} ${unit} を廃棄しました。`,
    writtenOffFrom: (quantity, unit, lots) =>
      `${quantity} ${unit} を廃棄しました。原価は ${lots} から計算しました。`,
  },
};

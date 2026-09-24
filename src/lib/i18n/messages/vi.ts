import type { Messages } from './en';

/**
 * Giao diện bằng tiếng Việt.
 *
 * Typed as `Messages`, so a key missing here is a compile error rather than an
 * English word surfacing in the middle of a Vietnamese sentence.
 *
 * Two things this is *not* doing, both deliberate.
 *
 * It is not translating account names. `632 Giá vốn hàng bán` is what that
 * account is called under Thông tư 200, and a tenant's own account names are
 * data they typed — switching the interface to English must not rename their
 * books. See `docs/adr/0014-two-locales.md`.
 *
 * It is not inventing terms where the law already supplies them. The costing
 * methods are named exactly as Thông tư 200 names them — *nhập trước, xuất
 * trước*, *bình quân gia quyền*, *thực tế đích danh* — because an accountant
 * recognises those phrases and would not recognise a literal translation of
 * "first in, first out".
 *
 * Vietnamese has no plural inflection, which removes an entire class of
 * problem: `Nhập 1 lô hàng` and `Nhập 12 lô hàng` differ only in the number.
 */
export const vi: Messages = {
  common: {
    appName: 'Obol',
    signIn: 'Đăng nhập',
    signOut: 'Đăng xuất',
    search: 'Tìm kiếm…',
    cancel: 'Hủy',
    back: 'Quay lại',
    none: 'Không có',
    reading: (org) => `Đang xem sổ của ${org}`,
    colourTheme: 'Màu giao diện',
    themeLight: 'Sáng',
    themeDark: 'Tối',
    themeSystem: 'Theo hệ thống',
    language: 'Ngôn ngữ',
    skipToContent: 'Bỏ qua, tới nội dung chính',
    somethingWentWrong: 'Đã có lỗi xảy ra',
    routeErrorBody:
      'Không tải được trang này. Sổ sách không bị ghi gì thêm — mọi thay đổi đều nằm trong một giao dịch cơ sở dữ liệu, nên khi lỗi xảy ra sẽ không còn lại bút toán dở dang nào.',
    errorReference: 'Mã tham chiếu',
    pageNotFound: 'Trang này không tồn tại',
    keepYourOwnBooks: 'Ghi sổ của riêng bạn',
    working: 'Đang xử lý…',
    refusalSignIn:
      'Hãy đăng nhập để lập sổ sách của riêng bạn. Đây là bản trình diễn công khai: ai cũng xem được, không ai sửa được.',
    refusalNoLedger: 'Tài khoản này chưa có sổ sách nào. Hãy tạo một bộ sổ để bắt đầu ghi sổ.',
    refusalReadOnly: 'Bạn chỉ có quyền xem trên bộ sổ này.',
  },

  nav: {
    primary: 'Điều hướng chính',
    overview: 'Tổng quan',
    accounts: 'Tài khoản',
    stock: 'Kho hàng',
    sales: 'Bán hàng',
    journal: 'Sổ nhật ký',
    reports: 'Báo cáo',
    monthEnd: 'Khóa sổ',
    tax: 'Thuế',
    newEntry: 'Bút toán mới',
    webhooks: 'Webhook',
    api: 'API',
    settings: 'Cài đặt',
    morePages: 'Các trang khác',
  },

  overview: {
    title: 'Tổng quan',
    description: 'Mọi con số dưới đây đều được tính từ các bút toán vốn đã cân bằng sẵn.',
    postEntry: 'Ghi bút toán',

    balanced: 'Sổ sách cân đối',
    notBalanced: 'Sổ sách chưa cân đối',
    balancedBody: 'Tổng Nợ bằng tổng Có ở mọi loại tiền, chênh lệch đúng bằng 0.',
    notBalancedBody:
      'Chênh lệch khác 0 nghĩa là số dư đang lưu không còn khớp với các bút toán sinh ra nó.',
    debits: 'Tổng Nợ',
    credits: 'Tổng Có',
    residual: 'Chênh lệch',

    cashAndAssets: 'Tiền và tài sản',
    debitNormalBalances: 'Các tài khoản thường dư Nợ',
    revenue: 'Doanh thu',
    revenueDetail: 'Thường dư Có, hiển thị số dương',
    expenses: 'Chi phí',
    entriesPosted: 'Bút toán đã ghi',
    entriesDetail: (postings, accounts) => `${postings} dòng, trên ${accounts} tài khoản`,

    volumeTitle: 'Phát sinh theo ngày',
    volumeHint: 'Chỉ tính bên Nợ, 30 ngày gần nhất — mỗi bút toán đều có bên Có bằng đúng như vậy.',

    positionTitle: 'Số dư theo loại tài khoản',
    positionHint: 'Tài sản + Chi phí = Nợ phải trả + Vốn chủ sở hữu + Doanh thu',
    positionEmpty: 'Chưa có tài khoản nào',
    positionEmptyBody: 'Hãy mở một tài khoản để bắt đầu ghi sổ.',
    positionCaption: 'Tổng số dư theo loại tài khoản',
    klass: 'Loại tài khoản',
    accountCount: 'Số tài khoản',
    balanceIn: (currency) => `Số dư (${currency})`,
    debitSide: 'Bên Nợ',
    creditSide: 'Bên Có',
    equationHolds: 'Phương trình kế toán đúng',
    equationBroken: 'Phương trình kế toán sai',

    recentTitle: 'Bút toán gần đây',
    fullJournal: 'Xem toàn bộ sổ',
    journalEmpty: 'Sổ nhật ký đang trống',
    journalEmptyBody: 'Hãy ghi bút toán đầu tiên để thấy nó xuất hiện ở đây.',
    recentCaption: 'Sáu bút toán gần nhất',
    date: 'Ngày',
    entryDescription: 'Nội dung',
    accounts: 'Tài khoản',
    amount: 'Số tiền',
  },

  accounts: {
    title: 'Hệ thống tài khoản',
    description:
      'Nhóm theo loại tài khoản. Số dư hiển thị theo cách kế toán vẫn đọc — số dương là bình thường, bất kể tài khoản đó thường dư bên nào.',
    postEntry: 'Ghi bút toán',

    emptyTitle: 'Chưa có tài khoản nào',
    emptyBody: 'Tài khoản được tạo qua API. Chạy pnpm db:seed để nạp một tháng số liệu mẫu.',

    asset: 'Tài sản',
    liability: 'Nợ phải trả',
    equity: 'Vốn chủ sở hữu',
    revenue: 'Doanh thu',
    expense: 'Chi phí',

    assetBlurb: 'Những gì doanh nghiệp đang có. Ghi Nợ làm tăng.',
    liabilityBlurb: 'Những gì doanh nghiệp đang nợ. Ghi Có làm tăng.',
    equityBlurb: 'Phần còn lại thuộc về chủ sở hữu. Ghi Có làm tăng.',
    revenueBlurb: 'Doanh thu đã ghi nhận. Ghi Có làm tăng.',
    expenseBlurb: 'Chi phí đã phát sinh. Ghi Nợ làm tăng.',

    normalDebit: 'Thường dư Nợ',
    normalCredit: 'Thường dư Có',

    tableCaption: (group) => `Tài khoản và số dư — ${group}`,
    code: 'Số hiệu',
    account: 'Tên tài khoản',
    identifier: 'Định danh',
    overdraft: 'Cho phép âm',
    balance: 'Số dư',
    statement: 'Sổ chi tiết',
    closed: 'Đã đóng',
    overdraftAllowed: 'Được phép',
    overdraftBlocked: 'Không cho phép',

    overdraftNote:
      'Tài khoản không cho phép số dư âm thì không thể bị đẩy xuống dưới 0. Quy tắc này được ràng buộc bằng CHECK ngay trong Postgres chứ không chỉ ở tầng ứng dụng, nên vẫn có hiệu lực với mọi kết nối ghi trực tiếp vào cơ sở dữ liệu.',
  },

  stock: {
    title: 'Kho hàng',
    description:
      'Mỗi lần nhập hàng được giữ thành một lô riêng với giá riêng. Khi xuất hàng, hệ thống tự tính giá vốn từ chính những lô đã xuất — và cho bạn biết đó là những lô nào.',
    importButton: 'Nhập từ bảng tính',
    sellButton: 'Lập hóa đơn bán hàng',

    inTheYard: 'Hàng đang có trong kho',
    inTheYardHint: 'Giá trị ở đây là giá vốn, không phải giá bán.',
    tableCaption: 'Các mặt hàng đang giữ, kèm số lượng tồn và giá trị',
    product: 'Mặt hàng',
    onHand: 'Tồn kho',
    deliveriesOpen: 'Lô còn hàng',
    costedBy: 'Tính giá theo',
    value: 'Giá trị',
    totalValue: 'Tổng giá trị tồn kho',
    justThisProduct: 'riêng mặt hàng này',

    emptyTitle: 'Chưa có mặt hàng nào',
    emptyBody:
      'Hãy thêm những mặt hàng bạn mua vào và bán ra. Khi đã có mặt hàng, bạn mới nhập kho cho nó được, và hệ thống sẽ tự tính giá vốn cho từng lần xuất.',

    addProduct: 'Thêm mặt hàng',
    addProductHint:
      'Mặt hàng là thứ bạn mua vào rồi bán ra. Phải có mặt hàng trước thì mới nhập kho được.',
    addProductButton: 'Thêm mặt hàng',
    needAccounts:
      'Bạn cần một tài khoản tài sản để chứa giá trị hàng tồn và một tài khoản chi phí cho giá vốn hàng bán. Hãy mở chúng ở',
    chartOfAccountsLink: 'hệ thống tài khoản',
    firstSuffix: 'trước đã.',

    productCode: 'Mã hàng',
    productCodeHint: 'Tên gọi bạn vẫn dùng trên phiếu đóng gói.',
    name: 'Tên hàng',
    namePlaceholder: 'Đá lát granite 600×600',
    measuredIn: 'Đơn vị tính',
    measuredInHint: 'Mét vuông, tấn, viên — đơn vị bạn ghi trên hóa đơn.',
    costingMethod: 'Phương pháp tính giá xuất kho',
    costingMethodHint: 'Giữ nguyên mặc định của công ty, trừ khi mặt hàng này là hàng độc bản.',
    companyDefault: 'Mặc định của công ty',
    stockAccount: 'Tài khoản hàng tồn kho',
    stockAccountHint: 'Nơi ghi nhận giá trị hàng trong thời gian còn giữ.',
    cogsAccount: 'Tài khoản giá vốn hàng bán',
    cogsAccountHint: 'Nơi ghi nhận giá vốn khi hàng được xuất.',

    methodFifo: 'Nhập trước, xuất trước',
    methodLifo: 'Nhập sau, xuất trước',
    methodAverage: 'Bình quân gia quyền',
    methodSpecific: 'Thực tế đích danh',
    methodFifoOption: 'Nhập trước, xuất trước (FIFO)',
    methodAverageOption: 'Bình quân gia quyền',
    methodSpecificOption: 'Thực tế đích danh (tự chọn lô khi xuất)',
  },

  product: {
    allStock: 'Tất cả mặt hàng',
    measuredInSuffix: (unit) => `đơn vị tính: ${unit}`,
    onHand: 'Tồn kho',
    whatItCost: 'Giá vốn đang giữ',
    deliveriesStillOpen: 'Lô còn hàng',

    lotsTitle: 'Các lô bạn còn giữ',
    lotsHint: 'Cũ nhất trước — đúng thứ tự sẽ được xuất, trừ khi bạn chỉ định khác.',
    lotsCaption: 'Các lô còn hàng, cũ nhất trước',
    reference: 'Số chứng từ',
    arrived: 'Ngày nhập',
    left: 'Còn lại',
    paidForLot: 'Giá trị cả lô',
    valueOfRemainder: 'Giá trị phần còn lại',
    ofTotal: (total) => `trên ${total}`,
    delivery: 'Lô hàng',
    openingBalance: 'Tồn đầu kỳ',
    nothingOnHand: 'Kho đang trống',
    nothingOnHandBody: 'Hãy nhập kho một lô ở bên dưới; lô đó sẽ hiện ở đây với giá riêng của nó.',

    receiveTitle: 'Nhập kho',
    receiveHint:
      'Thao tác này vừa mở một lô mới vừa ghi bút toán mua hàng, trong cùng một lần — nên số liệu kho và số liệu kế toán không thể lệch nhau.',
    receiveButton: 'Nhập kho lô này',
    howMuchArrived: (unit) => `Số lượng nhập (${unit})`,
    decimalHint: (places) =>
      places > 0 ? `Tối đa ${places} chữ số thập phân.` : 'Nhập số nguyên.',
    paidInTotal: 'Tổng tiền phải trả',
    paidInTotalHint: 'Giá trị cả lô, không phải đơn giá.',
    paidIn: 'Loại tiền',
    paidFrom: 'Trả từ / còn nợ',
    paidFromHint: 'Tài khoản ngân hàng đã chi tiền, hoặc nhà cung cấp bạn còn nợ.',
    dateArrived: 'Ngày hàng về',
    referenceHint: 'Số container hoặc số hóa đơn. Đây là thông tin sẽ hiện trong báo cáo giá vốn.',
    needCreditAccount: 'Hãy mở một tài khoản ngân hàng hoặc tài khoản phải trả người bán ở',

    issueTitle: 'Xuất kho',
    issueHint: 'Hệ thống tự tính giá vốn từ các lô đã xuất, và từ chối nếu kho không đủ hàng.',
    issueButton: 'Xuất kho',
    howMuchWentOut: (unit) => `Số lượng xuất (${unit})`,
    dateShipped: 'Ngày xuất',
    issueReferenceHint: 'Số đơn hàng hoặc số hóa đơn bán ra.',
    whichDelivery: 'Xuất từ lô nào',
    whichDeliveryOptional: 'Xuất từ lô nào (không bắt buộc)',
    whichDeliveryRequiredHint:
      'Mặt hàng này tính giá theo thực tế đích danh, nên bắt buộc phải chỉ rõ lô.',
    whichDeliveryOptionalHint: 'Để trống thì hệ thống xuất lô cũ nhất trước.',
    chooseDelivery: 'Chọn một lô…',
    oldestFirst: 'Lô cũ nhất trước',
    lotOption: (reference, quantity) => `${reference} — còn ${quantity}`,
    nothingToShip: 'Kho không còn hàng để xuất. Hãy nhập kho trước.',

    movementsTitle: 'Toàn bộ phát sinh',
    movementsHint:
      'Mỗi lần xuất đều ghi rõ giá vốn được tính từ những lô nào. Đây chính là phần tính toán mà bình thường bạn phải làm bằng Excel.',
    movementsCaption: 'Phát sinh nhập xuất, mới nhất trước',
    date: 'Ngày',
    whatHappened: 'Nội dung',
    quantity: 'Số lượng',
    costedFrom: 'Tính giá từ lô',
    cost: 'Giá vốn',
    deliveryIn: 'Nhập kho',
    shippedOut: 'Xuất kho',
    nothingMoved: 'Chưa có phát sinh nào',
    nothingMovedBody: 'Các lần nhập kho và xuất kho sẽ được liệt kê ở đây.',
    writeOffTitle: 'Xuất hủy hàng hóa',
    writeOffHint:
      'Hàng hỏng, vỡ, hết hạn, mất mát hoặc thiếu khi kiểm kê. Giá vốn được tính từ các lô giống hệt như khi bán, và ghi vào tài khoản chi phí bạn chọn — để hao hụt không lẫn vào giá vốn hàng bán.',
    writeOffButton: 'Xuất hủy',
    howMuchWrittenOff: (unit) => `Số lượng (${unit})`,
    reason: 'Lý do',
    reasonDamaged: 'Hàng hỏng, vỡ',
    reasonExpired: 'Hết hạn sử dụng',
    reasonLost: 'Mất mát',
    reasonCountShortfall: 'Thiếu khi kiểm kê',
    reasonOther: 'Lý do khác',
    lossAccount: 'Tài khoản ghi nhận tổn thất',
    lossAccountHint: 'Một tài khoản chi phí: hao hụt, mất mát, hàng hỏng.',
    writeOffReferenceHint: 'Số biên bản kiểm kê hoặc biên bản hàng hỏng.',
    needLossAccount: 'Hãy mở một tài khoản chi phí cho hao hụt hàng tồn kho ở',
    writtenOff: 'Xuất hủy',
    sold: 'Bán',
    soldFor: 'Doanh thu',
  },

  journal: {
    title: 'Sổ nhật ký',
    description:
      'Toàn bộ bút toán, mới nhất trước, kèm các dòng hạch toán. Bút toán chỉ ghi thêm: sai thì ghi bút toán điều chỉnh, không bao giờ sửa lại lịch sử.',
    entries: 'Bút toán',
    noMatches: 'Không có bút toán nào khớp với bộ lọc',
    noMatchesBody:
      'Thử từ khóa ngắn hơn, hoặc nới bộ lọc tài khoản. Bản thân sổ nhật ký không thay đổi.',
    clearFilters: 'Xóa bộ lọc',
    empty: 'Chưa ghi bút toán nào',
    emptyBody:
      'Sổ nhật ký đang trống. Hãy ghi một bút toán, hoặc chạy pnpm db:seed để nạp một tháng số liệu mẫu.',
    postEntry: 'Ghi bút toán',
    caption: 'Bút toán và các dòng hạch toán',
    date: 'Ngày',
    descriptionOrAccount: 'Nội dung / tài khoản',
    amount: 'Số tiền',
    debit: 'Nợ',
    credit: 'Có',
    reversed: 'Đã điều chỉnh',
    reversal: 'Bút toán điều chỉnh',
    balanced: 'Cân đối',
    enteredBy: 'Người nhập',
    viaUi: 'Nhập thủ công',
    viaApi: 'Qua API',
    viaSystem: 'Hệ thống tự ghi',
    viaImport: 'Nhập từ bảng tính',
    viaUnknown: 'Không ghi nhận',
  },

  transfer: {
    title: 'Ghi bút toán',
    description:
      'Ghi một bút toán vào sổ. Tính cân đối được kiểm tra ngay khi bạn gõ, kiểm tra lại ở tầng nghiệp vụ, và lần thứ ba do Postgres kiểm tra tại thời điểm COMMIT.',
    tooMany: (seconds) =>
      `Bạn ghi quá nhiều bút toán trong thời gian ngắn. Hãy thử lại sau ${seconds} giây.`,
    checkFields: 'Chưa ghi được bút toán. Hãy kiểm tra các ô được đánh dấu.',
    notAnAmount: (line, amount, currency) =>
      `Dòng ${line}: “${amount}” không phải là số tiền hợp lệ bằng ${currency}.`,
    notRepresentable: (currency) => `Không ghi được bằng ${currency}`,
    posted: (id) => `Đã ghi bút toán ${id}.`,
  },

  reports: {
    title: 'Báo cáo',
    description:
      'Hai báo cáo mà mọi sổ kế toán sinh ra để lập. Cả hai đều tính từ chính các bút toán đã ghi — không có kho dữ liệu báo cáo riêng để lệch nhau.',
    sheetBalances: 'Bảng cân đối kế toán cân',
    sheetDoesNot: 'Bảng cân đối kế toán chưa cân',
    assets: 'Tài sản',
    amount: 'Số tiền',
    sectionCaption: (section) => `${section} theo tài khoản`,
    sectionEmpty: (section) => `Không có tài khoản ${section.toLowerCase()} nào ở loại tiền này.`,
    sectionTotal: (section) => `Cộng ${section.toLowerCase()}`,
    equation: 'Tài sản = Nợ phải trả + Vốn chủ sở hữu + Lợi nhuận chưa phân phối',
    liabilitiesPlusEquity: 'Nợ phải trả + vốn chủ sở hữu',
    period30: '30 ngày',
    period90: '90 ngày',
    period365: '12 tháng',
    balanceSheet: 'Bảng cân đối kế toán',
    asAt: (date) => `Số liệu tại ngày ${date}`,
    retainedEarnings: 'Lợi nhuận sau thuế chưa phân phối',
    incomeStatement: 'Báo cáo kết quả hoạt động kinh doanh',
    reportingPeriod: 'Kỳ báo cáo',
    netIncome: 'Lợi nhuận thuần',
    netIncomeHint: 'Doanh thu trừ chi phí trong kỳ',
    profit: 'Lãi',
    lossOrBreakeven: 'Lỗ hoặc hòa vốn',
  },

  monthEnd: {
    title: 'Khóa sổ cuối tháng',
    description:
      'Ba việc, làm theo thứ tự, mỗi tháng một lần. Bạn cứ bấm sớm cũng được — nếu chưa tới lúc, hệ thống sẽ nói rõ lý do chứ không làm sai.',
    open: 'Đang mở',
    closed: 'Đã khóa',
    entriesInMonth: (count) =>
      `${count} bút toán. Khóa sổ theo thứ tự tháng cũ trước, nên đây là tháng cần xử lý.`,
    allClosed:
      'Mọi tháng có phát sinh đều đã khóa. Tháng tiếp theo sẽ hiện ra khi tháng đó kết thúc.',

    step1: 'Nhập tỷ giá',
    step1NoForeign: (functional) =>
      `Bạn chỉ giữ ${functional} nên không có tỷ giá nào phải nhập. Bước này không cần làm gì.`,
    step1Body: (day, currencies) =>
      `Vào ngày ${day}, một đơn vị mỗi loại ngoại tệ đáng giá bao nhiêu? Dùng tỷ giá ngân hàng của bạn hoặc Ngân hàng Nhà nước công bố hôm đó. Bạn đang giữ ${currencies}.`,
    step1Done: (currencies) => `Đã có tỷ giá cho ${currencies}.`,

    step2: 'Đánh giá lại số dư ngoại tệ',
    step2NoForeign: (functional) =>
      `Không có gì phải đánh giá lại — mọi tài khoản đều đã là ${functional}.`,
    step2Body: (currencies, functional) =>
      `Khách hàng đang nợ bạn bằng ${currencies}. Số tiền đó quy ra ${functional} hôm nay đã khác lúc bạn xuất hóa đơn. Bước này tính ra phần chênh lệch và ghi nhận vào doanh thu hoặc chi phí.`,
    whatWillChange: 'Bấm nút này thì những khoản sau sẽ thay đổi:',
    step2Button: 'Đánh giá lại số dư ngoại tệ',
    step2Pending: 'Đang xử lý…',

    step3: 'Khóa sổ tháng',
    step3Body: (month) =>
      `Sau bước này, không ai thêm hay sửa được bút toán ghi ngày trong ${month}. Đó chính là điều làm cho số liệu của tháng trở thành số chốt. Lợi nhuận trong tháng được kết chuyển sang lợi nhuận chưa phân phối. Nếu cần, bạn vẫn mở lại được.`,
    step3Button: 'Khóa sổ tháng',
    step3Pending: 'Đang khóa…',
    step3Confirm: (month) =>
      `Khóa ${month}? Bút toán ghi ngày trong tháng này sẽ không thêm hay sửa được nữa.`,

    months: 'Các tháng',
    rateCurrency: 'Loại tiền',
    rateWorth: (functional) => `Quy đổi ra bao nhiêu ${functional}`,
    rateSave: 'Lưu tỷ giá',
    rateSaving: 'Đang lưu…',
    noMonths: 'Chưa có phát sinh nên chưa có tháng nào để khóa.',
    reopen: 'Mở lại',
    stepNumber: (n) => `Bước ${n}`,

    rateNotANumber: 'Nhập tỷ giá chỉ gồm chữ số, không có dấu phân cách hàng nghìn, ví dụ 25700.',
    rateSaved: (base, rate, functional, day) =>
      `Đã lưu tỷ giá ngày ${day}: 1 ${base} = ${rate} ${functional}.`,
    pickMonth: 'Hãy chọn tháng trước.',
    revalued: (count) => `Đã đánh giá lại ${count} số dư ngoại tệ theo tỷ giá cuối tháng.`,
    nothingToRevalue:
      'Đã kiểm tra mọi số dư ngoại tệ — tỷ giá không đổi nên không có gì phải điều chỉnh.',
    monthClosed: (month) => `Đã khóa sổ ${month}. Số liệu của tháng này sẽ không thay đổi nữa.`,
    monthReopened: (month) =>
      `Đã mở lại ${month}. Bút toán kết chuyển đã được ghi đảo, và cả hai vẫn nằm trên sổ.`,
  },

  misc: {
    entriesNote:
      'Tổng các dòng hạch toán của mỗi bút toán bằng 0 — được kiểm tra tại thời điểm COMMIT bằng ràng buộc trì hoãn của cơ sở dữ liệu.',
    statementNote:
      'Các bút toán đã hạch toán, mới nhất trước. Số dư lũy kế do Postgres tính trên chính các dòng của tài khoản này, nên khớp với số dư đã hạch toán ở trên.',
    filterMatchNote: 'Đang hiển thị các bút toán khớp với bộ lọc bên dưới.',
    newer: 'Mới hơn',
    older: 'Cũ hơn',
    showingEntries: (count) => `Đang hiển thị ${count} bút toán`,
    showingLines: (count) => `Đang hiển thị ${count} dòng`,
    applyFilters: 'Áp dụng',
    clearFilters: 'Xóa lọc',
    chartDay: 'Ngày',
    chartVolume: (currency) => `Giá trị (${currency})`,
    chartCaption: (currency) => `Giá trị bút toán theo ngày, tính bằng ${currency}`,
    alreadyReversedNote:
      'Bút toán này đã được ghi đảo rồi, và mỗi bút toán chỉ được ghi đảo một lần — nếu không thì khoản điều chỉnh sẽ bị tính hai lần.',
    reopenNote:
      'Kỳ đã khóa vẫn mở lại được. Bút toán kết chuyển ban đầu vẫn nằm nguyên trên sổ và một bút toán đảo sẽ triệt tiêu nó, nên luôn có dấu vết để lần lại.',
    signInPitch:
      'Đăng nhập để có sổ sách của riêng bạn — hệ thống tài khoản của bạn, bút toán của bạn, đơn vị tiền của bạn. Bản demo vẫn giữ nguyên như cũ.',
    overdraftNote:
      'Khi tắt, mọi bút toán làm tài khoản này âm đều bị từ chối — bởi ràng buộc CHECK trong Postgres chứ không chỉ bởi ứng dụng. Các tài khoản điều chỉnh giảm và phần lớn tài khoản nợ phải trả, vốn chủ sở hữu, doanh thu đều cần bật mục này.',
    settleNote:
      'Khi tất toán, hệ thống kiểm tra lại quy tắc thấu chi — số dư khả dụng lúc duyệt có thể đã không còn.',
    starterChartNote:
      'Kèm theo là một hệ thống tài khoản mẫu. Sau đó bạn vẫn đổi tên, thêm mới và đóng tài khoản được.',
    exportCsv: 'Xuất CSV',
    tryAgain: 'Thử lại',
    inEffect: 'Đang hiệu lực',
    allAccounts: 'Tất cả tài khoản',
    viewJournal: 'Xem sổ nhật ký',
    viewAsTable: 'Xem dạng bảng',
    noActivity: 'Chưa có phát sinh để vẽ biểu đồ.',
    fundsReserved: 'Số tiền đã được giữ lại, nên đã trừ khỏi',
    retainedNote: 'Doanh thu trừ chi phí, kết chuyển vào vốn chủ sở hữu như khi khóa sổ',
    reading: 'Đang xem',
    noDatabase: 'Hệ thống chưa có cơ sở dữ liệu',

    notFoundBody: 'Không tìm thấy tài khoản hoặc bút toán bạn yêu cầu trong sổ này.',
    backToOverview: 'Về trang tổng quan',
    noPassword: 'Không phải nghĩ hay nhớ mật khẩu. Không lưu gì có thể bị lộ.',
    readDemo: 'Xem sổ mẫu',
    onboardingIntro: 'Một câu hỏi trước khi bắt đầu, vì đây là thứ sau này không đổi được.',
    chartIsAStart: 'Chỉ là điểm bắt đầu, không phải khuôn cứng \u2014 trừ khi luật quy định khác.',

    accountFormIntro: 'Một cái tên và một loại. Loại quyết định bên nào làm tăng số dư.',
    accountsNeverDeleted:
      'Tài khoản không bao giờ bị xóa. Có thể đóng lại, và lịch sử vẫn được giữ nguyên.',
    filterDescription: 'Nội dung',
    filterAccount: 'Tài khoản',

    viewReversal: 'Xem bút toán điều chỉnh',
    noEditing: 'Bút toán không sửa được. Sai thì ghi một bút toán điều chỉnh để sửa lại.',
    reverseThis: 'Điều chỉnh bút toán này',
    reverseNote: 'Thao tác này ghi thêm một bút toán mới, không xóa bút toán hiện tại',
    entryPending: 'Bút toán này đang chờ xử lý',
    cancelIt: 'Hủy bút toán',
    cancelledNote:
      'Bút toán này đã bị hủy trước khi hoàn tất, nên chưa bao giờ tác động vào số dư. Không có gì để điều chỉnh \u2014 điều chỉnh là để hủy phần tiền đã thực sự dịch chuyển, mà ở đây thì không.',
  },

  entry: {
    pending: 'Chờ xử lý',
    cancelled: 'Đã hủy',
    reversed: 'Đã điều chỉnh',
    reversingEntry: 'Bút toán điều chỉnh',
    amount: 'Số tiền',
    occurred: 'Ngày phát sinh',
    postings: 'Các dòng hạch toán',
    postingsHint: 'Theo đúng thứ tự khi ghi bút toán.',
    sumsToZero: 'Cộng lại bằng 0, được kiểm tra tại thời điểm COMMIT',
    metadata: 'Dữ liệu kèm theo',
    account: 'Tài khoản',
    ownedByStockTitle: 'Bút toán do sổ kho ghi',
    ownedByStock:
      'Bút toán này vừa ghi tiền vừa ghi hàng, nên không thể đảo ở đây — làm vậy sẽ thay đổi tài khoản mà không thay đổi các lô hàng đứng sau nó. Hãy điều chỉnh từ trang kho: xuất hủy, hoặc bổ sung chi phí cho lô hàng.',
    openSale: 'Mở hóa đơn',
    cancelledByReversal:
      'Bút toán này đã bị hủy bởi một bút toán đảo sau đó. Nó vẫn được lưu trên sổ; tác động ròng bằng không.',
    cancelsEarlier:
      'Bút toán này được lập để hủy một bút toán trước đó. Cả hai đều được lưu trên sổ.',
    viewOriginal: 'Xem bút toán gốc',
    reservedNotMoved: 'Đã giữ chỗ, chưa ghi nhận',
    cancelledNeverMoved: 'Đã hủy; chưa từng ghi nhận',
    debitSideMatches: 'Bên Nợ; bên Có khớp đúng',
    metadataHintBefore:
      'Mã tham chiếu riêng của bên gọi. Sổ cái không diễn giải, nhưng tìm kiếm được —',
    metadataHintAfter: 'trên sổ nhật ký.',
  },

  statement: {
    closed: 'Đã đóng',
    pendingNote: 'Chờ xử lý \u2014 chưa tính vào số dư',
    date: 'Ngày',
    description: 'Nội dung',
    amount: 'Số tiền',
    balance: 'Số dư',
    title: 'Sổ chi tiết',
    emptyTitle: 'Chưa có phát sinh',
    emptyBody: 'Tài khoản này chưa có bút toán nào. Khi có, nó sẽ hiện ngay ở đây.',
    line: 'dòng',
    postedBalance: 'Số dư đã ghi sổ',
    postedHint: 'Chỉ tính bút toán đã hoàn tất \u2014 số thực có',
    available: 'Khả dụng',
    pending: 'Đang chờ',
    pendingHint: 'Đã ghi sổ cộng phần đang chờ \u2014 số sẽ có nếu mọi thứ hoàn tất',
    openAnAccount: 'Mở tài khoản',
    classHint:
      'Loại tài khoản không phải chuyện hình thức: nó quyết định bên nào làm tăng số dư, và cách tài khoản được trình bày ở mọi nơi.',
    reopening: 'Đang mở lại\u2026',
  },

  forms: {
    entryDetails: 'Thông tin bút toán',
    entryDetailsHint: 'Nội dung nghiệp vụ và loại tiền ghi nhận.',
    description: 'Nội dung',
    descriptionHint: 'Bút toán này ghi nhận việc gì, ví dụ \u201cThu tiền hóa đơn 1042\u201d.',
    descriptionPlaceholder: 'Mua nguyên vật liệu',
    currency: 'Loại tiền',
    postings: 'Các dòng hạch toán',
    postingsHint:
      'Tổng bên Nợ phải bằng tổng bên Có. Không cân thì không phải là một bút toán hợp lệ.',
    lineAccount: 'Tài khoản dòng {n}',
    sumToZero: 'Bút toán chỉ được ghi nhận khi các dòng hạch toán cộng lại bằng 0.',
    selectAccount: 'Chọn tài khoản\u2026',
    side: 'Bên',
    amount: 'Số tiền',
    addPosting: 'Thêm dòng',
    remove: 'Xóa',
    incomplete: 'Chưa đủ thông tin',
    entryFailed: 'Không ghi được bút toán.',
    postEntry: 'Ghi bút toán',
    posting: 'Đang ghi\u2026',

    accountDetails: 'Thông tin tài khoản',
    accountName: 'Tên tài khoản',
    accountNameHint: 'Không trùng trong cùng một loại tiền, ví dụ \u201cTiền mặt\u201d.',
    accountNamePlaceholder: 'Tiền gửi ngân hàng',
    accountClass: 'Loại tài khoản',
    allowOverdraft: 'Cho phép số dư âm',
    accountFailed: 'Không mở được tài khoản.',
    openAccount: 'Mở tài khoản',
    opening: 'Đang mở\u2026',
    yourLedger: 'Sổ sách của bạn',
    ledgerName: 'Tên',
    ledgerNameHint: 'Chỉ mình bạn nhìn thấy.',
    chartOfAccounts: 'Hệ thống tài khoản',
    functionalCurrency: 'Đồng tiền ghi sổ',
    functionalCurrencyHint:
      'Đồng tiền bạn dùng để ghi sổ. Mọi bút toán đều cân bằng theo đồng tiền này, nên sau này không đổi được nếu không ghi lại toàn bộ những gì đã hạch toán.',
    createLedger: 'Tạo sổ cho tôi',
    creating: 'Đang tạo\u2026',
    somethingWrong: 'Có lỗi xảy ra.',

    searchEntries: 'Tìm bút toán\u2026',
    anyAccount: 'Tất cả tài khoản',
    noMatch: 'Không có bút toán nào khớp. Thử từ khóa ngắn hơn, hoặc xóa bộ lọc.',
    pagination: 'Phân trang',

    reversalDescription: 'Nội dung bút toán điều chỉnh',
    reversalHint:
      'Không bắt buộc. Mặc định là \u201cBút toán điều chỉnh cho \u2026\u201d, thường là đủ.',
    postReversal: 'Ghi bút toán điều chỉnh',
    tooManyReversals: (seconds) =>
      `Bạn ghi đảo quá nhiều lần trong thời gian ngắn. Hãy thử lại sau ${seconds} giây.`,
    noEntryGiven: 'Chưa chọn bút toán nào.',
    reversedBy: (id) => `Đã ghi đảo bằng bút toán ${id}.`,
    tooManyTransitions: (seconds) =>
      `Bạn thao tác quá nhiều lần trong thời gian ngắn. Hãy thử lại sau ${seconds} giây.`,
    transitionUnavailable: 'Không thể thực hiện thao tác này với bút toán này.',
    settled: 'Đã tất toán bút toán.',
    cancelledNothingMoved: 'Đã hủy bút toán; không có khoản tiền nào dịch chuyển.',

    tooManyAccounts: (seconds) =>
      `Bạn mở quá nhiều tài khoản trong thời gian ngắn. Hãy thử lại sau ${seconds} giây.`,
    accountCheckFields: 'Chưa mở được tài khoản. Hãy kiểm tra các ô được đánh dấu.',
    accountExists: (name, currency) => `Đã có tài khoản tên “${name}” theo dõi bằng ${currency}.`,
    alreadyInUse: 'Tên này đã được dùng',
  },

  palette: {
    label: 'Tìm kiếm và lệnh',
    placeholder: 'Tìm tài khoản, bút toán và trang\u2026',
    results: 'Kết quả',
    searching: 'Đang tìm\u2026',
    pages: 'Trang',
    accounts: 'Tài khoản',
    entries: 'Bút toán',
  },

  aging: {
    title: 'Công nợ theo tuổi nợ',
    description:
      'Khoản phải thu, phải trả đã tồn bao lâu. Tính từ chính các bút toán đã ghi — không có sổ công nợ riêng để lệch với sổ cái.',
    receivables: 'Phải thu khách hàng',
    payables: 'Phải trả người bán',
    caption: (account) => `${account}, nợ cũ nhất trước`,
    invoice: 'Số hóa đơn',
    dated: 'Ngày',
    age: 'Tuổi nợ',
    outstanding: 'Còn lại',
    days: (count) => `${count} ngày`,
    current: 'Đến 30 ngày',
    days31to60: '31–60 ngày',
    days61to90: '61–90 ngày',
    over90: 'Trên 90 ngày',
    total: 'Cộng',
    overdue: (percent) => `${percent}% quá 30 ngày`,
    emptyTitle: 'Không còn công nợ',
    emptyBody: 'Mọi hóa đơn trên các tài khoản này đều đã thanh toán xong.',
    convention:
      'Hệ thống không ghi nhận khoản thanh toán ứng với hóa đơn nào, nên mặc định trừ vào hóa đơn cũ nhất trước. Đó là quy ước chứ không phải sự thật — điều này quan trọng khi khách trả hóa đơn sau nhưng đang khiếu nại hóa đơn trước.',
    credit: 'trả thừa',
  },

  tax: {
    title: 'Tờ khai thuế GTGT',
    description:
      'Thuế đầu ra, thuế đầu vào và số còn phải nộp. Khi kết chuyển, hệ thống ghi bút toán khấu trừ hai tài khoản thuế, nên số thuế chưa khấu trừ hết nằm luôn trên sổ chứ không chỉ trên tờ khai.',
    codes: 'Thuế suất',
    codesDescription:
      'Các mức thuế suất doanh nghiệp xuất và được khấu trừ. Mỗi mức đã gắn sẵn tài khoản hạch toán, nên khi ghi hóa đơn không phải chọn lại.',
    noCodes: 'Chưa khai báo thuế suất',
    noCodesBody: 'Khai báo thuế suất trước khi ghi hóa đơn bán ra hoặc mua vào có thuế.',
    addCode: 'Thêm thuế suất',
    codeName: 'Tên',
    rate: 'Thuế suất',
    treatment: 'Loại',
    vat: 'Thuế GTGT',
    reverseCharge: 'Thuế nhà thầu nước ngoài',
    salesTax: 'Thuế bán hàng (Hoa Kỳ)',
    inputAccount: 'Thuế GTGT được khấu trừ',
    outputAccount: 'Thuế GTGT đầu ra',
    none: 'Không có',
    vatHint: 'Xuất khi bán ra, được khấu trừ khi mua vào. Trường hợp thông thường.',
    reverseChargeHint:
      'Mua dịch vụ của nhà cung cấp nước ngoài: doanh nghiệp tự kê khai cả đầu ra lẫn đầu vào, hai bên bù trừ nhau.',
    salesTaxHint:
      'Áp dụng tại Hoa Kỳ. Thu hộ của khách rồi nộp lại; thuế trả khi mua vào là chi phí, không được khấu trừ.',
    period: 'Kỳ kê khai',
    periodReady: (month: string) => `Kỳ ${month} đã đủ điều kiện kê khai`,
    nothingDue: 'Không có kỳ nào cần kê khai',
    nothingDueBody: 'Mọi kỳ đã kết thúc đều đã kê khai. Kỳ hiện tại kê khai được sau khi kết thúc.',
    sales: 'Thuế GTGT đầu ra',
    purchases: 'Thuế GTGT đầu vào được khấu trừ',
    base: 'Giá trị chưa thuế',
    taxAmount: 'Tiền thuế',
    outputTax: 'Thuế GTGT đầu ra',
    inputTax: 'Thuế GTGT đầu vào được khấu trừ',
    broughtForward: 'Thuế GTGT chưa khấu trừ hết kỳ trước',
    payable: 'Thuế GTGT phải nộp',
    carriedForward: 'Thuế GTGT chưa khấu trừ hết chuyển kỳ sau',
    fileReturn: 'Kê khai kỳ này',
    filing: 'Đang kê khai…',
    filed: 'Các kỳ đã kê khai',
    filedCaption: 'Các kỳ đã kê khai, mới nhất trước',
    filedOn: 'Ngày kê khai',
    periodColumn: 'Kỳ',
    noReturns: 'Chưa kê khai kỳ nào',
    noReturnsBody: 'Sau khi một kỳ có phát sinh thuế kết thúc, kê khai kỳ đó tại đây.',
    viewEntry: 'Xem bút toán',
    noEntry: 'Không phát sinh bút toán',
    noEntryHint:
      'Kỳ này không có thuế đầu ra nên không có gì để khấu trừ. Toàn bộ thuế đầu vào chuyển sang kỳ sau.',
    inOrder:
      'Các kỳ được kê khai lần lượt từ cũ đến mới. Số thuế chưa khấu trừ hết chuyển từ kỳ này sang kỳ kế tiếp, nên bỏ qua một kỳ sẽ làm kỳ sau thiếu số đầu kỳ mà không có dấu hiệu nào.',
    carriedExplainer:
      'Thuế đầu vào lớn hơn thuế đầu ra nên kỳ này không phải nộp. Phần chênh lệch không được hoàn mà để lại khấu trừ vào kỳ sau.',
    pickPeriod: 'Hãy chọn kỳ kê khai trước.',
    filedNothingOwed: (credit) =>
      `Đã nộp tờ khai. Kỳ này không phải nộp thuế — ${credit} thuế GTGT chưa khấu trừ hết được chuyển sang kỳ sau.`,
    filedOwing: (payable) =>
      `Đã nộp tờ khai. Số thuế phải nộp là ${payable}, nằm trên tài khoản thuế phải nộp Nhà nước cho đến khi bạn nộp tiền.`,
    codeIncomplete: 'Hãy đặt tên và nhập thuế suất theo phần trăm, ví dụ 10 hoặc 8.',
    codeAdded: (name) => `Đã thêm thuế suất ${name}.`,
  },

  shipments: {
    title: 'Lô hàng nhập khẩu',
    description:
      'Giá thực tế để đưa mỗi container về đến kho. Cước tàu, thuế nhập khẩu và phí giao nhận là chi phí thu mua, phải tính vào giá trị hàng tồn chứ không phải chi phí trong kỳ — và khoản chênh lệch thường không nhỏ.',
    caption: 'Các lô hàng, mới nhất trước',
    reference: 'Số chứng từ',
    arrived: 'Ngày về',
    lots: 'Số lô',
    goods: 'Giá trị hóa đơn',
    charges: 'Cước và thuế',
    landed: 'Giá thực tế nhập kho',
    uplift: 'Tăng thêm',
    emptyTitle: 'Chưa có lô hàng nào',
    emptyBody:
      'Một lô hàng gom các lần nhập kho cùng về một chuyến, để khi hóa đơn cước về sau vài tuần thì phân bổ được cho đúng những lần nhập đó.',
    newShipment: 'Tạo lô hàng',
    newShipmentHint: 'Đặt theo số bạn vẫn dùng — số container hoặc số vận đơn.',
    create: 'Tạo',

    lotsTitle: 'Hàng đã về',
    chargesTitle: 'Chi phí để đưa hàng về',
    chargesHint:
      'Mỗi khoản chi phí được phân bổ cho các lô ở trên và làm tăng giá trị ghi sổ của chúng. Nếu chi phí về sau khi đã bán bớt hàng, phần tương ứng với số đã bán được đưa thẳng vào giá vốn, vì không thể cộng vào lô hàng đã không còn.',
    chargesCaption: 'Chi phí của lô hàng này',
    noCharges: 'Chưa có chi phí nào',
    noChargesBody: 'Thêm hóa đơn cước tàu, thuế nhập khẩu và phí dịch vụ khi chúng về.',
    kind: 'Loại chi phí',
    chargeDescription: 'Nội dung',
    amount: 'Số tiền',
    toStock: 'Vào giá trị hàng tồn',
    toCogs: 'Vào giá vốn',
    notCapitalised: 'không tính vào giá vốn hàng',

    addCharge: 'Thêm chi phí',
    basis: 'Phân bổ theo',
    basisValue: 'Giá trị từng lô',
    basisQuantity: 'Số lượng',
    basisWeight: 'Trọng lượng',
    basisHint: 'Cước tàu thường tính theo khối lượng; thuế nhập khẩu tính trên giá trị.',
    kindFreight: 'Cước vận chuyển',
    kindDuty: 'Thuế nhập khẩu',
    kindInsurance: 'Bảo hiểm',
    kindHandling: 'Giao nhận, vận chuyển nội địa',
    kindTax: 'Thuế khâu nhập khẩu',
    kindOther: 'Khác',
    creditAccount: 'Phải trả cho / chi từ',
    capitalise: 'Có tính vào giá vốn hàng không',
    capitaliseHint:
      'Có, với cước tàu, thuế nhập khẩu và phí giao nhận. Không, với thuế GTGT hàng nhập khẩu được khấu trừ — khoản đó được hoàn lại nên chưa bao giờ là chi phí.',
    capitaliseYes: 'Có — cộng vào giá trị hàng',
    capitaliseNo: 'Không — được khấu trừ',
    debitAccount: 'Tài khoản cho phần được khấu trừ',
    chargeDate: 'Ngày phát sinh',
    submit: 'Thêm chi phí này',
    checkFirst: 'Xem trước kết quả',
    previewTitle: 'Khoản này sẽ làm gì',

    shipmentIncomplete: 'Hãy nhập số tham chiếu của lô hàng và ngày hàng về.',
    recorded: (reference) => `Đã tạo lô hàng ${reference}.`,
    amountNotANumber:
      'Nhập số tiền chỉ gồm chữ số, không có dấu phân cách hàng nghìn; phần thập phân (nếu có) ngăn bằng dấu chấm.',
    chargeIncomplete: 'Hãy kiểm tra số tiền, nội dung và các tài khoản.',
    addedToStock: (amount) => `Đã thêm. ${amount} được tính vào giá trị hàng tồn kho.`,
    addedSplit: (toStock, toCogs) =>
      `Đã thêm. ${toStock} được tính vào giá trị hàng còn tồn kho, và ${toCogs} vào giá vốn hàng bán cho phần hàng đã bán.`,
    addedReclaimable:
      'Đã thêm. Không có gì được tính vào giá trị hàng tồn kho, vì khoản này được khấu trừ.',
  },

  stockImport: {
    title: 'Nhập dữ liệu từ bảng tính',
    description:
      'Dán vào đây lịch sử mua hàng bạn vẫn đang giữ. Mỗi dòng sẽ thành một lô hàng với giá riêng, đồng thời bút toán mua hàng cũng được ghi vào sổ.',

    requirementsTitle: 'File cần có gì',
    requirementsHint:
      'Một dòng tiêu đề và bốn cột. Những cột còn lại đều không bắt buộc, và cột nào không nằm trong danh sách này thì được bỏ qua chứ không bị báo lỗi.',
    separatorsNote:
      'Hệ thống đọc được cả dấu tab, dấu phẩy và dấu chấm phẩy — dán thẳng từ Excel vẫn được, mà file xuất ra từ máy dùng dấu phẩy làm dấu thập phân cũng được.',

    colProductCode: 'Mã hàng',
    colProductCodeHint: 'sku, code, product code, mã hàng',
    colDate: 'Ngày nhập',
    colDateHint: 'date, received, arrived, ngày — 10/01/2026 là ngày 10 tháng 1',
    colQuantity: 'Số lượng',
    colQuantityHint: 'quantity, qty, số lượng',
    colCost: 'Thành tiền',
    colCostHint: 'cost, total, amount, thành tiền — giá trị cả lô, không phải đơn giá',
    colNameUnit: 'Tên hàng và đơn vị tính',
    colNameUnitHint: 'Chỉ cần khi mặt hàng chưa có trong hệ thống',
    colCurrency: 'Loại tiền',
    colCurrencyHint: 'Mặc định là đồng tiền ghi sổ',
    colReference: 'Số chứng từ',
    colReferenceHint: 'reference, container, invoice, lot — thông tin hiện trong báo cáo giá vốn',

    yourRows: 'Dữ liệu của bạn',
    yourRowsHint:
      'Chưa có gì được ghi vào sổ cho tới khi bạn xem hết các dòng và bấm nhập. Nếu có một dòng sai thì không dòng nào được nhập — một bộ sổ nhập dở còn tệ hơn là chưa nhập.',
    pasteLabel: 'Dán các dòng vào đây',
    pastePlaceholder:
      'Mã hàng\tTên hàng\tĐơn vị\tNgày\tSố lượng\tThành tiền\tSố chứng từ\nPAV-600\tĐá lát granite 600×600\tm2\t10/01/2026\t1000\t690000000\tCONT-4417',
    pasteHint:
      'Bôi đen vùng dữ liệu trong Excel rồi dán vào đây, kể cả dòng tiêu đề. Nội dung file .csv cũng dùng được.',
    chargeTo: 'Ghi Có tài khoản',
    chargeToHint: 'Nhà cung cấp bạn còn nợ, hoặc tài khoản ngân hàng đã chi tiền.',
    stockAccountHint: 'Áp dụng cho mọi mặt hàng mới mà file này tạo ra.',
    cogsAccountHint: 'Nơi ghi giá vốn khi hàng được xuất sau này.',
    checkButton: 'Kiểm tra dữ liệu',
    checking: 'Đang đọc…',
    importing: 'Đang nhập…',
    importButton: (count) => `Nhập ${count} lô hàng`,
    needAccounts:
      'Bạn cần một tài khoản tài sản cho hàng tồn kho, một tài khoản chi phí cho giá vốn, và một tài khoản để ghi Có. Hãy mở chúng ở',

    separatorTab: 'Phân cách bằng dấu tab — dán thẳng từ Excel.',
    separatorSemicolon:
      'Phân cách bằng dấu chấm phẩy, đúng như Excel xuất ra ở Việt Nam và phần lớn châu Âu.',
    separatorComma: 'Phân cách bằng dấu phẩy.',
    ignoredColumns: (columns) =>
      `Các cột không dùng đến: ${columns}. Không mất gì cả — chúng chỉ không thuộc thông tin của một lô hàng.`,
    missingColumnsInline: (columns) =>
      `Không tìm thấy cột ${columns}. Các dòng bên dưới hiện đúng như hệ thống đã đọc, để bạn thấy tiêu đề nào chưa khớp.`,

    previewCaption: 'Từng dòng, đúng như hệ thống đã đọc',
    importFailed: 'Không có dòng nào được nhập. Hãy sửa những dòng sau rồi thử lại.',
    row: 'Dòng',
    status: 'Trạng thái',
    ready: 'Sẵn sàng',
    newBadge: 'mới',
    fixFirst:
      'Hãy sửa những dòng được đánh dấu ở trên rồi kiểm tra lại. Nhập dữ liệu theo nguyên tắc toàn bộ hoặc không gì cả — hệ thống sẽ không nhập riêng các dòng đúng và bỏ lại phần còn lại.',
    rowProblem: (line, problem) => `Dòng ${line}: ${problem}`,
    pasteRows: 'Hãy dán các dòng vào và chọn tài khoản ghi Có cho các lần nhập hàng.',
    rowsLost: 'Các dòng dữ liệu đã bị mất. Hãy dán lại.',
    noColumn: (columns) =>
      `Tệp này không có cột ${columns}, nên chưa có gì để nhập. Hãy kiểm tra dòng tiêu đề.`,
    rowsNeedFixing: (problems, rows) =>
      `${problems} trên ${rows} dòng cần sửa trước. Chưa có gì được nhập.`,
    readyToImport: (rows, products, readOnly) =>
      `Sẵn sàng nhập ${rows} lô hàng${products > 0 ? `, mở thêm ${products} mặt hàng mới` : ''}${readOnly === 'yes' ? '. Hãy đăng nhập để nhập vào sổ sách của riêng bạn' : '. Chưa có gì được nhập'}.`,
    imported: (lots, products) =>
      `Đã nhập ${lots} lô hàng${products > 0 ? `, mở thêm ${products} mặt hàng mới` : ''}. Mỗi lô cũng đã được ghi sổ.`,
  },
  sales: {
    title: 'Bán hàng',
    description:
      'Mỗi hóa đơn vừa xuất kho vừa ghi giá vốn trong cùng một bút toán, nên hóa đơn nào cũng biết mình lãi bao nhiêu.',
    marginsButton: 'Lãi gộp',

    recentTitle: 'Hóa đơn gần đây',
    recentHint:
      'Tổng tiền hóa đơn tính theo loại tiền ghi trên hóa đơn. Doanh thu, giá vốn và lãi gộp tính theo đồng tiền hạch toán: doanh thu theo tỷ giá ngày lập hóa đơn, giá vốn theo tỷ giá ngày nhập từng lô.',
    tableCaption: 'Hóa đơn, mới nhất trước, kèm lãi gộp',
    invoice: 'Số hóa đơn',
    customer: 'Khách hàng',
    date: 'Ngày',
    due: 'Hạn thanh toán',
    onReceipt: 'Khi nhận hàng',
    invoiced: 'Tổng tiền',
    revenue: 'Doanh thu',
    cost: 'Giá vốn',
    margin: 'Lãi gộp',
    emptyTitle: 'Chưa có hóa đơn nào',
    emptyBody:
      'Hãy lập hóa đơn ở bên dưới. Hệ thống sẽ xuất kho, ghi nhận công nợ phải thu và doanh thu, đồng thời tính giá vốn từ chính các lô đã xuất — tất cả trong một bút toán.',

    newTitle: 'Lập hóa đơn bán hàng',
    newHint:
      'Cả hóa đơn là một bút toán, nên công nợ, doanh thu, thuế và giá vốn không thể lệch nhau. Nếu có dòng nào không đủ hàng, sẽ không có gì được ghi.',
    needSetup:
      'Bạn cần một mặt hàng còn tồn kho, một tài khoản khách hàng (tài sản — mỗi khách một tài khoản chi tiết 131 để theo dõi công nợ riêng) và một tài khoản doanh thu. Hãy thiết lập ở',
    stockLink: 'trang kho hàng',
    andThe: 'và',
    invoiceNumber: 'Số hóa đơn',
    invoiceNumberHint: 'Mỗi số chỉ dùng một lần. Khách hàng thanh toán theo số này.',
    customerAccount: 'Khách hàng',
    customerAccountHint: 'Tài khoản phải thu của khách, hoặc tài khoản tiền nếu bán thu tiền ngay.',
    revenueAccount: 'Tài khoản doanh thu',
    currency: 'Loại tiền trên hóa đơn',
    currencyHint:
      'Hàng xuất khẩu lập hóa đơn bằng tiền của người mua; hệ thống dùng tỷ giá ngày lập hóa đơn.',
    taxCode: 'Thuế',
    noTax: 'Không chịu thuế',
    invoiceDate: 'Ngày hóa đơn',
    dueDate: 'Hạn thanh toán',
    dueDateHint: 'Để trống nếu thanh toán ngay khi nhận hàng. Báo cáo tuổi nợ tính từ ngày này.',
    linesLegend: 'Các dòng hàng',
    product: 'Mặt hàng',
    quantity: (unit) => `Số lượng (${unit})`,
    lineTotal: 'Thành tiền chưa thuế',
    lot: 'Lô hàng',
    byMethod: 'Theo phương pháp tính giá',
    addLine: 'Thêm dòng',
    removeLine: (line) => `Xóa dòng ${line}`,
    lineLabel: (line) => `Dòng ${line}`,
    submit: 'Lập hóa đơn',

    allSales: 'Tất cả hóa đơn',
    linesTitle: 'Các dòng hàng',
    linesHint:
      'Giá bán của từng dòng, giá vốn tính từ các lô, và dòng đó được xuất từ những lô nào.',
    linesCaption: 'Các dòng hóa đơn kèm doanh thu, giá vốn và lãi gộp',
    shippedFrom: 'Xuất từ lô',
    net: 'Cộng tiền hàng',
    tax: 'Tiền thuế GTGT',
    gross: 'Tổng cộng thanh toán',
    viewEntry: 'Bút toán trên sổ nhật ký',
    marginOf: (percent) => `lãi gộp ${percent}`,

    checkForm: 'Hãy điền số hóa đơn, khách hàng, tài khoản doanh thu và ít nhất một dòng hàng.',
    checkLine: (line) => `Dòng ${line}: hãy chọn mặt hàng, nhập số lượng và thành tiền.`,
    tooManyDecimals: (line, places) =>
      places === 0
        ? `Dòng ${line}: mặt hàng này tính theo đơn vị nguyên.`
        : `Dòng ${line}: mặt hàng này chỉ tính đến ${places} chữ số thập phân.`,
    amountNotRepresentable: (line, currency) =>
      `Dòng ${line}: thành tiền có nhiều chữ số thập phân hơn ${currency} cho phép.`,
    raised: (reference, margin) =>
      `Đã lập hóa đơn ${reference}. Hàng đã xuất kho, lãi gộp của hóa đơn là ${margin}.`,
  },

  margins: {
    title: 'Lãi gộp',
    description:
      'Lãi từ hàng đã bán, theo mặt hàng và theo khách hàng. Doanh thu theo tỷ giá ngày lập từng hóa đơn, giá vốn theo tỷ giá ngày nhập từng lô — hai con số duy nhất cộng được với nhau qua nhiều loại tiền.',
    month: 'Tháng',
    previous: 'Tháng trước',
    next: 'Tháng sau',
    revenue: 'Doanh thu',
    cost: 'Giá vốn hàng bán',
    margin: 'Lãi gộp',
    marginPercent: 'Tỷ suất',
    invoices: 'Số hóa đơn',
    byProduct: 'Theo mặt hàng',
    byProductHint:
      'Cước vận chuyển và thuế nhập khẩu về sau khi hàng đã bán được ghi thẳng vào giá vốn. Chúng được tách riêng và tính vào giá vốn: chúng thuộc về mặt hàng, không thuộc riêng hóa đơn nào.',
    byProductCaption: 'Lãi gộp theo mặt hàng, đóng góp lớn nhất trước',
    byCustomer: 'Theo khách hàng',
    byCustomerHint:
      'Cước và thuế về muộn không có trong các số liệu này, vì không phân bổ được cho khách hàng nào — nên giá vốn của hai bảng chênh nhau đúng bằng khoản đó.',
    byCustomerCaption: 'Lãi gộp theo khách hàng, đóng góp lớn nhất trước',
    product: 'Mặt hàng',
    customer: 'Khách hàng',
    sold: 'Đã bán',
    lateCharges: 'Cước, thuế về muộn',
    total: 'Cộng',
    emptyTitle: 'Tháng này chưa bán gì',
    emptyBody: 'Hóa đơn lập ở trang Bán hàng sẽ hiện ở đây, với giá vốn tính từ các lô đã xuất.',
  },

  reconcile: {
    title: 'Đối chiếu kho với sổ cái',
    agrees: 'Sổ kho khớp với sổ cái',
    agreesBody:
      'Mỗi tài khoản hàng tồn kho có số dư đúng bằng giá trị các lô còn hàng. Không có gì được ghi vào tài khoản kho mà không đi kèm nhập hoặc xuất hàng.',
    disagrees: 'Sổ kho và sổ cái đang lệch nhau',
    disagreesBody:
      'Có bút toán ghi thẳng vào tài khoản hàng tồn kho mà không nhập hay xuất hàng nào, nên mọi giá vốn tính từ các lô đều lệch đúng bằng khoản chênh. Các bút toán gây lệch được liệt kê bên dưới; hãy đảo chúng, hoặc ghi nhận nghiệp vụ nhập xuất mà chúng đại diện.',
    caption: 'Tài khoản hàng tồn kho đối chiếu với các lô hàng',
    account: 'Tài khoản',
    products: 'Số mặt hàng',
    ledger: 'Theo sổ cái',
    lots: 'Theo các lô',
    difference: 'Chênh lệch',
    unexplained: 'Ghi sổ mà không nhập xuất hàng',
  },

  stockOutcome: {
    checkProduct: 'Hãy điền mã hàng, tên hàng và đơn vị tính.',
    added: (name) => `Đã thêm ${name}. Bây giờ bạn có thể nhập kho cho mặt hàng này.`,
    plainNumber: 'Hãy nhập một số thông thường, ví dụ 1250 hoặc 24.687.',
    checkQuantityAndAmount: 'Hãy kiểm tra lại số lượng và số tiền.',
    checkQuantity: 'Hãy kiểm tra lại số lượng.',
    tooManyDecimals: (places) =>
      places === 0
        ? 'Mặt hàng này tính theo đơn vị nguyên.'
        : `Mặt hàng này chỉ tính đến ${places} chữ số thập phân. Hãy làm tròn số lượng, hoặc đổi độ chính xác của mặt hàng.`,
    quantityPlain: 'Hãy nhập số lượng dưới dạng một số thông thường.',
    amountPlain: 'Hãy nhập số tiền đã trả dưới dạng một số thông thường.',
    bookedIn: (quantity, unit) =>
      `Đã nhập kho ${quantity} ${unit}. Nghiệp vụ mua hàng cũng đã được ghi sổ.`,
    lotsJoiner: ' rồi ',
    shippedFrom: (lots) => `Đã xuất kho, giá vốn tính từ ${lots}. Giá vốn hàng bán đã được ghi sổ.`,
    shipped: 'Đã xuất kho, và giá vốn hàng bán đã được ghi sổ.',
    chooseReason: 'Hãy chọn lý do xuất hủy.',
    writtenOff: (quantity, unit) => `Đã xuất hủy ${quantity} ${unit}.`,
    writtenOffFrom: (quantity, unit, lots) =>
      `Đã xuất hủy ${quantity} ${unit}, giá vốn tính từ ${lots}.`,
  },
};

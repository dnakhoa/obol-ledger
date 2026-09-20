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
    working: 'Đang xử lý…',
  },

  nav: {
    primary: 'Điều hướng chính',
    overview: 'Tổng quan',
    accounts: 'Tài khoản',
    stock: 'Kho hàng',
    journal: 'Sổ nhật ký',
    reports: 'Báo cáo',
    monthEnd: 'Khóa sổ',
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
  },
};

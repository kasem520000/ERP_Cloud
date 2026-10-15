/**
 * 📈 منطق شاشة «تقارير الخطّ» — الفترةُ كما يحدّدها الخادم، لا كما تُعرض الصفوف.
 *
 * ثلاثُ حقائقَ مقاسةٍ تحكم هذه الشاشة، وكلُّها من `GET /van-sales/reports` نفسه
 * (`VanSalesService.getReports`) فلا تُحسب هنا ثانيةً:
 *
 * 1. **المدى يُطبَّق فعلًا.** الصفوفُ الأربع (أوامرُ التحميل، مستنداتُ البيع، دفعاتُ الإنتاج،
 *    سجلُّ التسعير) ومجاميعُ `periodTotals` وأداءُ المندوبين `repCustodyReport` كلُّها من
 *    استعلاماتٍ على المدى نفسه، بتواريخ **العمل**: ‏`load_date` و`doc_date` و
 *    `production_date`. وسجلُّ التسعير وحده بلا تاريخِ عملٍ في الجدول فيُصفّى بـ`created_at`
 *    — والخادم يقول ذلك في `filterNotes`، والشاشة تعرض نصَّه كما هو لا صياغةً ألطف.
 *    ومرشِّحُ المندوب لا يُطبَّق على الإنتاج ولا على التسعير فليسا منسوبَين إلى مندوب، وهذا
 *    أيضًا من `filterNotes`.
 *
 * 2. **‏`periodTotals` غير `summary`.** الأول مجموعُ الفترة المصفّاة، والثاني أرقامُ المنشأة
 *    الكاملة وأرصدتُها في لحظتها (رصيدُ المستودع الرئيسي ورصيدُ السيارات). والرصيدُ ليس
 *    تدفّقًا: «ما في السيارة الآن» لا يُجمع مع «ما بِيع في مايو». فالشاشة تعرضهما في
 *    بطاقتين منفصلتين بعنوانين منفصلين، وتقول صراحةً إنّهما ليسا الشيء نفسه.
 *
 * 3. **القصُّ يُقال.** لكلّ قائمةٍ سقفُ صفوفٍ من الخادم (`rowCap`، و`LIMIT` السقف+١ في
 *    الاستعلام) و`truncated` لكلّ قائمة. والعدادات والمجاميع من `COUNT(*)`/`SUM` على الجدول
 *    لا من طول المصفوفة، فالسقفُ يُنقص **المعروض** ولا يُنقص **المحسوب** — ولهذا تعرض الشاشة
 *    بجانب كلّ قائمةٍ مقصوصةٍ مجموعَ صفوفها المعروضة ومجموعَ الفترة، فيرى المحاسبُ الفرقَ
 *    بعينه ولا يظنّ أنّ المعروض هو كلّ شيء.
 *
 * وما **ليس** هنا: إنشاءُ مستندٍ أو تحصيلٌ أو إقفالُ عهدة (في `/sales` و`/collection` و
 * `/custody`)، والأستاذُ وتفصيلُ القيود والتقاريرُ المحاسبية الرسمية (في لوحة الموظفين،
 * وتُفتح بتسليم جلسة)، وحسابُ عمولةِ المندوب (الرواتب في staff). فهذه الشاشة **تقرأ**
 * محرّك التقارير نفسه ولا تبني محركًا موازيًا: لا رقمَ فيها إلا من حمولة الخادم.
 */
import { Decimal } from 'decimal.js';

import { numberText } from './lookups';

/** القراءةُ بصلاحية رؤية الخطّ — وهي ما يفرضه الخادم على المسار (`@RequiresPermission`). */
export const REPORTS_PERMISSION = 'van_sales.view';

/** رمزا رفض المدى كما يرفعهما الخادم (‏422) — والفحصُ المسبق هنا مرآةٌ لهما لا بديلًا منهما. */
export const REPORT_DATE_INVALID_CODE = 'VAN_REPORT_DATE_INVALID';
export const REPORT_RANGE_INVERTED_CODE = 'VAN_REPORT_RANGE_INVERTED';

/**
 * نصوصُ الفحص المسبق. القاعدةُ نفسها التي في `reportDateOrThrow`/`parseReportRange`:
 * الصيغة `YYYY-MM-DD`، والتاريخُ موجودٌ فعلًا (فـ`2026-02-30` يُرفض)، والبدايةُ لا تتأخّر عن
 * النهاية. والخادم يبقى الحكم: فإن وصل ٤٢٢ عُرض `detail` الخادم كما هو.
 */
export const REPORTS_MESSAGES = {
  dateInvalidFormat: (label: string, text: string) =>
    `${label} غير مقروءة: «${text}» — المطلوب سنة-شهر-يوم (YYYY-MM-DD)`,
  dateNotReal: (label: string, text: string) => `${label} تاريخٌ غير موجود: «${text}»`,
  rangeInverted: (from: string, to: string) =>
    `بدايةُ الفترة (${from}) بعد نهايتها (${to}) — فلا صفوف في هذا المدى، والتصحيحُ في التاريخ لا في التقرير`,
  pickPeriod: 'اختر فترةً ثمّ اعرض التقرير — فالشاشة لا تُحمّل كلّ السجلّ بلا طلب.',
  loaded: 'رجع التقريرُ من الخادم.',
} as const;

export const FROM_LABEL = 'بدايةُ الفترة';
export const TO_LABEL = 'نهايةُ الفترة';

/** أسماءُ القوائم الأربع كما يُشار إليها في التنبيهات — ومفاتيحُها مفاتيحُ الخادم. */
export const REPORT_LIST_LABELS = {
  transfersReport: 'أوامر التحميل والعهد',
  collectionsReport: 'مستندات البيع والتحصيل',
  productionReport: 'دفعات الإنتاج',
  customerPriceAuditReport: 'سجلّ تسعير العملاء',
} as const;

export type ReportListKey = keyof typeof REPORT_LIST_LABELS;

export const REPORT_LIST_KEYS: readonly ReportListKey[] = [
  'transfersReport',
  'collectionsReport',
  'productionReport',
  'customerPriceAuditReport',
];

/** صفٌّ من صفوف الخادم — كلُّ الأرقام نصوصٌ (‏`toFixed`) فلا يفقد المتصفحُ دقّةً ولا يخترعها. */
export type ReportRow = Record<string, string | number | boolean | null>;

export type ReportsFilters = {
  salesmanId: string | null;
  fromDate: string | null;
  toDate: string | null;
};

export type ReportsTruncated = Record<ReportListKey, boolean>;

export type RepCustodyRow = {
  salesmanId?: string | null;
  salesmanName?: string | null;
  loadedKg?: string | null;
  soldKg?: string | null;
  bonusKg?: string | null;
  returnedKg?: string | null;
  damagedKg?: string | null;
  shortageKg?: string | null;
  shortageSar?: string | null;
  custodyRemainingKg?: string | null;
  revenueSar?: string | null;
  collectedSar?: string | null;
  creditDebtSar?: string | null;
  netProfitSar?: string | null;
  pendingClosings?: number | null;
};

/**
 * حمولةُ التقرير. كلّ حقلٍ اختياريّ لأنّ الشاشة تعرض ما وصلها كما هو: فلو أرجع خادمٌ قديمٌ
 * حمولةً بلا `periodTotals` قيل «لم يرجع الخادم هذا الحقل» بدل أن يُخترع صفرٌ مكانه.
 */
export type ReportsPayload = {
  generatedAt?: string | null;
  filters?: Partial<ReportsFilters> | null;
  filterNotes?: readonly string[] | null;
  rowCap?: number | null;
  truncated?: Partial<ReportsTruncated> | null;
  policy?: Record<string, unknown> | null;
  summary?: Record<string, string | number | boolean> | null;
  periodTotals?: Record<string, string | number> | null;
  repCustodyReport?: readonly RepCustodyRow[] | null;
  transfersReport?: readonly ReportRow[] | null;
  collectionsReport?: readonly ReportRow[] | null;
  productionReport?: readonly ReportRow[] | null;
  customerPriceAuditReport?: readonly ReportRow[] | null;
};

export type ReportRangeDraft = {
  fromDate: string;
  toDate: string;
  salesmanId: string;
};

export function emptyRangeDraft(): ReportRangeDraft {
  return { fromDate: '', toDate: '', salesmanId: '' };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * هل النصُّ تاريخٌ ميلاديٌّ موجود؟ الصيغةُ ثمّ الوجود — والقاعدةُ قاعدةُ الخادم: يُبنى التاريخ
 * بمنتصف الليل UTC ويُقارن بإعادة طباعته، فـ`2026-02-30` و`2026-13-01` يُرفضان وإن قبلتهما
 * بعضُ الحقول في المتصفح.
 */
export function isCalendarDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

export type Verdict = { blocked: string[]; warnings: string[] };

/**
 * الحكمُ قبل الإرسال. `blocked` هنا لأنّ القاعدةَ **نسخةٌ حرفية** من قاعدة الخادم (الصيغة
 * والوجود والترتيب) — فلو أُرسِل الطلب لرُدّ ٤٢٢ بالنصّ نفسه. وأمّا ما لا يستطيع المتصفح
 * حسابه كحساب الخادم (هل هذا المندوب من هذه المنشأة؟) فلا يُحكم عليه هنا ويُبقي الحكمَ
 * للخادم (‏404 «المندوب غير موجود»).
 */
export function rangeVerdict(draft: ReportRangeDraft): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const from = draft.fromDate.trim();
  const to = draft.toDate.trim();

  if (from.length > 0 && !isCalendarDate(from)) {
    blocked.push(
      DATE_PATTERN.test(from)
        ? REPORTS_MESSAGES.dateNotReal(FROM_LABEL, from)
        : REPORTS_MESSAGES.dateInvalidFormat(FROM_LABEL, from),
    );
  }
  if (to.length > 0 && !isCalendarDate(to)) {
    blocked.push(
      DATE_PATTERN.test(to)
        ? REPORTS_MESSAGES.dateNotReal(TO_LABEL, to)
        : REPORTS_MESSAGES.dateInvalidFormat(TO_LABEL, to),
    );
  }
  if (blocked.length === 0 && from.length > 0 && to.length > 0 && from > to) {
    blocked.push(REPORTS_MESSAGES.rangeInverted(from, to));
  }
  if (blocked.length === 0) {
    if (from.length === 0 && to.length === 0) {
      warnings.push(
        'بلا مدىً زمنيّ: التقرير كلّ السجلّ لا «اليوم»، وقد يبلغ سقفَ الصفوف في منشأةٍ كبيرة — والقصُّ يُقال ولا يُخفى.',
      );
    } else if (from.length === 0) {
      warnings.push(`مدىً مفتوحُ البداية: كلّ السجلّ حتى ${to}.`);
    } else if (to.length === 0) {
      warnings.push(`مدىً مفتوحُ النهاية: كلّ السجلّ من ${from} حتى آخر سجلّ.`);
    }
  }
  return { blocked, warnings };
}

/** نصُّ الاستعلام — الحقولُ الفارغة لا تُرسل، فالخادم يفرّق بين «بلا مرشِّح» و«مرشِّحٌ فارغ». */
export function reportsQuery(draft: ReportRangeDraft): string {
  const params = new URLSearchParams();
  const from = draft.fromDate.trim();
  const to = draft.toDate.trim();
  const salesmanId = draft.salesmanId.trim();
  if (from.length > 0) params.set('fromDate', from);
  if (to.length > 0) params.set('toDate', to);
  if (salesmanId.length > 0) params.set('salesmanId', salesmanId);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

/** أولُ الشهر الجاري وآخرُه بتقويم المتصفح — اختصارٌ للفترة الشائعة، لا افتراضٌ عن الخادم. */
export function currentMonthDraft(now: Date = new Date()): ReportRangeDraft {
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    fromDate: `${year}-${pad(month + 1)}-01`,
    toDate: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
    salesmanId: '',
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** ما طُبِّق فعلًا كما قاله الخادم — لا ما كتبه المستخدم في الحقل. */
export function filterHeadline(payload: ReportsPayload | null): string {
  const filters = payload?.filters ?? null;
  if (!filters) return 'لم يرجع الخادم ما طُبِّق من المرشِّحات.';
  const from = text(filters.fromDate);
  const to = text(filters.toDate);
  const salesmanId = text(filters.salesmanId);
  const period =
    from.length > 0 && to.length > 0
      ? `من ${from} إلى ${to}`
      : from.length > 0
        ? `من ${from} حتى آخر سجلّ`
        : to.length > 0
          ? `من أول سجلّ حتى ${to}`
          : 'كلّ السجلّ (بلا مدىً زمنيّ)';
  const rep = salesmanId.length > 0 ? ' · مندوبٌ واحد' : ' · كلّ المناديب';
  return `${period}${rep}`;
}

export type PeriodCard = {
  readonly key: string;
  readonly labelAr: string;
  /** سطرٌ تحت الرقم يقول من أين جاء — فلا يُقرأ رقمُ فترةٍ كرصيدٍ ولا العكس. */
  readonly hintAr?: string;
};

export type PeriodCardGroup = {
  readonly key: string;
  readonly labelAr: string;
  readonly noteAr: string;
  readonly cards: readonly PeriodCard[];
};

/**
 * بطاقاتُ `periodTotals` بمفاتيح الخادم. والمجموعةُ الثالثة عدّاداتٌ (‏`COUNT(*)`) لا مال —
 * ومنها `anomalyCount` الذي يعدّ مستنداتٍ عَلَمُ شذوذِ البونص فيها مرفوع.
 */
export const PERIOD_CARD_GROUPS: readonly PeriodCardGroup[] = [
  {
    key: 'money',
    labelAr: 'مالُ الفترة',
    noteAr: 'مجموعُ المستندات المصفّاة بالمدى — من SUM على الجدول، لا من جمع الصفوف المعروضة.',
    cards: [
      { key: 'revenueSar', labelAr: 'إيرادُ الفترة' },
      { key: 'zatcaSalesSar', labelAr: 'فواتير ضريبية (ZATCA)' },
      { key: 'internalSalesSar', labelAr: 'إشعارات تسليم داخلية' },
      { key: 'collectedCashSar', labelAr: 'المحصَّل' },
      { key: 'creditReceivablesSar', labelAr: 'الذممُ غير المحصّلة' },
      { key: 'netProfitSar', labelAr: 'صافي الربح' },
      { key: 'shortageSar', labelAr: 'قيمةُ النقص المُحمّل' },
      { key: 'productionCostSar', labelAr: 'تكلفةُ الإنتاج' },
    ],
  },
  {
    key: 'quantity',
    labelAr: 'كميّاتُ الفترة',
    noteAr: 'كيلوجراماتُ المدى نفسه: ما أُنتج وما حُمِّل وما بِيع وما رجع وما تَلِف.',
    cards: [
      { key: 'producedKg', labelAr: 'المُنتَج' },
      { key: 'scrapKg', labelAr: 'الفاقد (هالك)' },
      { key: 'loadedKg', labelAr: 'المُحمَّل' },
      { key: 'soldKg', labelAr: 'المبيع' },
      { key: 'bonusKg', labelAr: 'المجاني (بونص)' },
      { key: 'returnedKg', labelAr: 'المرتجع' },
      { key: 'damagedKg', labelAr: 'التالف' },
      { key: 'shortageKg', labelAr: 'النقص' },
    ],
  },
  {
    key: 'counts',
    labelAr: 'عداداتُ الفترة',
    noteAr: '‏COUNT(*) على المدى — فلا يُنقصها سقفُ الصفوف المعروضة.',
    cards: [
      { key: 'loadOrderCount', labelAr: 'أوامر التحميل' },
      { key: 'documentCount', labelAr: 'مستندات البيع' },
      { key: 'productionBatchCount', labelAr: 'دفعات الإنتاج' },
      { key: 'anomalyCount', labelAr: 'شذوذُ البونص' },
    ],
  },
];

/** بطاقةٌ واحدة: قيمةُ الخادم كما هي، أو قولٌ صريحٌ بأنّه لم يرجعها. */
export function cardValue(payload: ReportsPayload | null, key: string): string {
  const value = payload?.periodTotals?.[key];
  if (value === undefined || value === null) return '—';
  return typeof value === 'number' ? String(value) : numberText(value);
}

export function hasPeriodTotals(payload: ReportsPayload | null): boolean {
  return Boolean(payload?.periodTotals && Object.keys(payload.periodTotals).length > 0);
}

/**
 * أرصدةُ اللحظة من `summary` — وهي **غير** مجاميع الفترة، وتُعرض بعنوانها كي لا تُجمع معها.
 * مفاتيحُها مفاتيحُ الخادم في `dashboard().summary`.
 */
export const BALANCE_CARDS: readonly PeriodCard[] = [
  {
    key: 'mainWarehouseBalanceKg',
    labelAr: 'رصيدُ المستودع الرئيسي',
    hintAr: 'رصيدٌ الآن — ليس تدفّق الفترة.',
  },
  {
    key: 'vanWarehousesBalanceKg',
    labelAr: 'رصيدُ سيارات التوزيع',
    hintAr: 'رصيدٌ الآن — ليس تدفّق الفترة.',
  },
  {
    key: 'totalRevenueSar',
    labelAr: 'إيرادُ المنشأة (كلّ السجلّ)',
    hintAr: 'من summary: كلّ المستندات لا المصفّاة.',
  },
  {
    key: 'totalCreditReceivablesSar',
    labelAr: 'ذممُ المنشأة (كلّ السجلّ)',
    hintAr: 'من summary: كلّ المستندات لا المصفّاة.',
  },
];

export function summaryValue(payload: ReportsPayload | null, key: string): string {
  const value = payload?.summary?.[key];
  if (value === undefined || value === null || typeof value === 'boolean') return '—';
  return typeof value === 'number' ? String(value) : numberText(value);
}

/** جملةٌ صريحةٌ تمنع الخلطَ بين البطاقتين حين يختلفان — وهذا هو الحالُ المعتاد لا الشاذّ. */
export function periodVersusLifetimeNote(payload: ReportsPayload | null): string | null {
  const periodRevenue = payload?.periodTotals?.revenueSar;
  const lifetimeRevenue = payload?.summary?.totalRevenueSar;
  if (typeof periodRevenue !== 'string' || typeof lifetimeRevenue !== 'string') return null;
  if (new Decimal(periodRevenue).equals(new Decimal(lifetimeRevenue))) {
    return 'إيرادُ الفترة = إيرادُ المنشأة كلّها: فالمدى المُصفّى يغطّي كلّ السجلّ (أو لم يُصفَّ شيء).';
  }
  return `إيرادُ الفترة ${numberText(periodRevenue)} وإيرادُ المنشأة كلّها ${numberText(
    lifetimeRevenue,
  )} — وليسا رقمين لشيءٍ واحد: الأول تدفّقُ المدى المصفّى والثاني كلّ السجلّ، وأرصدةُ اللحظة ليست أيًّا منهما.`;
}

export type ReportColumn = {
  readonly key: string;
  readonly labelAr: string;
  /** رقمٌ يُقرأ من اليسار — فالمحاذاةُ لليمين تُفسد مقارنةَ الأعمدة. */
  readonly numeric?: boolean;
  /** مُعرِّفٌ لاتينيّ يُعرض LTR كي لا ينقلبَ داخل جملةٍ عربية. */
  readonly ltr?: boolean;
};

export const TRANSFER_COLUMNS: readonly ReportColumn[] = [
  { key: 'loadOrderNumber', labelAr: 'أمر التحميل', ltr: true },
  { key: 'loadDate', labelAr: 'تاريخ التحميل', ltr: true },
  { key: 'salesmanName', labelAr: 'المندوب' },
  { key: 'productionBatchNo', labelAr: 'دفعة الإنتاج', ltr: true },
  { key: 'loadedQty', labelAr: 'المُحمَّل', numeric: true },
  { key: 'soldQty', labelAr: 'المبيع', numeric: true },
  { key: 'bonusQty', labelAr: 'المجاني', numeric: true },
  { key: 'returnedQty', labelAr: 'المرتجع', numeric: true },
  { key: 'damagedQty', labelAr: 'التالف', numeric: true },
  { key: 'shortageQty', labelAr: 'النقص', numeric: true },
  { key: 'shortageValue', labelAr: 'قيمة النقص', numeric: true },
  { key: 'remainingQty', labelAr: 'المتبقي في العهدة', numeric: true },
  { key: 'status', labelAr: 'الحالة' },
  { key: 'shortagePolicyStatus', labelAr: 'سياسة النقص' },
];

export const COLLECTION_COLUMNS: readonly ReportColumn[] = [
  { key: 'documentNumber', labelAr: 'المستند', ltr: true },
  { key: 'docDate', labelAr: 'التاريخ', ltr: true },
  { key: 'salesmanName', labelAr: 'المندوب' },
  { key: 'customerName', labelAr: 'العميل' },
  { key: 'paymentMethod', labelAr: 'طريقة الدفع' },
  { key: 'grandTotal', labelAr: 'الإجمالي', numeric: true },
  { key: 'paidAmount', labelAr: 'المدفوع', numeric: true },
  { key: 'outstandingBalance', labelAr: 'المتبقي', numeric: true },
  { key: 'salesInvoiceId', labelAr: 'الفاتورة الرسمية', ltr: true },
  { key: 'receiptVoucherId', labelAr: 'سند القبض', ltr: true },
];

export const PRODUCTION_COLUMNS: readonly ReportColumn[] = [
  { key: 'batchNo', labelAr: 'الدفعة', ltr: true },
  { key: 'productionDate', labelAr: 'تاريخ الإنتاج', ltr: true },
  { key: 'itemName', labelAr: 'الصنف' },
  { key: 'producedQty', labelAr: 'المُنتَج', numeric: true },
  { key: 'scrapQty', labelAr: 'الفاقد', numeric: true },
  { key: 'scrapValue', labelAr: 'قيمة الفاقد', numeric: true },
  { key: 'unitCost', labelAr: 'تكلفة الوحدة', numeric: true },
  { key: 'totalCost', labelAr: 'التكلفة', numeric: true },
  { key: 'costBasis', labelAr: 'أساس التكلفة' },
  { key: 'status', labelAr: 'الحالة' },
];

export const PRICE_COLUMNS: readonly ReportColumn[] = [
  { key: 'partyName', labelAr: 'العميل' },
  { key: 'itemName', labelAr: 'الصنف' },
  { key: 'previousUnitPrice', labelAr: 'السعر السابق', numeric: true },
  { key: 'newUnitPrice', labelAr: 'السعر الجديد', numeric: true },
  { key: 'maxBonusPct', labelAr: 'سقف البونص ٪', numeric: true },
  { key: 'maxDiscountPct', labelAr: 'سقف الخصم ٪', numeric: true },
  { key: 'lockPrice', labelAr: 'تثبيت السعر' },
  { key: 'effectiveFrom', labelAr: 'ساري من', ltr: true },
  { key: 'changeReason', labelAr: 'سبب التغيير' },
  { key: 'changedByLabel', labelAr: 'مَن غيّره' },
  { key: 'createdAt', labelAr: 'سُجّل في', ltr: true },
];

export const REP_COLUMNS: readonly ReportColumn[] = [
  { key: 'salesmanName', labelAr: 'المندوب' },
  { key: 'loadedKg', labelAr: 'المُحمَّل', numeric: true },
  { key: 'soldKg', labelAr: 'المبيع', numeric: true },
  { key: 'bonusKg', labelAr: 'المجاني', numeric: true },
  { key: 'returnedKg', labelAr: 'المرتجع', numeric: true },
  { key: 'damagedKg', labelAr: 'التالف', numeric: true },
  { key: 'shortageKg', labelAr: 'النقص', numeric: true },
  { key: 'custodyRemainingKg', labelAr: 'المتبقي في العهدة', numeric: true },
  { key: 'revenueSar', labelAr: 'الإيراد', numeric: true },
  { key: 'collectedSar', labelAr: 'المحصَّل', numeric: true },
  { key: 'creditDebtSar', labelAr: 'الذمة', numeric: true },
  { key: 'netProfitSar', labelAr: 'الربح', numeric: true },
  { key: 'pendingClosings', labelAr: 'إقفالات معلّقة', numeric: true },
];

/** خليةٌ كما رجعت: المنطقيّ «نعم/لا»، والفارغ «—»، والرقمُ بصيغته المشتركة، والنصُّ كما هو. */
export function cellText(row: ReportRow | RepCustodyRow | null, column: ReportColumn): string {
  const value = row ? (row as Record<string, unknown>)[column.key] : null;
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return column.numeric ? numberText(value) : value;
  // ما ليس نصًّا ولا رقمًا ولا منطقيًّا (كائنٌ أو مصفوفة) لا يُعرض: فـ«[object Object]» كذبٌ مقروء.
  return '—';
}

function decimalOrZero(value: unknown): Decimal {
  if (typeof value === 'number') return new Decimal(value);
  if (typeof value !== 'string' || value.trim().length === 0) return new Decimal(0);
  try {
    const parsed = new Decimal(value.trim());
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    // رقمٌ لا يُقرأ لا يُصفر بصمتٍ في المجموع: يُعرض كما هو في الجدول ويُستثنى من جمع المتصفح.
    return new Decimal(0);
  }
}

/** مجموعُ الصفوف **المعروضة** — يُعرض بجانب مجموع الفترة حين تُقصّ القائمة، فيُرى الفرق. */
export function listedSums(payload: ReportsPayload | null): {
  collectionsOutstandingSar: string;
  collectionsGrandSar: string;
  transfersLoadedKg: string;
  transfersRemainingKg: string;
  productionProducedKg: string;
} {
  const collections = payload?.collectionsReport ?? [];
  const transfers = payload?.transfersReport ?? [];
  const production = payload?.productionReport ?? [];
  let outstanding = new Decimal(0);
  let grand = new Decimal(0);
  for (const row of collections) {
    outstanding = outstanding.plus(decimalOrZero(row.outstandingBalance));
    grand = grand.plus(decimalOrZero(row.grandTotal));
  }
  let loaded = new Decimal(0);
  let remaining = new Decimal(0);
  for (const row of transfers) {
    loaded = loaded.plus(decimalOrZero(row.loadedQty));
    remaining = remaining.plus(decimalOrZero(row.remainingQty));
  }
  let produced = new Decimal(0);
  for (const row of production) produced = produced.plus(decimalOrZero(row.producedQty));
  return {
    collectionsOutstandingSar: outstanding.toFixed(2),
    collectionsGrandSar: grand.toFixed(2),
    transfersLoadedKg: loaded.toFixed(2),
    transfersRemainingKg: remaining.toFixed(2),
    productionProducedKg: produced.toFixed(2),
  };
}

function listLength(payload: ReportsPayload | null, key: ReportListKey): number {
  return payload?.[key]?.length ?? 0;
}

/**
 * تنبيهُ القصّ لكلّ قائمةٍ بلغت السقف — ويقول معها إنّ العدّ والجمع لم ينقصا، فالقصُّ في
 * المعروض. والسقفُ من `rowCap` الخادم؛ وإن لم يقله الخادم قيل ذلك ولم يُفترض رقم.
 */
export function truncationNotes(payload: ReportsPayload | null): string[] {
  const truncated = payload?.truncated ?? null;
  if (!truncated) return [];
  const cap = payload?.rowCap;
  const notes: string[] = [];
  for (const key of REPORT_LIST_KEYS) {
    if (truncated[key] !== true) continue;
    const shown = listLength(payload, key);
    const counted =
      key === 'collectionsReport'
        ? payload?.periodTotals?.documentCount
        : key === 'transfersReport'
          ? payload?.periodTotals?.loadOrderCount
          : key === 'productionReport'
            ? payload?.periodTotals?.productionBatchCount
            : undefined;
    const countedText =
      typeof counted === 'number' ? ` والعدُّ في الجدول ${counted}` : ' والعدُّ في الجدول غير مُعاد';
    notes.push(
      `${REPORT_LIST_LABELS[key]}: عُرض ${shown} صفًّا${
        typeof cap === 'number' ? ` (سقفُ الخادم ${cap})` : ' (سقفُ الخادم غير مُعاد)'
      }${countedText} — فالقصُّ في المعروض لا في المحسوب، والمجاميعُ من SUM/COUNT على الجدول.`,
    );
  }
  return notes;
}

export function isAnyListTruncated(payload: ReportsPayload | null): boolean {
  return truncationNotes(payload).length > 0;
}

/** سطرُ المندوب في جدول الأداء — اسمُه ثمّ أرقامُه كما رجعت، بلا ترتيبٍ مخترع. */
export function repHeadline(row: RepCustodyRow): string {
  const name = text(row.salesmanName ?? null) || 'مندوبٌ بلا اسم';
  const custody = text(row.custodyRemainingKg ?? null);
  const debt = text(row.creditDebtSar ?? null);
  const parts = [`المتبقي في عهدته ${custody.length > 0 ? numberText(custody) : '—'} كجم`];
  if (debt.length > 0) parts.push(`وذمّتُه ${numberText(debt)} ريال`);
  return `${name} — ${parts.join(' ')}`;
}

/**
 * تحذيراتُ الشاشة. كلّها ممّا **يقرّره الخادم** أو ممّا تُظهره حمولتُه؛ ولا حكمَ «محظور» هنا
 * إلا فحصُ المدى المسبق (وهو مرآةُ قاعدة الخادم) — فالتقريرُ قراءة، والقراءةُ لا تُحظر.
 */
export function reportVerdicts(payload: ReportsPayload | null): Verdict {
  const warnings: string[] = [];
  for (const note of payload?.filterNotes ?? []) {
    if (typeof note === 'string' && note.trim().length > 0) warnings.push(note.trim());
  }
  warnings.push(...truncationNotes(payload));

  const totals = payload?.periodTotals ?? null;
  const anomalies = typeof totals?.anomalyCount === 'number' ? totals.anomalyCount : 0;
  if (anomalies > 0) {
    warnings.push(
      `${anomalies} مستندًا في الفترة عَلَمُ شذوذِ البونص فيها مرفوع — يُراجع قبل اعتماد الفترة، والحكمُ للسياسة لا للشاشة.`,
    );
  }
  const receivables = decimalOrZero(totals?.creditReceivablesSar);
  if (receivables.greaterThan(0)) {
    warnings.push(
      `ذممُ الفترة ${receivables.toFixed(2)} ريال لم تُحصّل — والتحصيلُ في شاشة التحصيل بسندٍ رسمي، لا هنا.`,
    );
  }
  const shortageValue = decimalOrZero(totals?.shortageSar);
  if (shortageValue.greaterThan(0)) {
    warnings.push(
      `قيمةُ النقص في الفترة ${shortageValue.toFixed(2)} ريال — وتحميلُها على مديونية موظفٍ يحتاج اعتمادَ الحالة (salaryDeductionApproved) وحسابَ مقابلٍ مضبوطًا، والتقريرُ لا يُنشئ قيدًا ولا يُحمِّل أحدًا.`, 
    );
  }
  const lifetime = periodVersusLifetimeNote(payload);
  if (lifetime) warnings.push(lifetime);
  return { blocked: [], warnings };
}

/** متى وُلِّد التقرير — من الخادم، وبصيغةٍ تُقرأ في سطرٍ واحد. */
export function generatedAtText(payload: ReportsPayload | null): string | null {
  const stamp = payload?.generatedAt;
  if (typeof stamp !== 'string' || stamp.trim().length === 0) return null;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return stamp;
  return parsed.toLocaleString('ar', { hour12: false });
}

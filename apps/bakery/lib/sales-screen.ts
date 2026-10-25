import { Decimal } from 'decimal.js';

import type { DashboardWindows } from './dashboard-windows';

/**
 * 🧾 منطق شاشة «فواتير الخطّ» النقيّ — لا React هنا ولا شبكة، فكلّ حكمٍ يُقاس.
 *
 * ثلاث قواعد أمانة تحكم هذا الملفّ (وهي نفسها في `distribution-screen.ts` و`custody-screen.ts`):
 *
 *   1. **نصوص الرفض نصوصُ الخادم حرفاً.** ما في `SALES_MESSAGES` منقولٌ من
 *      `apps/api/src/modules/van-sales/van-sales.service.ts` (`createDocument` و`createReturnDocument`)
 *      ومن `van-sales.controller.ts` (بوابة التجاوز)، وتقيسه اختبارات الـAPI من طرفه. فالشاشة
 *      تقول قبل الضغط ما سيقوله الخادم بعده، ولا تخترع صياغةً ألطف.
 *   2. **ما لا يستطيع العميل حسابه حسْبَ الخادم لا يُقال حظرًا بل تحذيرًا.** لوحتُ
 *      `GET /van-sales/dashboard` نافذةٌ محدودة: أحدث ٦٠ أمر تحميل وأحدث ١٢٠ مستندًا
 *      (‏`ORDER BY created_at DESC LIMIT …`)، والخادم يجمع ما هو أوسع (كلّ المستندات المعلّقة
 *      على أمر التحميل، وكلّ مرتجعات المستند). فالحكم المبنيّ على النافذة **تحذير** يُقال
 *      معه «والحكم النهائي للخادم»، لا حظرٌ يمنع بيعاً صحيحاً. والحظر فقط لما يطابق حسابه
 *      حسابَ الخادم: خانةٌ فارغة، كمية ≤ ٠، أمرٌ مُصفّى، عهدةٌ لم يُؤكَّد استلامها، بونص بلا
 *      سبب، إشعارٌ داخليّ بلا سياسة، تجاوزٌ بلا صلاحية.
 *   3. **لا رقمَ مختلَع.** المتبقي على فاتورةٍ (`total − paidAmount`) يُحسب بـ`decimal.js` للعرض
 *      ويُسمّى محسوبًا؛ ومجاميع اليوم من `summary` الذي حسبه الخادم، لا من جمع صفوف النافذة.
 *
 * وما **ليس** هنا: الإيصال الحراريّ ٨٠مم (بقي في `apps/staff` — ومُصيِّر مستند البيع الرسميّ
 * بنسختيه مشترك في `@erp/web-van/document-print`)، والأستاذ وتفصيل القيود وأرصدة الصناديق
 * (‏`apps/staff`)، وتسعير العملاء وسياسات البونص (تُقرأ من اللوحة كما كتبها الخادم ولا
 * تُعاد كتابتها هنا).
 */

/** سياسة المنشأة كما يعيدها `dashboard.policy`. */
export type SalesPolicy = {
  allowInternalDeliveryWithoutTax: boolean;
  preventSelfApproval: boolean;
  shortageValuationBasis: string;
  /**
   * 🧾 هويّةُ البائع للفاتورة الضريبية كما يقولها الخادم — و`refusalDetail` هي **جملتُه
   * حرفًا** (‏`resolveZatcaSellerInTx` في `van-sales.service.ts`) فلا تُبنى هنا نسخةٌ ثانيةٌ
   * منها تتباعد مع أوّل تعديل. واختياريٌّ لأنّ حمولةً من خادمٍ أقدم لا تحمله، وعندها يبقى
   * الحكمُ للخادم وحده (فإخفاءُ الزرّ ليس ضبطًا).
   */
  zatcaSeller?: {
    ready: boolean;
    missingFields: readonly string[];
    refusalDetail: string | null;
  } | null;
};

/** جاهزية ملف الترحيل للفرع — منها يعرف المحاسب هل تُرحَّل المستندات تلقائيًّا. */
export type PostingReadiness = {
  branchId: string | null;
  salesInvoice: boolean;
  stockTransfer: boolean;
  receiptVoucher: boolean;
  message: string | null;
};

/**
 * مجاميع اليوم كما حسبها الخادم (لا من جمع صفوف النافذة).
 *
 * ‏**وكلُّ أرقام المال فيها صافيةٌ من المرتجعات**: ‏`totalZatcaSalesSar` و
 * `totalInternalSalesSar` و`totalRevenueSar` و`totalCreditReceivablesSar` و
 * `totalNetProfitSar` — وأطرافُ المعادلة معروضةٌ بجانبها (`totalSalesGrossSar` و
 * `totalReturnsSar` و`totalReturnsVatSar`) فلا يُعرض رقمٌ صافٍ ابتلع مرتجعاتٍ بلا أثر.
 * والمعالجةُ في الخادم (`VAN_MONEY_SQL`) ومرجعُها قيودُ المرتجع الرسمية.
 */
export type SalesSummary = {
  totalZatcaSalesSar: string;
  totalInternalSalesSar: string;
  totalRevenueSar: string;
  totalSalesGrossSar: string;
  totalReturnsSar: string;
  totalReturnsVatSar: string;
  returnDocumentCount: number;
  /** مرتجعاتٌ إشعارُها الدائن غير مُرحَّل فتكلفتُها مجهولة ⇒ لم يُخصم لها أثرٌ في الربح. */
  returnsWithoutCostCount: number;
  totalSoldKg: string;
  totalBonusKg: string;
  totalCollectedCashSar: string;
  totalCreditReceivablesSar: string;
  totalNetProfitSar: string;
  anomalyCount: number;
};

/** مستند بيعٍ أو مرتجع من `dashboard.documents` — الحقول التي تقرأها هذه الشاشة. */
export type DocumentRow = {
  id: string;
  number: string;
  docDate: string;
  createdAt: string;
  documentKind: string;
  referenceDocumentId: string | null;
  invoiceMode: string;
  taxPolicyStatus: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  paymentMethod: string;
  productionBatchNo: string;
  loadOrderId: string | null;
  salesInvoiceId: string | null;
  receiptVoucherId: string | null;
  salesmanId: string | null;
  salesmanName: string;
  partyId: string | null;
  customerName: string;
  customerTaxNo: string;
  itemId: string | null;
  itemName: string;
  soldQty: string;
  bonusQty: string;
  bonusReason: string;
  unitPrice: string;
  discountAmount: string;
  discountReason: string;
  subtotal: string;
  taxRate: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  unitCost: string;
  netProfit: string;
  customerBonusConfirmed: boolean;
  customerConfirmationCode: string;
  bonusAnomaly: boolean;
  anomalyReason: string;
  qrPayload: string;
  notes: string;
};

/** أمر تحميل من `dashboard.loadOrders` — ما تحتاجه الشاشة لتبيع من عهدةٍ قائمة. */
export type SaleLoadOrderRow = {
  id: string;
  number: string;
  loadDate: string;
  status: string;
  productionBatchNo: string;
  vehiclePlate: string;
  salesmanId: string;
  salesmanName: string;
  itemId: string | null;
  itemName: string;
  loadedQty: string;
  receivedQty: string;
  soldQty: string;
  bonusQty: string;
  returnedQty: string;
  damagedQty: string;
  shortageQty: string;
  remainingQty: string;
  awaitingReceipt: boolean;
  maxBonusQty: string;
  maxBonusPct: string;
};

/** سعرُ عميلٍ متّفق عليه من `dashboard.customerPrices` — يُعرض ولا يُفرض (الفرض للخادم). */
export type CustomerPriceRow = {
  id: string;
  partyId: string;
  partyName: string;
  partyCode: string;
  itemId: string | null;
  itemName: string;
  priceTierLabel: string;
  unitPrice: string;
  maxBonusPct: string;
  maxBonusKgPerInvoice: string;
  maxDiscountPct: string;
  creditLimit: string;
  paymentTermsDays: number;
  lockPrice: boolean;
  preferredInvoiceMode: string;
};

export type SalesDashboard = {
  policy: SalesPolicy;
  postingReadiness: PostingReadiness;
  summary: SalesSummary;
  documents: DocumentRow[];
  loadOrders: SaleLoadOrderRow[];
  customerPrices: CustomerPriceRow[];
  /**
   * 🪟 ما رجعته كلّ قائمةٍ وما في جدولها — يُعرض بدل عددٍ ثابت محفوظ في الشاشة، فحين يصير
   * في الجدول ٣٤٧ مستندًا تُقال «120 من 347» لا «أحدث ١٢٠». واختياريٌّ لأنّ شاشةً أقدم من
   * الخادم لا تُكذَّب: تُعرض الجملة الاحتياطية ولا يُخترع رقم.
   */
  windows?: DashboardWindows | null;
};

/**
 * نصوصُ الخادم كما هي — من `createDocument` و`createReturnDocument` وبوابة التجاوز في
 * `van-sales.controller.ts`. فلو غيّر الخادم نصًّا وبقي هذا كما هو، اختلفت الشاشة عن
 * الحقيقة؛ ولهذا يُذكر الموضع هنا وتقيسه اختبارات الـAPI من طرفه.
 */
export const SALES_MESSAGES = {
  loadOrderRequired:
    'يجب اختيار أمر التحميل / دفعة الإنتاج الخاصة بالمندوب لمنع بيع بضاعة من خارج المخبز',
  soldQtyRequired: 'أدخل الكمية المباعة بالكيلو',
  unitPriceRequired: 'حدد سعر البيع للكيلو',
  loadOrderNotFound: 'أمر التحميل غير موجود',
  loadOrderSettled: 'أمر التحميل هذا تم إغلاقه وتصفيته مسبقاً',
  loadOrderNotReceived:
    'لا يمكن البيع من عهدة لم يؤكّد المندوب استلامها بعد — أكّد الاستلام من تطبيق المندوب أولًا',
  bonusReasonRequired:
    'يجب تحديد سبب منح الكمية المجانية / البونص (ترويجي، عينات، تعويض تلف…)',
  internalDeliveryPolicyRequired:
    'وضع إشعار التسليم الداخلي بدون ضريبة غير مفعل افتراضياً. يتطلب اعتماد السياسة الضريبية والمحاسبية في إعدادات المنشأة قبل الاستخدام.',
  cashAccountRequired:
    'بيع نقدي يتطلّب صندوقًا مرتبطًا بحساب محاسبي — أنشئ صندوقًا من شاشة مواقع النقد أو حدّد حساب النقد في ملف الترحيل',
  /** نصّ عدم توفّر صلاحية التجاوز بالعربية. */
  overrideForbidden: 'الصلاحية المطلوبة غير متوفرة: اعتماد التجاوزات وسياسة التوزيع',
  returnDocumentRequired: 'حدد مستند البيع الأصلي للمرتجع',
  returnQtyPositive: 'كمية المرتجع يجب أن تكون أكبر من صفر',
  returnOfReturnRefused: 'لا يمكن إرجاع مرتجع — أنشئ مستند بيع جديد بدلًا من ذلك',
} as const;

/** رمزا الصلاحية اللذان يفتحان التجاوز عند الخادم (`permissionGrants` في المتحكم). */
export const OVERRIDE_PERMISSIONS = ['van_sales.override.approve', 'sales.discount.override'] as const;

/** قولُ الشاشة عن مدى اللوحة — فلا يظنّ المشرف أنّ الجدول كلّ المستندات. */
export const DASHBOARD_WINDOW_NOTE =
  'الجدول أحدث ١٢٠ مستندًا كما يحدّدها الخادم (ORDER BY created_at DESC LIMIT 120)، وأوامر التحميل أحدث ٦٠ — ليست كلَّ السجلّ؛ فمجاميع اليوم من summary الذي حسبه الخادم.';

/**
 * رقمٌ يُقرأ كما كُتب — و`null` حين لا يُقرأ، لا صفر. فالصفر عند الخادم قيمةٌ شرعية
 * (‏`bonusQty: '0'`)، وابتلاع نصٍّ فاسد إلى صفر يُصدر مستندًا لم يقصده أحد.
 */
export function decimalOrNull(value: string | number | null | undefined): Decimal | null {
  const text = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (text.length === 0) return null;
  try {
    const parsed = new Decimal(text);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function decimalOrZero(value: string | number | null | undefined): Decimal {
  return decimalOrNull(value) ?? new Decimal(0);
}

/** المتبقي على المستند = الإجمالي − المدفوع (محسوبٌ للعرض؛ والخادم يتحقّق عند السند). */
export function documentRemaining(doc: DocumentRow): Decimal {
  return Decimal.max(0, decimalOrZero(doc.total).minus(decimalOrZero(doc.paidAmount)));
}

export function documentRemainingText(doc: DocumentRow): string {
  return documentRemaining(doc).toFixed(2);
}

/** دينٌ قائم: بيعٌ آجل وبقي منه شيء. (الآجل وحده يُحصّل؛ والنقديّ دُفع لحظة الإصدار.) */
export function hasOpenDebt(doc: DocumentRow): boolean {
  return doc.paymentMethod === 'credit' && documentRemaining(doc).gt(0);
}

/** سقفُ المرتجع = المبيع + المجاني (الخادم: `sold_qty + bonus_qty`). */
export function returnCeiling(doc: DocumentRow): Decimal {
  return decimalOrZero(doc.soldQty).plus(decimalOrZero(doc.bonusQty));
}

/**
 * ما أُرجع فعلًا على هذا المستند — جمعُ `sold_qty` لمستندات `document_kind='return'`
 * المرتبطة به، كما يجمعها الخادم. ومن نافذة اللوحة (١٢٠ مستندًا) قد ينقص الجمع، ولهذا
 * يُستعمل تحذيرًا لا حظرًا.
 */
export function returnedBefore(documents: DocumentRow[], documentId: string): Decimal {
  return documents
    .filter((row) => row.documentKind === 'return' && row.referenceDocumentId === documentId)
    .reduce((sum, row) => sum.plus(decimalOrZero(row.soldQty)), new Decimal(0));
}

/** ما يبقى قابلًا للإرجاع بحسب نافذة اللوحة. */
export function returnableNow(documents: DocumentRow[], doc: DocumentRow): Decimal {
  return Decimal.max(0, returnCeiling(doc).minus(returnedBefore(documents, doc.id)));
}

/** مديونيةُ عميلٍ من نافذة اللوحة — تقديرٌ يُعرض، والحكم للخادم (`currentDebt`). */
export function partyOpenDebt(documents: DocumentRow[], partyId: string): Decimal {
  if (!partyId) return new Decimal(0);
  return documents
    .filter((row) => row.partyId === partyId && row.paymentMethod === 'credit')
    .reduce((sum, row) => sum.plus(documentRemaining(row)), new Decimal(0));
}

/** المتبقي في عهدة أمر التحميل كما يقول الخادم في اللوحة (`remainingQty`). */
export function loadOrderRemaining(row: SaleLoadOrderRow): Decimal {
  return decimalOrZero(row.remainingQty);
}

/**
 * أوامر التحميل التي يُباع منها الآن: غير مُصفّاة، وأكّد المندوب استلامها، وفيها متبقٍّ.
 * وما استُبعد يُقال سببُه في `loadOrderBlockReason` فلا يختفي أمرٌ بلا تفسير.
 */
export function saleableLoadOrders(rows: SaleLoadOrderRow[]): SaleLoadOrderRow[] {
  return rows.filter(
    (row) => row.status !== 'settled' && !row.awaitingReceipt && loadOrderRemaining(row).gt(0),
  );
}

/** لماذا لا يُباع من هذا الأمر — بنصّ الخادم حين يكون الحكم له. */
export function loadOrderBlockReason(row: SaleLoadOrderRow): string | null {
  if (row.status === 'settled') return SALES_MESSAGES.loadOrderSettled;
  if (row.awaitingReceipt) return SALES_MESSAGES.loadOrderNotReceived;
  if (loadOrderRemaining(row).lte(0)) return 'لا متبقّي في هذه العهدة — صُرف كلُّه أو أُقفل';
  return null;
}

/** اتفاقُ سعرٍ لهذا العميل على هذا الصنف — بلا تخمين: مطابقةُ العميل والصنف معًا. */
export function priceAgreement(
  prices: CustomerPriceRow[],
  partyId: string,
  itemId: string | null,
): CustomerPriceRow | null {
  if (!partyId) return null;
  return (
    prices.find((row) => row.partyId === partyId && itemId !== null && row.itemId === itemId) ?? null
  );
}

export function invoiceModeLabel(mode: string): string {
  if (mode === 'zatca_tax') return 'فاتورة ضريبية إلكترونية (ZATCA)';
  if (mode === 'internal_delivery') return 'إشعار تسليم / فاتورة توزيع داخلية';
  return mode; // ‏الحالة غير المعروفة تُعرض خاماً — لا ترجمةَ تُخفيها.
}

export function paymentMethodLabel(method: string): string {
  if (method === 'cash') return 'نقدًا';
  if (method === 'card') return 'شبكة';
  if (method === 'credit') return 'آجل';
  return method;
}

export function documentKindLabel(kind: string): string {
  if (kind === 'sale') return 'بيع';
  if (kind === 'return') return 'مرتجع';
  return kind;
}

/** حالة الفاتورة الرسمية — تُعرض كما جاءَت، و«—» حين لم تصدر فاتورة. */
export function invoiceStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (status === 'draft') return 'مسودة';
  if (status === 'submitted') return 'مُرسَلة إلى هيئة الزكاة';
  if (status === 'accepted') return 'مقبولة';
  if (status === 'rejected') return 'مرفوضة';
  return status;
}

/** تنبيه الرقابة على المستند كما كتبها الخادم (لا يُعاد صوغها). */
export function anomalyNote(doc: DocumentRow): string | null {
  if (!doc.bonusAnomaly) return null;
  return doc.anomalyReason.trim().length > 0
    ? doc.anomalyReason
    : 'رقابة البونص المجاني: المستند مُعلَّم بشذوذٍ بلا سببٍ مكتوب — راجعه قبل التحصيل.';
}

export type DocumentDraft = {
  loadOrderId: string;
  partyId: string;
  customerName: string;
  invoiceMode: 'zatca_tax' | 'internal_delivery';
  paymentMethod: 'cash' | 'card' | 'credit';
  cashLocationId: string;
  soldQty: string;
  bonusQty: string;
  bonusReason: string;
  unitPrice: string;
  discountAmount: string;
  discountReason: string;
  customerBonusConfirmed: boolean;
  customerConfirmationCode: string;
  allowPriceDiscountOverride: boolean;
  allowBonusOverride: boolean;
  notes: string;
};

export function emptyDocumentDraft(): DocumentDraft {
  return {
    loadOrderId: '',
    partyId: '',
    customerName: '',
    invoiceMode: 'zatca_tax',
    paymentMethod: 'cash',
    cashLocationId: '',
    soldQty: '',
    bonusQty: '',
    bonusReason: '',
    unitPrice: '',
    discountAmount: '',
    discountReason: '',
    customerBonusConfirmed: false,
    customerConfirmationCode: '',
    allowPriceDiscountOverride: false,
    allowBonusOverride: false,
    notes: '',
  };
}

/**
 * حمولة `POST /van-sales/documents` — المفاتيح التي يقرؤها المتحكم حرفاً، والخانة الفارغة
 * `undefined` لا نصًّا فارغاً (فالنصّ الفارغ قيمةٌ قد تُقرأ قصدًا). ولا يُرسل علمُ تجاوزٍ
 * `false` صريحاً: البوابة تُفحص على وجوده، وإرساله بلا حاجةٍ دعوةٌ لرفضٍ لا سبب له.
 */
export function buildDocumentPayload(draft: DocumentDraft) {
  const bonus = decimalOrZero(draft.bonusQty);
  const discount = decimalOrZero(draft.discountAmount);
  const walkIn = draft.customerName.trim();
  return {
    loadOrderId: draft.loadOrderId,
    partyId: draft.partyId || undefined,
    // ‏عميلٌ نقديّ بلا بطاقة: الاسم كما كُتب، والافتراضيّ نصّ الخادم نفسه في شاشة staff.
    customerName: draft.partyId ? undefined : walkIn.length > 0 ? walkIn : 'محل تجزئة نقدي',
    invoiceMode: draft.invoiceMode,
    paymentMethod: draft.paymentMethod,
    cashLocationId: draft.cashLocationId || undefined,
    soldQty: draft.soldQty,
    bonusQty: bonus.gt(0) ? bonus.toFixed(2) : '0',
    bonusReason: bonus.gt(0) ? draft.bonusReason.trim() || undefined : undefined,
    unitPrice: draft.unitPrice,
    discountAmount: discount.gt(0) ? discount.toFixed(2) : '0',
    discountReason: discount.gt(0) ? draft.discountReason.trim() || undefined : undefined,
    allowPriceDiscountOverride: draft.allowPriceDiscountOverride || undefined,
    allowBonusOverride: draft.allowBonusOverride || undefined,
    customerBonusConfirmed: draft.customerBonusConfirmed || undefined,
    customerConfirmationCode: draft.customerConfirmationCode.trim() || undefined,
    notes: draft.notes.trim() || undefined,
  };
}

export type Verdict = { blocked: string[]; warnings: string[] };

export type DocumentVerdictContext = {
  dashboard?: SalesDashboard;
  /** ‏هل يملك المشرف أحد رمزي التجاوز — لقراءة البوابة قبل الإرسال، لا للتحكّم في الوصول. */
  canOverride: boolean;
};

/**
 * حكمُ ما قبل الإرسال: **محظور** ما يطابق حسابه حسابَ الخادم (فيُقال نصُّ الخادم)، و**تحذير**
 * ما بُني على نافذة اللوحة أو على سياسةٍ يقرّرها الخادم بأرقامٍ أوسع. والحظر لا يمنح
 * إذنًا: الطلب يُرسل دائمًا والخادم هو الذي يُصدر المستند.
 */
export function documentVerdict(draft: DocumentDraft, context: DocumentVerdictContext): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const dashboard = context.dashboard;

  if (!draft.loadOrderId) {
    blocked.push(SALES_MESSAGES.loadOrderRequired);
  }
  const sold = decimalOrNull(draft.soldQty);
  if (!sold || sold.lte(0)) blocked.push(SALES_MESSAGES.soldQtyRequired);
  const unitPrice = decimalOrNull(draft.unitPrice);
  if (!unitPrice || unitPrice.lte(0)) blocked.push(SALES_MESSAGES.unitPriceRequired);

  const bonus = decimalOrZero(draft.bonusQty);
  if (bonus.gt(0) && draft.bonusReason.trim().length === 0) {
    blocked.push(SALES_MESSAGES.bonusReasonRequired);
  }
  if (draft.invoiceMode === 'internal_delivery' && !dashboard?.policy.allowInternalDeliveryWithoutTax) {
    blocked.push(SALES_MESSAGES.internalDeliveryPolicyRequired);
  }
  /**
   * 🧾 فاتورةٌ ضريبيةٌ وهويّةُ البائع ناقصة: الخادمُ يرفضها ٤٢٢
   * (‏`VAN_ZATCA_SELLER_IDENTITY_REQUIRED`) لأنّ رقمَ ضريبةٍ ليس للمنشأة في رمزٍ على فاتورة
   * عميلٍ خطأُ امتثالٍ لا خطأُ عرض — والشاشةُ تقول جملتَه **قبل** الإرسال كي لا يضغط
   * المندوب على إرسالٍ مصيره الرفض. والجملةُ من الحمولة لا من هنا.
   */
  const zatcaRefusal = dashboard?.policy.zatcaSeller?.refusalDetail ?? null;
  if (draft.invoiceMode === 'zatca_tax' && zatcaRefusal) blocked.push(zatcaRefusal);
  const asksOverride = draft.allowPriceDiscountOverride || draft.allowBonusOverride;
  if (asksOverride && !context.canOverride) {
    blocked.push(
      `${SALES_MESSAGES.overrideForbidden} — يتطلب التجاوز (سعر أو خصم أو بونص) صلاحية «اعتماد التجاوزات وسياسة التوزيع» أو «تجاوز سقف الخصم المعتمد».`,
    );
  }

  const loadOrder = dashboard?.loadOrders.find((row) => row.id === draft.loadOrderId) ?? null;
  if (draft.loadOrderId && !loadOrder) {
    warnings.push(
      `أمر التحميل المختار ليس في أحدث ٦٠ أمرًا في اللوحة — إن لم يجده الخادم قال: «${SALES_MESSAGES.loadOrderNotFound}».`,
    );
  }
  const loadOrderBlock = loadOrder ? loadOrderBlockReason(loadOrder) : null;
  if (loadOrderBlock) blocked.push(loadOrderBlock);

  if (loadOrder && (sold?.gt(0) ?? false)) {
    const requested = sold?.plus(bonus) ?? new Decimal(0);
    const custody = loadOrderRemaining(loadOrder);
    if (requested.gt(custody)) {
      warnings.push(
        `الكمية المطلوبة (${requested.toFixed(2)} = مبيع ${sold?.toFixed(2) ?? '0.00'} + مجاني ${bonus.toFixed(2)}) تتجاوز المتبقي في عهدة أمر التحميل (${custody.toFixed(2)}) — والخادم يرفض خلط بضاعةٍ من خارج دفعة المخبز بنصّه: «رفض أمني لمنع خلط بضاعة خارجية…». والحكم النهائي له: فقد يكون في اللوحة ما هو أحدث من قراءتك.`,
      );
    }
    // 🎁 سقفَا البونص على أمر التحميل (maxBonusQty/maxBonusPct) — رقابةُ الخادم تطلب عندها
    // رمز تأكيد استلام العميل أو اعتماد الإدارة، ولا تُعاد قاعدةُ الشذوذ كتابتُها هنا.
    const soldValue = (sold ?? new Decimal(0)).mul(unitPrice ?? new Decimal(0));
    const bonusPct = soldValue.gt(0) ? bonus.div(soldValue).mul(100) : new Decimal(0);
    const overKg = bonus.gt(decimalOrZero(loadOrder.maxBonusQty));
    const overPct = bonusPct.gt(decimalOrZero(loadOrder.maxBonusPct));
    if (
      (overKg || overPct) &&
      !draft.customerBonusConfirmed &&
      !draft.allowBonusOverride &&
      draft.customerConfirmationCode.trim().length === 0
    ) {
      warnings.push(
        `رقابة البونص المجاني: الكمية المجانية (${bonus.toFixed(2)}) تجاوزت سقف أمر التحميل (${decimalOrZero(loadOrder.maxBonusQty).toFixed(2)} كجم / ${decimalOrZero(loadOrder.maxBonusPct).toFixed(1)}%)، فالخادم يرفض 422 حتى يُدخل رمز تأكيد استلام العميل، أو يُعتمد التجاوز (allowBonusOverride بصلاحية ${OVERRIDE_PERMISSIONS[0]}).`,
      );
    }
  }

  const agreement = priceAgreement(dashboard?.customerPrices ?? [], draft.partyId, loadOrder?.itemId ?? null);
  if (agreement && unitPrice) {
    if (agreement.lockPrice && unitPrice.lt(decimalOrZero(agreement.unitPrice))) {
      warnings.push(
        `سعر هذا العميل مثبّت في النظام عند (${decimalOrZero(agreement.unitPrice).toFixed(2)} ريال/كجم — ${agreement.priceTierLabel})، والخادم يمنع البيع بأقلّ (${unitPrice.toFixed(2)}) إلا باعتماد التجاوز.`,
      );
    }
    const discount = decimalOrZero(draft.discountAmount);
    if (discount.gt(0)) {
      const base = (sold ?? new Decimal(0)).mul(unitPrice);
      const pct = base.gt(0) ? discount.div(base).mul(100) : new Decimal(0);
      const cap = decimalOrZero(agreement.maxDiscountPct);
      if (pct.gt(cap) && !draft.allowPriceDiscountOverride) {
        warnings.push(
          `الخصم (${discount.toFixed(2)} ريال — ${pct.toFixed(1)}% بحساب الشاشة) يتجاوز سقف العميل (${cap.toFixed(1)}%)؛ والخادم يمنعه إلا باعتماد التجاوز. والنسبة تقديرٌ من الكمية والسعر المعروضين، فالحكم له.`,
        );
      }
    }
    if (draft.paymentMethod === 'credit') {
      const limit = decimalOrZero(agreement.creditLimit);
      if (limit.gt(0)) {
        const debt = partyOpenDebt(dashboard?.documents ?? [], draft.partyId);
        const invoiceValue = (sold ?? new Decimal(0)).mul(unitPrice).plus(decimalOrZero(draft.discountAmount).mul(-1));
        if (debt.plus(invoiceValue).gt(limit)) {
          warnings.push(
            `سقف الائتمان (${limit.toFixed(2)} ريال): مديونية العميل في نافذة اللوحة (${debt.toFixed(2)}) مع هذه الفاتورة تتجاوزه — والخادم يفحص حدّه بمجموعٍ أوسع ويرفض 422 (تجاوز الحد الائتماني للعميل).`,
          );
        }
      }
    }
  }

  if (draft.paymentMethod === 'credit' && !draft.partyId) {
    warnings.push(
      'بيعٌ آجل بلا عميلٍ مسجّل: الخادم يسجّل المديونية على المستند لكنه لا يفحص سقف ائتمانٍ ولا يربطها ببطاقة عميل (فحصُ الحدّ عنده مشروطٌ بوجود partyId) — دينٌ بلا مدينٍ مُسمّى. اختر عميلاً أو اجعلها نقديّة.',
    );
  }

  if (draft.paymentMethod !== 'credit' && !draft.cashLocationId) {
    warnings.push(
      `بلا صندوقٍ نقديّ محدَّد: يأخذ الخادم صندوق الفرع الافتراضيّ وحسابه، ويرفض 422 إن لم يجد حسابًا: «${SALES_MESSAGES.cashAccountRequired}».`,
    );
  }

  if (dashboard && dashboard.postingReadiness.message) {
    warnings.push(dashboard.postingReadiness.message);
  }

  return { blocked, warnings };
}

export type ReturnDraft = {
  documentId: string;
  returnedQty: string;
  reason: string;
  notes: string;
};

/** حمولة `POST /van-sales/documents/:id/returns` (المفتاح في المسار لا في الحمولة). */
export function buildReturnPayload(draft: ReturnDraft) {
  return {
    returnedQty: draft.returnedQty,
    reason: draft.reason.trim() || undefined,
    notes: draft.notes.trim() || undefined,
  };
}

/**
 * حكمُ المرتجع قبل الإرسال: حظران يطابقان الخادم (بلا مستند، وكمية ≤ ٠)، ورفضُ «إرجاع
 * مرتجع» من نوع المستند نفسه. وأمّا سقف الكمية فتحذير: الخادم يجمع **كلّ** مرتجعات
 * المستند، واللوحة تعرض أحدث ١٢٠ مستندًا فقط.
 */
export function returnVerdict(draft: ReturnDraft, documents: DocumentRow[]): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];

  if (!draft.documentId) blocked.push(SALES_MESSAGES.returnDocumentRequired);
  const returned = decimalOrNull(draft.returnedQty);
  if (!returned || returned.lte(0)) blocked.push(SALES_MESSAGES.returnQtyPositive);

  const doc = documents.find((row) => row.id === draft.documentId) ?? null;
  if (draft.documentId && !doc) {
    warnings.push('المستند المختار ليس في نافذة اللوحة (أحدث ١٢٠) — والخادم يبحثه بنفسه.');
  }
  if (doc?.documentKind === 'return') blocked.push(SALES_MESSAGES.returnOfReturnRefused);

  if (doc && returned?.gt(0)) {
    const ceiling = returnCeiling(doc);
    const before = returnedBefore(documents, doc.id);
    if (before.plus(returned).gt(ceiling)) {
      warnings.push(
        `إجمالي المرتجع (${before.plus(returned).toFixed(2)}) يتجاوز الكمية المباعة في المستند (${ceiling.toFixed(2)}) — وهذا ما سيقوله الخادم بالضبط؛ وجمْعُ «ما أُرجع سابقًا» هنا من نافذة اللوحة، فقد يكون أوسع عنده.`,
      );
    }
  }
  if (doc && returned?.gt(0) && draft.reason.trim().length === 0) {
    warnings.push('بلا سببٍ للمرتجع: يُقبل عند الخادم، لكن مرتجعًا بلا سببٍ لا يُراجَع ولا يُحاسب عليه أحد.');
  }

  return { blocked, warnings };
}

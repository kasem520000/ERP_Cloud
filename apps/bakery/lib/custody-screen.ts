import {
  canApproveClosing,
  canCloseTransitDifference,
  canSettleStock,
  canSubmitClosing,
  chargeBasisLabel,
  chargePreview,
  unsettledStockReason,
  valuationBasisLabel,
  valuationSourceLabel,
  type ApprovalDraft,
  type ChargeReadiness,
  type ChargeRow,
  type ClosingDraft,
  type CustodyQuantities,
} from '@erp/web-van/custody';

import { numberText } from './lookups';

/**
 * 📋 glue شاشة إقفال العهدة — **دوالّ صافية وحدها** (تُقاس في `tests/custody-screen.spec.ts`)،
 * والطلب والشاشة في `app/custody/page.tsx`.
 *
 * كلّ حقلٍ هنا مُتحقَّقٌ منه في مصدره: صفوف العهدات من إسقاط `GET /van-sales/dashboard`
 * (‏`van-sales.service.ts` — `loadOrders`، ومنها حقول الشريحة 4 `shortageJournalEntryId` /
 * `shortageChargeBasis` / `shortageChargeAmount`)، والسياسة من `GET /van-sales/policy`. ولا
 * اختراع: ما لم يقله الخادم لا يُعرض، والغائب `—` لا صفر.
 *
 * والقاعدة التي تحكم هذه الشاشة قبل غيرها: **القرار الماليّ يُقال أثره قبل الضغط**. فمسودة
 * الاعتماد تُبنى وكلّ أعلامها `false` — لا فحصَ مُفتراض، ولا تحميلَ على المندوب مُفتراض، ولا
 * تفويضَ ترحيلٍ مُفتراض — وما يترتّب على رفعها يُعرض (كم، على أيّ حساب، بأيّ أساس، وهل
 * سيُرفض) قبل أن يُرسل.
 */

/** صفّ عهدة كما يعود في `loadOrders` من لوحة القيادة — الحقول التي تقرأها هذه الشاشة. */
export type CustodyRow = ChargeRow &
  CustodyQuantities & {
    id?: string | null;
    number?: string | null;
    loadDate?: string | null;
    status?: string | null;
    productionBatchNo?: string | null;
    vehiclePlate?: string | null;
    salesmanName?: string | null;
    itemId?: string | null;
    itemName?: string | null;
    vanWarehouseId?: string | null;
    discrepancyQty?: string | number | null;
    discrepancyNotes?: string | null;
    /** المرتجع السليم والتالف والمتبقي الفعلي — أضلاع الفصل الرباعي (من صفّ الخادم). */
    returnedQty?: string | number | null;
    damagedQty?: string | number | null;
    actualRemainingQty?: string | number | null;
    awaitingReceipt?: boolean | null;
    remainingQty?: string | number | null;
    expectedRemainingQty?: string | number | null;
    countVarianceQty?: string | number | null;
    countVarianceCostValue?: string | number | null;
    stockAdjustmentId?: string | null;
    remainingAction?: string | null;
    stockSettlementStatus?: string | null;
    stockSettlementNote?: string | null;
    awaitingStockSettlement?: boolean | null;
    awaitingTransitDecision?: boolean | null;
    shortagePolicyStatus?: string | null;
    salaryDeductionApproved?: boolean | null;
    damageInspected?: boolean | null;
    damageReason?: string | null;
    damageJournalEntryId?: string | null;
    expectedCash?: string | number | null;
    collectedCash?: string | number | null;
    cashVariance?: string | number | null;
    closingNotes?: string | null;
    closingSubmittedAt?: string | null;
    approvedAt?: string | null;
    approvedByLabel?: string | null;
  };

/** سياسة العجز كما تعود من `GET /van-sales/policy` (الشريحة 4). */
export type ShortagePolicyRow = {
  shortageValuationBasis?: string | null;
  shortageUnitPrice?: string | null;
  preventSelfApproval?: boolean | null;
  allowInternalDeliveryWithoutTax?: boolean | null;
  /** ما سيحدث فعلاً: سعرٌ صريحٌ مكتوب يتقدّم على الأساس. */
  valuationSource?: string | null;
  configured?: boolean | null;
  writableKeys?: string[] | null;
  chargeCreditAccount?: { id?: string | null; name?: string | null; code?: string | null } | null;
  chargeReadiness?: ChargeReadiness | null;
};

/** `policy` من لوحة القيادة نفسها — شكلها أضيق من مسار السياسة. */
export type DashboardPolicy = {
  shortageValuationBasis?: string | null;
  preventSelfApproval?: boolean | null;
  allowInternalDeliveryWithoutTax?: boolean | null;
};

export type CustodyDashboard = {
  loadOrders?: CustodyRow[] | null;
  policy?: DashboardPolicy | null;
  mainWarehouseId?: string | null;
};

/** صفوف العهدات: يُستبعد ما لا `id` له (لا يُنفَّذ إجراءٌ على صفٍّ بلا معرّف). */
export function mapCustodyRows(payload: CustodyDashboard | null | undefined): CustodyRow[] {
  return (payload?.loadOrders ?? []).filter(
    (row): row is CustodyRow => typeof row?.id === 'string' && row.id.length > 0,
  );
}

/**
 * العهدات التي تنتظر قراراً الآن — تقديمٌ أو اعتمادٌ أو تسويةُ مخزونٍ معلّقة أو فرقُ عبور.
 * وما عداها (مسودةٌ لم تُحمَّل، ملغاة، مرفوضة، مُسوّاة) يُعرض في الجدول ولا يُعدّ معلّقاً.
 */
export function openCustodies(rows: readonly CustodyRow[]): CustodyRow[] {
  return rows.filter(
    (row) =>
      canSubmitClosing(row) ||
      canApproveClosing(row) ||
      canSettleStock(row) ||
      canCloseTransitDifference(row),
  );
}

/**
 * مسودة تقديم الإقفال — **فارغة**: الجرد الفعلي ما يعدّه المندوب بنفسه، وأرقام الصفّ
 * (المباع/البونص) من الخادم لا من الشاشة. فما كان مُدخلاً يُترك مُدخلاً، وما كان محسوباً
 * لا يُنسخ إلى خانةٍ يوحي أنّ أحداً كتبها.
 */
/**
 * المسودة فارغةٌ **عمداً** ولا تأخذ الصفّ: الجرد الفعلي ما يعدّه المندوب بنفسه عند الإقفال،
 * وما في الصفّ قبل التقديم أرقامُ الحمولة والمبيعات (من الخادم) لا جردٌ — فنسخها إلى خانة
 * «المتبقي الفعلي» يجعل رقماً لم يعُدّه أحد أساساً لعجزٍ محسوب. وتُعرض أرقام الصفّ إلى جانب
 * الخانة (`expectedRemainingQty`) مرجعاً لا بديلاً.
 */
export function emptyClosingDraft(): ClosingDraft {
  return {
    returnedQty: '',
    damagedQty: '',
    damageReason: '',
    collectedCash: '',
    actualRemainingQty: '',
    closingNotes: '',
  };
}

/**
 * مسودة الاعتماد — الكميات من تقديم المندوب (ليُصحّحها المحاسب إن عدّها بنفسه)، و**كلّ
 * الأعلام مغلقة**: لا `damageInspected` ولا `salaryDeductionApproved` ولا
 * `settleStockAdjustment` ولا `surplusAcknowledged` تُرفع افتراضاً. فرفعُها قرارٌ يُقال أثره
 * قبل الضغط (`chargePreview` + `approvalBlockers`)، والافتراض هنا مالٌ يُحمَّل بلا قرار.
 */
export function approvalDraftFromRow(row: CustodyRow): ApprovalDraft {
  return {
    returnedQty: row.returnedQty === null || row.returnedQty === undefined ? '' : String(row.returnedQty),
    damagedQty: row.damagedQty === null || row.damagedQty === undefined ? '' : String(row.damagedQty),
    damageReason: row.damageReason ?? '',
    collectedCash:
      row.collectedCash === null || row.collectedCash === undefined ? '' : String(row.collectedCash),
    actualRemainingQty:
      row.actualRemainingQty === null || row.actualRemainingQty === undefined
        ? ''
        : String(row.actualRemainingQty),
    closingNotes: '',
    damageInspected: false,
    salaryDeductionApproved: false,
    remainingAction: row.remainingAction ?? '',
    settleStockAdjustment: false,
    surplusAcknowledged: false,
    selfApprovalOverride: false,
    notes: '',
  };
}

/** النقد: المحصَّل مقابل المتوقع وفرقه — من الخادم، لا حسبةٌ في المتصفح. */
export function cashPosition(row: CustodyRow): {
  collected: string;
  expected: string;
  variance: string;
} {
  return {
    collected: numberText(row.collectedCash),
    expected: numberText(row.expectedCash),
    variance: numberText(row.cashVariance),
  };
}

/**
 * دليل التحميل المُرحَّل — ما رُحِّل فعلاً لا ما تُعلنه السياسة اليوم. `null` حين لم يُرحَّل
 * (بلا علمٍ صريح، أو اعتمادٌ سابق للشريحة 4)، والشاشة تقول ذلك صراحةً بدل رقمٍ مُقدَّر.
 */
export function chargeEvidence(row: CustodyRow): {
  amount: string;
  basisText: string;
  journalEntryId: string;
  deductionApproved: boolean;
} | null {
  const entryId = row.shortageJournalEntryId ?? null;
  if (!entryId) return null;
  return {
    amount: numberText(row.shortageChargeAmount),
    basisText: chargeBasisLabel(row.shortageChargeBasis ?? null),
    journalEntryId: entryId,
    deductionApproved: row.salaryDeductionApproved === true,
  };
}

/** ملخّص السياسة للعرض: الأساس، وما سيتقدّم عليه، والحساب الدائن المربوط. */
export function policySummary(policy: ShortagePolicyRow | null | undefined): {
  basisText: string;
  sourceText: string;
  explicitPriceText: string;
  creditAccountText: string;
  configured: boolean;
  preventSelfApproval: boolean;
} {
  const basis = policy?.shortageValuationBasis ?? null;
  const source = policy?.valuationSource ?? basis;
  return {
    basisText: valuationBasisLabel(basis),
    // ‏سعرٌ صريحٌ مكتوب يتقدّم على الأساس — فقول «الأساس: التكلفة» وحده قد يكون كذباً.
    sourceText: valuationSourceLabel(source),
    explicitPriceText: numberText(policy?.shortageUnitPrice ?? null),
    creditAccountText: policy?.chargeCreditAccount?.name ?? '—',
    configured: policy?.configured === true,
    preventSelfApproval: policy?.preventSelfApproval === true,
  };
}

/**
 * ما يُقال للمحاسب **قبل** الضغط على الاعتماد — لا بعده بخطأٍ من الخادم:
 *   · فرقُ مخزونٍ غير مُسوّى (لا تُغلق عهدةٌ معه)؛
 *   · ومانعُ التحميل على المندوب حين يُرفع علمه (لا بطاقة موظف، لا حساب له، لا حساب دائن).
 * والقائمة فارغةً ⇒ لا مانعٌ معلوم، والحكم النهائي للخادم على أيّ حال.
 */
export function approvalBlockers(
  row: CustodyRow,
  readiness: ChargeReadiness | null | undefined,
  deductionApproved: boolean,
): string[] {
  const out: string[] = [];
  const unsettled = unsettledStockReason(row);
  if (unsettled) out.push(unsettled);
  const preview = chargePreview(row, readiness, deductionApproved);
  if (preview.blockingReason) out.push(preview.blockingReason);
  return out;
}

/** تسمية الصفّ في الجدول: الرقم، ثمّ المندوب، ثمّ الصنف — بلا تركيبٍ من عندنا. */
export function custodyLabel(row: CustodyRow): string {
  const parts: string[] = [];
  if (row.number) parts.push(row.number);
  if (row.salesmanName) parts.push(row.salesmanName);
  if (row.itemName) parts.push(row.itemName);
  if (parts.length === 0) return row.id ?? '—';
  return parts.join(' · ');
}

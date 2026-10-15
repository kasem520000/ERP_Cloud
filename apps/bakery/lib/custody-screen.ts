import {
  CLOSING_MESSAGES,
  canApproveClosing,
  canCloseTransitDifference,
  canSettleStock,
  canSubmitClosing,
  chargeBasisLabel,
  chargePreview,
  unsettledStockReason,
  valuationBasisLabel,
  vehicleCountShare,
  valuationSourceLabel,
  type ApprovalDraft,
  type ChargeReadiness,
  type ChargeRow,
  type ClosingDraft,
  type CustodyQuantities,
} from '@erp/web-van/custody';
import { num } from '@erp/web-van/production';

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
    /**
     * مستند الجرد الرسمي كما رحّله المحرّك: الرصيد المتوقع لحظة الترحيل، وفرقه **كميةً وقيمةً**.
     * ‏`null` حين لم يُرحَّل (المسودة تحمل أصفاراً فلا تُعرض كأنّها مُرحَّلة).
     */
    countDocumentExpectedQty?: string | number | null;
    countDocumentVarianceQty?: string | number | null;
    countDocumentVarianceValue?: string | number | null;
    /**
     * 🚐 تغطية الرصيد الرسمي للعهدة — للأوامر المفتوحة وحدها (`loaded` / `in_route` /
     * `pending_closing` / `pending_stock_settlement`)، و`null` لمن سُوّي أو لم يُحسب له.
     * `vanOfficialQty` رصيد السيارة الرسمي للصنف، `otherCustodyInVanQty` ما فيها لأوامر أخرى،
     * و`vanStockShortOfCustodyQty` ما نقص في الرصيد عن عهدة هذا الأمر.
     */
    vanOfficialQty?: string | number | null;
    otherCustodyInVanQty?: string | number | null;
    vanStockShortOfCustodyQty?: string | number | null;
    /**
     * 🚐 دليلُ عدد المركبة (`0129`) — ما أُعلن للعدّ (عددُ الصنف في السيارة كلها) وما طرحه
     * الخادم منه لأنه عهدةُ أوامرَ أخرى، كما قِيلا لحظة الإقفال. و`null` = إقفالٌ بعددٍ لكلّ
     * أمر (السلوك السابق حرفياً).
     */
    vehicleCountQty?: string | number | null;
    otherCustodyQty?: string | number | null;
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
    vehicleCountQty: '',
    otherCustodyInVanQty: '',
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
    vehicleCountQty:
      row.vehicleCountQty === null || row.vehicleCountQty === undefined
        ? ''
        : String(row.vehicleCountQty),
    otherCustodyInVanQty:
      row.otherCustodyInVanQty === null || row.otherCustodyInVanQty === undefined
        ? ''
        : String(row.otherCustodyInVanQty),
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

/**
 * 🧾 تدقيق مستند الجرد — ما امتصّه المستند خارج اعتماد هذا الأمر.
 *
 * مستند الجرد **مطلق**: `createAdjustment` يُنشأ بـ`countedQty = actual_remaining_qty`، فيضبط
 * رصيد السيارة على العدد المُعلن، وفرقُه يُحسب من الرصيد الرسمي لحظة الترحيل
 * (‏`countDocumentExpectedQty`) — بينما فرقُ الاعتماد (`countVarianceQty`) محسوبٌ من عهدة هذا
 * الأمر وحده (`loaded − sold − bonus − returned − damaged − actual`). وحين تحمل السيارة عهدةً
 * أخرى (‏`carry_over` من ورديةٍ سابقة، أو بضاعةَ مندوبٍ آخر في سيارةٍ مشتركة) يقع الفرق بين
 * الرقمين في مستند الجرد — في حساب تسويات المخزون — ولا يقع في عهدة أحد.
 *
 * الخادم يعرفها ويكتبها: `absorbedVariance` في `runStockSettlement` تُضاف تحذيراً إلى
 * `stock_settlement_note`. وهذه الدالة تُظهر الرقمين معاً كما جاءا، **بلا استنتاجٍ من الشاشة**:
 * الامتصاص = |كمية فرق المستند| − |فرق الاعتماد|، وكلاهما من صفّ الخادم، والناقص «—».
 */
export function countSettlementAudit(row: CustodyRow): {
  posted: boolean;
  absorbed: boolean;
  absorbedQtyText: string;
  documentExpectedText: string;
  documentVarianceQtyText: string;
  documentVarianceValueText: string;
  approvedVarianceText: string;
  noteText: string | null;
} {
  const expected = row.countDocumentExpectedQty ?? null;
  const documentVariance = row.countDocumentVarianceQty ?? null;
  const posted = expected !== null && documentVariance !== null;
  // الاصطلاحان مختلفان إشارةً: محرّك المخزون يكتب `counted − expected` (سالبٌ عند العجز)،
  // والعهدة تكتب `expected − counted` (موجبٌ عند العجز) — فالمقارنة بين المقدارين، لا بين
  // الرقمين بإشارتيهما، وإلا صار الفائض امتصاصاً مُختلَعاً.
  const absorbedQty = num(documentVariance).abs().minus(num(row.countVarianceQty ?? null).abs());
  const absorbed = posted && absorbedQty.gt(0);
  const note = row.stockSettlementNote?.trim();
  return {
    posted,
    absorbed,
    absorbedQtyText: absorbed ? absorbedQty.toFixed(2) : '—',
    documentExpectedText: numberText(expected),
    documentVarianceQtyText: numberText(documentVariance),
    documentVarianceValueText: numberText(row.countDocumentVarianceValue ?? null),
    approvedVarianceText: numberText(row.countVarianceQty ?? null),
    noteText: note ? note : null,
  };
}

/**
 * 🚐 تغطية الرصيد الرسمي للعهدة — ما **في** السيارة مقابل ما **يجب** أن يكون فيها لهذا الأمر.
 *
 * السبب مقاسٌ لا مقدَّر: مستند الجرد مطلقٌ (يضبط رصيد السيارة على العدد المُعلن)، ففي منشأة
 * العرض امتصّ إقفالُ أمرٍ 18.00 كجم هي عهدةَ أمرٍ **مفتوح** آخر (`VLO-0001`، ما تزال تنتظر قرار
 * فرق العبور)، فصار رصيدها الرسمي 4.50 كجم لعهدةٍ مفتوحة مقدارها 18.00 — ونقصُ 13.50 كجم لا
 * يظهر في أيّ عهدة ولا يُحاسب عليه أحد. وهذه الدالة تُظهر الرقمين كما جاءا من الخادم:
 *
 *   · `otherCustodyInVanQty > 0` ⇒ السيارة تحمل عهدةَ أوامرَ أخرى؛ العددُ المُعلن لهذا الأمر
 *     يجب ألّا يشملها (وإلا شطبها مستند الجرد).
 *   · `vanStockShortOfCustodyQty > 0` ⇒ الرصيد الرسمي أقلّ من عهدة هذا الأمر المفتوح؛ أي أنّ
 *     تسويةَ أمرٍ آخر شطبت بعضها — تُقال ولا تُخفى، ولا يُقفل الأمر كأنّ شيئاً لم يكن.
 *
 * وكلاهما `null` للأوامر المُسوّاة: بعد الترحيل صار الرصيد هو العدد المُعلن نفسه فالمقارنة عبث.
 */
export function vanCustodyCoverage(row: CustodyRow): {
  open: boolean;
  officialText: string;
  otherCustodyText: string;
  shortOfCustodyText: string;
  warning: string | null;
  /** `danger` لنقصٍ في الرصيد عن العهدة، `warn` لعهدةٍ أخرى في السيارة، و`null` لتغطيةٍ سليمة. */
  tone: 'danger' | 'warn' | null;
} {
  const official = row.vanOfficialQty ?? null;
  const open = official !== null;
  const other = num(row.otherCustodyInVanQty ?? null);
  const missing = num(row.vanStockShortOfCustodyQty ?? null);
  let warning: string | null = null;
  let tone: 'danger' | 'warn' | null = null;
  if (missing.gt(0)) {
    warning = `الرصيد الرسمي للسيارة (${numberText(official)}) أقلّ من عهدة هذا الأمر (${numberText(
      row.expectedRemainingQty ?? null,
    )}) بمقدار ${missing.toFixed(2)} كجم — نقصٌ وقع في تسويات أوامرَ أخرى (مستند الجرد يضبط الرصيد كله على العدد المُعلن)، فلا تُقفل هذه العهدة قبل بيان مصير الفرق.`;
    tone = 'danger';
  } else if (other.gt(0)) {
    warning = `السيارة تحمل ${other.toFixed(
      2,
    )} كجم عهدةً لأوامرَ أخرى إضافةً إلى هذه العهدة (الرصيد الرسمي ${numberText(
      official,
    )}) — ومستند الجرد يضبط الرصيد كله، فالعدد المُعلن هنا لهذه العهدة وحدها ولا تُدخل فيه ما لغيرها.`;
    tone = 'warn';
  }
  return {
    open,
    officialText: numberText(official),
    otherCustodyText: numberText(row.otherCustodyInVanQty ?? null),
    shortOfCustodyText: numberText(row.vanStockShortOfCustodyQty ?? null),
    warning,
    tone,
  };
}

/**
 * 🚐 خلاصةُ الغطاء الرسمي للعهدة المفتوحة على مستوى السيارة: كم عهدةً مفتوحةً لا يغطّيها رصيدُ
 * السيارة الرسمي، ومجموعُ النقص. تُرفع للواجهة كرقمٍ واحد (لا حسابَ في المكوّنات) لأنّ النقص هنا
 * ليس فرقَ أمرٍ واحد بل أثرُ مستندات جردٍ أُصدرت لأوامرَ أخرى على رصيدٍ واحد.
 */
export function uncoveredCustodySummary(rows: readonly CustodyRow[]): {
  count: number;
  shortfallText: string;
} {
  let shortfall = num(0);
  let count = 0;
  for (const row of rows) {
    if (row.vanOfficialQty == null) continue;
    const missing = num(row.vanStockShortOfCustodyQty ?? null);
    if (!missing.gt(0)) continue;
    count += 1;
    shortfall = shortfall.add(missing);
  }
  return { count, shortfallText: numberText(shortfall.toFixed(2)) };
}

/**
 * 🚐 معاينةُ عدد المركبة — ما سيشتقّه الخادم، معروضاً **قبل** الإرسال.
 *
 * القاعدة واحدة في الطرفين (`vehicleCountShare` هنا و`resolveVehicleCountInTx` في الخادم):
 * `A = max(0, V − O)` حيث `O` عهدةُ الأوامر الأخرى من اللوحة. والخادم يبقى المرجع: يعيد
 * الاشتقاق من الرصيد الرسمي الحيّ لحظة الإقفال، ويرفض `V < O` صراحةً.
 *
 * والفائدة عملية لا شكلية: بلا هذه المعاينة يكتب المشرف عدداً للسيارة كلها فيُفاجأ بأنّ العجز
 * المحسوب على المندوب أقلّ ممّا ظنّ — أو بأنّ العدد رفضه الخادم لأنه دون عهدة غيره.
 */
export function vehicleCountPreview(
  row: CustodyRow,
  draft: ClosingDraft,
): {
  declared: boolean;
  vehicleCountText: string;
  otherCustodyText: string;
  shareText: string;
  expectedText: string;
  varianceText: string;
  varianceKind: 'shortage' | 'surplus' | 'exact';
  belowOtherCustody: boolean;
  note: string | null;
} {
  const share = vehicleCountShare(draft);
  const expected = num(row.expectedRemainingQty ?? null);
  const variance = expected.minus(share.share);
  const varianceKind: 'shortage' | 'surplus' | 'exact' = variance.gt(0)
    ? 'shortage'
    : variance.lt(0)
      ? 'surplus'
      : 'exact';
  let note: string | null = null;
  if (share.belowOtherCustody) {
    note = CLOSING_MESSAGES.vehicleCountBelowOtherCustody({
      count: share.vehicleCount.toFixed(2),
      other: share.otherCustody.toFixed(2),
    });
  } else if (share.declared) {
    note = `من عدد السيارة ${share.vehicleCount.toFixed(
      2,
    )} كجم تُطرح عهدةُ الأوامر الأخرى ${share.otherCustody.toFixed(
      2,
    )} كجم فيبقى لهذه العهدة ${share.share.toFixed(2)} كجم — ومتوقّعُها حسب المستندات ${expected.toFixed(
      2,
    )} كجم. ومستند الجرد الرسمي يُرسل بعدد السيارة كله، فيصير فرقُه هو فرقَ هذه العهدة ولا يُشطب ما لا تملكه.`;
  }
  return {
    declared: share.declared,
    vehicleCountText: share.declared ? share.vehicleCount.toFixed(2) : '—',
    otherCustodyText: share.otherCustody.toFixed(2),
    shareText: share.declared ? share.share.toFixed(2) : '—',
    expectedText: expected.toFixed(2),
    varianceText: share.declared ? variance.toFixed(2) : '—',
    varianceKind,
    belowOtherCustody: share.belowOtherCustody,
    note,
  };
}

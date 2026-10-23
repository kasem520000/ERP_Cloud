import { Decimal } from 'decimal.js';

import { num } from './production';

/**
 * 📋 عقد إقفال العهدة — تقديم الجرد، ثمّ اعتماده، وما يرحّله الاعتماد من ذمّة.
 *
 * نفس مبدأ عقدي الإنتاج والتوزيع: **لا قواعد أعمال هنا**، بل شكل الحمولة كما يقرأها الخادم
 * حرفاً (`POST /van-sales/load-orders/:id/submit-closing` و`…/approve-closing`) وأحكام الرفض
 * التي يقولها الخادم بالعربية — فلا يُعرض للمشرف وعدٌ لا ينفّذه الخادم، ولا يضيع طلبٌ ميت.
 *
 * ما ثبته المسح في الخادم (`apps/api/src/modules/van-sales/van-sales.service.ts`):
 *   · **أساس العهدة** `loaded = received_qty > 0 ? received_qty : loaded_qty` (‎:4006 و‎:4195) —
 *     فالمحمَّل ليس العهدة بعد استلامٍ ناقص؛
 *   · **المحسوب** `accountedQty = sold + bonus + returned + damaged` (‎:4032)، والمتبقي المتوقع
 *     `expectedRemaining = loaded − accountedQty`، وفرق الجرد `countVariance = expected − actual`؛
 *   · تقديم المندوب يرفض أن يتجاوز المجموع عهدته (‎:4029)، واعتماد المحاسب يقبل الفائض
 *     **بإقرارٍ صريح** وحده (`VAN_CLOSING_SURPLUS_ACK_REQUIRED` ‎:4235) — فلا كيلو يبقى خارج
 *     الدفتر ولا يُقلب الفائض إيراداً أو هدية؛
 *   · متبقٍ فعلي بلا مصير ⇒ `VAN_CLOSING_REMAINING_ACTION_REQUIRED` (‎:4273): لا تُغلق عهدةٌ
 *     وكميةٌ في السيارة بلا قرار؛
 *   · تلفٌ بلا فحص ⇒ 422 (‎:4214)، واعتمادُ ذاتي ⇒ 403 (‎:4177)؛
 *   · **الشريحة 4**: `salaryDeductionApproved` صار يُنفَّذ — قيدٌ مدينُه حساب الموظف نفسه
 *     (`employees.employee_account_id`) وقيمته `shortage_qty ×` سياسة التقييم، وبلا العلم لا
 *     يُرحَّل شيء، وناقصُ الحسابين ⇒ 422 ولا يمرّ الاعتماد (‎:4520–4560).
 *
 * وما ترفضه الشاشة أشدّ من الخادم في موضعٍ واحد مقصود: **النصّ غير الرقمي**. فالخادم يقرأه
 * صفراً بصمت (`dec()` تلتقط الخطأ وتُعيد `new Decimal(0)`)، وكيلوجرامٌ أُدخل «١٢» أو «abc»
 * وصار صفراً عهدةٌ تُغلق على رقمٍ لم يكتبه أحد — فالشاشة ترفضه قبل الإرسال.
 */

/** رقمٌ نصّيّ صالح (السالب مقبولٌ في النصّ ومرفوضٌ في الحكم أدناه). */
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

function orUndefined(value: string): string | undefined {
  const text = value.trim();
  return text === '' ? undefined : text;
}

/** كميات العهدة كما يعيدها الخادم في صفّ `loadOrders` — أساس كلّ حكمٍ في هذا العقد. */
export type CustodyQuantities = {
  loadedQty?: string | number | null;
  receivedQty?: string | number | null;
  soldQty?: string | number | null;
  bonusQty?: string | number | null;
  /**
   * ACC-167/ACC-188 (R33): مرتجع العميل (`customer_returned_qty`) يعود إلى السيارة فيرفع سقف
   * العهدة — `custodyCeiling = loaded + customerReturned` في الخادم (`submitClosing`/`approveClosing`).
   */
  customerReturnedQty?: string | number | null;
};

/** أساس العهدة: ما استُلم فعلاً إن وُجد، وإلا ما حُمِّل — قاعدة الخادم نفسها (‎:4006). */
export function custodyBasis(q: CustodyQuantities) {
  const received = num(q.receivedQty);
  return received.gt(0) ? received : num(q.loadedQty);
}

/**
 * سقف العهدة الذي يُقاس به المجموع: الأساس + مرتجع العميل (ما عاد إلى السيارة بعد بيعه) —
 * `custodyCeiling` في الخادم. ACC-188 (R33): كانت الشاشة تقيس بالأساس وحده وتطرح المرتجع من المباع
 * (صيغة ACC-167 القديمة) فتخالف حكم الخادم في الاتجاهين.
 */
export function custodyCeiling(q: CustodyQuantities) {
  return custodyBasis(q).plus(Decimal.max(0, num(q.customerReturnedQty)));
}

/**
 * ما حُوسب فعلاً من العهدة: المباع + البونص + المرتجع السليم + التالف — حرفياً كما يجمعها الخادم
 * (`accountedQty = sold + bonus + returnedQty + damagedQty`)، فالمرتجع السليم كميةٌ عادت لا خصمٌ من المباع.
 */
export function accountedFor(q: CustodyQuantities, returned: string, damaged: string) {
  return num(q.soldQty).plus(num(q.bonusQty)).plus(num(returned)).plus(num(damaged));
}

/** مسودة تقديم الإقفال كما تكتبها الشاشة (من `submitClosing` في الخادم). */
export type ClosingDraft = {
  returnedQty: string;
  damagedQty: string;
  damageReason: string;
  collectedCash: string;
  /** 🧮 الجرد الفعلي في السيارة — الرقم الذي يُقاس به العجز/الفائض. */
  actualRemainingQty: string;
  /**
   * 🚐 عددُ الصنف في السيارة **كلها** كما يُعدّ فعلاً (قرار المالك 2026-10-15). بديلٌ عن
   * `actualRemainingQty` لا رفيقٌ له: الخادم يطرح منه عهدةَ الأوامر الأخرى الجالسة في السيارة
   * نفسها ويشتقّ نصيبَ هذه العهدة، ويُرسل مستند الجرد بالعدد كله. والفراغ ⇒ سلوك «عددٍ لكلّ
   * أمر» حرفياً (فلا يتغيّر شيءٌ على `apps/staff`).
   */
  vehicleCountQty?: string;
  /**
   * ما في السيارة عهدةً لأوامر أخرى — من اللوحة (`otherCustodyInVanQty`)، لأجل المعاينة والرفض
   * قبل الإرسال. والخادم يبقى المرجع: يعيد الاشتقاق من الرصيد الرسمي الحيّ لحظة الإقفال.
   */
  otherCustodyInVanQty?: string;
  closingNotes: string;
};

export type ClosingPayload = {
  returnedQty?: string;
  damagedQty?: string;
  damageReason?: string;
  collectedCash?: string;
  actualRemainingQty?: string;
  /** 🚐 يُرسل وحده بلا `actualRemainingQty` — جمعهما في طلبٍ واحد يرفضه الخادم 422. */
  vehicleCountQty?: string;
  closingNotes?: string;
};

export type ClosingVerdict =
  | { ok: true; payload: ClosingPayload }
  | { ok: false; message: string; field?: string };

/**
 * نصوص الرفض **حرفاً كما يقولها الخادم** — والقالبان يحشو الخادم أرقامهما، فالحشو هنا من
 * أرقام الصفّ نفسها لا من تقدير الشاشة. ومثبّتةٌ من طرف الخادم في
 * `apps/api/test/van-sales-stock-acceptance.spec.ts` و`apps/api/test/van-sales.spec.ts`.
 */
export const CLOSING_MESSAGES = {
  damageReasonRequired:
    'عند تسجيل كمية تالفة يجب كتابة سبب التلف بوضوح لإحالته للفحص الفعلي من المحاسب وأمين المستودع',
  alreadySettled: 'تم اعتماد وتصفية هذه الوردية مسبقاً',
  /** ‏نصّ الخادم في `submitClosing` (‎:4029) — قوالبه أرقام الصفّ. */
  exceedsCustody: (p: {
    sold: string;
    bonus: string;
    returned: string;
    damaged: string;
    actual: string;
    total: string;
    loaded: string;
  }): string =>
    `مجموع الكميات (المباع ${p.sold} + البونص ${p.bonus} + المرتجع السليم ${p.returned} + التالف ${p.damaged} + المتبقي الفعلي ${p.actual} = ${p.total} كجم) يتجاوز العهدة المستلمة أصلاً (${p.loaded} كجم). إن كانت الكمية الزائدة موجودة فعلاً في السيارة فأبلغ المحاسب: تسجيل الفائض يتم عند الاعتماد بإقرار صريح، لا من حساب المندوب.`,
  /**
   * 🚐 نصّ رفض الخادم `VAN_VEHICLE_COUNT_BELOW_OTHER_CUSTODY` بمعناه: النقصُ الزائد يخصّ
   * عهدةً أخرى، فلا يُحمَّل على هذا الأمر ولا يُشطب بصمت.
   */
  vehicleCountBelowOtherCustody: (p: { count: string; other: string }): string =>
    `عددُ السيارة المُعلن (${p.count} كجم) أقلّ من عهدة أوامرَ أخرى فيها (${p.other} كجم) — فالنقصُ الزائد يخصّ عهدةً أخرى: صحّح العدد، أو أَقفِل أمرَ العهدة الأخرى أوّلاً، أو قرّر فرقها صراحةً فيها. لا يُحمَّل على هذا الأمر ولا يُشطب بصمت.`,
  /** ‏أشدّ من الخادم عمداً: هو يقرأ النصّ التالف صفراً بصمت، والشاشة ترفضه. */
  qtyNotNumeric: (field: string): string =>
    `${field} يجب أن تكون رقمًا موجبًا أو صفرًا — الخادم يقرأ غير الرقمي صفرًا، فتُغلق العهدة على رقمٍ لم تكتبه.`,
} as const;

const FIELD_LABELS: Record<string, string> = {
  returnedQty: 'الكمية المرتجعة السليمة',
  damagedQty: 'الكمية التالفة',
  collectedCash: 'النقد المحصَّل',
  actualRemainingQty: 'المتبقي الفعلي بالجرد',
  vehicleCountQty: 'عددُ الصنف في السيارة كلها',
};

/**
 * 🚐 نصيبُ هذه العهدة من عدد المركبة كلها — معاينةٌ في المتصفح لقاعدة الخادم نفسها
 * (`resolveVehicleCountInTx` في `van-sales.service.ts`):
 *
 *     O = otherCustodyInVanQty (من اللوحة، وهي max(0, رصيد السيارة − متوقّع البقاء لهذا الأمر))
 *     A = max(0, V − O)
 *
 * والخادم يبقى المرجع الوحيد: يعيد الاشتقاق من الرصيد الرسمي الحيّ لحظة الإقفال، ويرفض 422 إن
 * كان V < O أو إن جُمع عددُ المركبة مع عددٍ لكلّ أمر في طلبٍ واحد.
 */
export function vehicleCountShare(draft: ClosingDraft): {
  declared: boolean;
  vehicleCount: Decimal;
  otherCustody: Decimal;
  /** نصيبُ هذه العهدة = ما يُقاس به العجز/الفائض وسقفُ العهدة ومصيرُ المتبقي. */
  share: Decimal;
  belowOtherCustody: boolean;
} {
  const text = (draft.vehicleCountQty ?? '').trim();
  const declared = text !== '';
  const vehicleCount = num(text);
  const otherCustody = Decimal.max(0, num(draft.otherCustodyInVanQty ?? '0'));
  return {
    declared,
    vehicleCount,
    otherCustody,
    share: Decimal.max(0, vehicleCount.minus(otherCustody)),
    belowOtherCustody: declared && vehicleCount.lt(otherCustody),
  };
}

/**
 * بناء حمولة تقديم الإقفال وحكمها — بترتيب الخادم: الأرقام، ثمّ سبب التلف، ثمّ سقف العهدة.
 *
 * والفراغ **ليس صفراً مكتوباً**: ما لم تملأه الشاشة لا يُرسل (`undefined`) فيأخذ الخادم
 * افتراضه هو، ولا يُخترع رقمٌ في المتصفح.
 */
/**
 * تحقّق الأرقام — مشتركٌ بين التقديم والاعتماد لأنّ الخادم يقرأ النصّ التالف صفراً فيهما.
 * وأمّا **سقف العهدة** فليس مشتركاً: تقديم المندوب يرفض الفائض (فثمّة يقع خطأ الإدخال)،
 * واعتماد المحاسب يقبله **بإقرارٍ صريح** (`VAN_CLOSING_SURPLUS_ACK_REQUIRED`) لأنّ كيلوات
 * موجودةً فعلاً في السيارة يجب أن تُسجَّل لا أن تُخفى — فوراثة الرفض هنا تمنع المحاسب من
 * تسجيل حقيقة.
 */
function numericTextFailure(
  draft: ClosingDraft,
): { ok: false; message: string; field: string } | null {
  const numericFields: Array<keyof ClosingDraft> = [
    'returnedQty',
    'damagedQty',
    'collectedCash',
    'actualRemainingQty',
    'vehicleCountQty',
    'otherCustodyInVanQty',
  ];
  for (const field of numericFields) {
    const raw = draft[field];
    const text = (typeof raw === 'string' ? raw : '').trim();
    if (!text) continue;
    if (!NUMERIC_TEXT.test(text) || num(text).lt(0)) {
      return {
        ok: false,
        message: CLOSING_MESSAGES.qtyNotNumeric(FIELD_LABELS[field] ?? field),
        field,
      };
    }
  }
  return null;
}

export function buildClosingPayload(
  draft: ClosingDraft,
  q: CustodyQuantities,
): ClosingVerdict {
  const numericFailure = numericTextFailure(draft);
  if (numericFailure) return numericFailure;

  const returnedQty = num(draft.returnedQty);
  const damagedQty = num(draft.damagedQty);
  const vehicleShare = vehicleCountShare(draft);
  if (vehicleShare.belowOtherCustody) {
    return {
      ok: false,
      message: CLOSING_MESSAGES.vehicleCountBelowOtherCustody({
        count: vehicleShare.vehicleCount.toFixed(2),
        other: vehicleShare.otherCustody.toFixed(2),
      }),
      field: 'vehicleCountQty',
    };
  }
  // مع عدد المركبة: نصيبُ هذه العهدة مشتقٌّ منه، وهو ما يُقاس به سقفُ العهدة.
  const actualRemainingQty = vehicleShare.declared
    ? vehicleShare.share
    : num(draft.actualRemainingQty);

  if (damagedQty.gt(0) && !draft.damageReason.trim()) {
    return { ok: false, message: CLOSING_MESSAGES.damageReasonRequired, field: 'damageReason' };
  }

  // سقف العهدة (UI-051): يُفحص عند العد الفردي للأمر فقط، ولا يُحجب عند عد المركبة كلها حيث يُترك
  // الاشتقاق من الرصيد الرسمي الحيّ والإقرار للخادم. السقف = الأساس + مرتجع العميل (ACC-188).
  const loaded = custodyCeiling(q);
  const accounted = accountedFor(q, draft.returnedQty, draft.damagedQty);
  const countedTotal = accounted.plus(actualRemainingQty);
  if (!vehicleShare.declared && loaded.gt(0) && countedTotal.gt(loaded)) {
    return {
      ok: false,
      message: CLOSING_MESSAGES.exceedsCustody({
        sold: num(q.soldQty).toFixed(2),
        bonus: num(q.bonusQty).toFixed(2),
        returned: returnedQty.toFixed(2),
        damaged: damagedQty.toFixed(2),
        actual: actualRemainingQty.toFixed(2),
        total: countedTotal.toFixed(2),
        loaded: loaded.toFixed(2),
      }),
      field: 'actualRemainingQty',
    };
  }

  return {
    ok: true,
    payload: {
      returnedQty: returnedQty.toFixed(4),
      damagedQty: damagedQty.toFixed(4),
      damageReason: orUndefined(draft.damageReason),
      collectedCash: draft.collectedCash.trim() ? num(draft.collectedCash).toFixed(4) : undefined,
      // ‏لا يُجمعان: عددُ المركبة وحده (والخادم يشتقّ النصيب) أو عددٌ لكلّ أمر وحده.
      actualRemainingQty: vehicleShare.declared
        ? undefined
        : draft.actualRemainingQty.trim()
          ? actualRemainingQty.toFixed(4)
          : undefined,
      vehicleCountQty: vehicleShare.declared
        ? vehicleShare.vehicleCount.toFixed(4)
        : undefined,
      closingNotes: orUndefined(draft.closingNotes),
    },
  };
}

/** مصير ما عاد مع المندوب — مفردات الخادم (`van_load_orders.remaining_action`). */
export const REMAINING_ACTIONS = ['return_to_main', 'carry_over'] as const;
export type RemainingAction = (typeof REMAINING_ACTIONS)[number];

export const REMAINING_ACTION_LABELS: Record<RemainingAction, string> = {
  return_to_main: 'إرجاع رسمي إلى المستودع الرئيسي',
  carry_over: 'يبقى عهدةً للوردية التالية',
};

export function remainingActionLabel(action: string | null | undefined): string {
  if (!action) return '—';
  const labels: Record<string, string> = REMAINING_ACTION_LABELS;
  return labels[action] ?? action;
}

/** مسودة الاعتماد — حقول `approveClosing` كما هي، ومنها علم تحميل العجز. */
export type ApprovalDraft = ClosingDraft & {
  damageInspected: boolean;
  /** ⚖️ القرار الصريح: هل يقع العجز مديونيةً على المندوب؟ بلا هذا العلم لا يُرحَّل قيد. */
  salaryDeductionApproved: boolean;
  remainingAction: string;
  /** 🖋️ تفويض ترحيل مستند الجرد الرسمي — بدونه يبقى مسودةً وتبقى العهدة معلّقة. */
  settleStockAdjustment: boolean;
  surplusAcknowledged: boolean;
  selfApprovalOverride: boolean;
  notes: string;
};

export type ApprovalPayload = {
  returnedQty?: string;
  damagedQty?: string;
  collectedCash?: string;
  /** 🚐 عددُ الصنف في السيارة كلها — بديلٌ عن `actualRemainingQty` لا رفيقٌ له. */
  vehicleCountQty?: string;
  damageInspected?: boolean;
  salaryDeductionApproved?: boolean;
  selfApprovalOverride?: boolean;
  notes?: string;
  actualRemainingQty?: string;
  remainingAction?: string;
  settleStockAdjustment?: boolean;
  surplusAcknowledged?: boolean;
};

export type ApprovalVerdict =
  | { ok: true; payload: ApprovalPayload }
  | { ok: false; message: string; field?: string };

/** نصوص `approveClosing` في الخادم حرفاً (‎:4214 و‎:4235 و‎:4273). */
export const APPROVAL_MESSAGES = {
  damageInspectionRequired:
    'لا يمكن اعتماد إغلاق الوردية بوجود كميات تالفة دون تأكيد الفحص الفعلي للتالف (damageInspected: true) من المحاسب أو أمين المستودع',
  alreadySettled: 'تم اعتماد وتصفية أمر التحميل هذا مسبقاً ولا يمكن إعادة ترحيله',
  selfApprovalForbidden:
    'منع الاعتماد الذاتي: لا يجوز لنفس مدخل طلب إغلاق العهدة اعتماد تسويته مالياً؛ يجب اعتماده من المحاسب أو مدير المستودع.',
  surplusAckRequired: (p: { actual: string; expected: string; surplus: string }): string =>
    `الجرد الفعلي (${p.actual} كجم) أكبر من المتبقي حسب المستندات (${p.expected} كجم) بفائض ${p.surplus} كجم — أكد الإقرار بالفائض (surplusAcknowledged) ليُسجَّل في مستند الجرد الرسمي`,
  remainingActionRequired: (actual: string): string =>
    `يوجد متبقٍ فعلي بالجرد (${actual} كجم) في سيارة المندوب: حدّد مصيره صراحةً — ` +
    '`return_to_main` لإرجاعه رسمياً إلى المستودع الرئيسي، أو `carry_over` لإبقائه عهدةً للوردية التالية. ' +
    'لا تُغلق العهدة مع بقاء كمية بلا قرار.',
} as const;

/**
 * بناء حمولة الاعتماد وحكمها — بترتيب الخادم: الفحص، ثمّ الفائض، ثمّ مصير المتبقي.
 *
 * و`salaryDeductionApproved` **تُرسل كما اختارها المحاسب** (لا تُستنتج): الخادم نفسه لا
 * يفترضها (`shortageQty > 0 ? body.salaryDeductionApproved === true : false`)، ومنذ الشريحة 4
 * هي الزناد الوحيد لقيد الذمّة — فرفعها قرارٌ ماليّ يُقال أثره قبل الضغط (‏`chargePreview`).
 */
export function buildApprovalPayload(
  draft: ApprovalDraft,
  q: CustodyQuantities,
): ApprovalVerdict {
  const numericFailure = numericTextFailure(draft);
  if (numericFailure) return numericFailure;

  const returnedQty = num(draft.returnedQty);
  const damagedQty = num(draft.damagedQty);
  const vehicleShare = vehicleCountShare(draft);
  if (vehicleShare.belowOtherCustody) {
    return {
      ok: false,
      message: CLOSING_MESSAGES.vehicleCountBelowOtherCustody({
        count: vehicleShare.vehicleCount.toFixed(2),
        other: vehicleShare.otherCustody.toFixed(2),
      }),
      field: 'vehicleCountQty',
    };
  }
  const actualRemainingQty = vehicleShare.declared
    ? vehicleShare.share
    : num(draft.actualRemainingQty);

  if (damagedQty.gt(0) && !draft.damageInspected) {
    return {
      ok: false,
      message: APPROVAL_MESSAGES.damageInspectionRequired,
      field: 'damageInspected',
    };
  }

  const loaded = custodyCeiling(q);
  const accounted = accountedFor(q, draft.returnedQty, draft.damagedQty);
  const countedTotal = accounted.plus(actualRemainingQty);
  if (countedTotal.gt(loaded) && !draft.surplusAcknowledged) {
    return {
      ok: false,
      message: APPROVAL_MESSAGES.surplusAckRequired({
        actual: actualRemainingQty.toFixed(2),
        expected: loaded.minus(accounted).toFixed(2),
        surplus: countedTotal.minus(loaded).toFixed(2),
      }),
      field: 'surplusAcknowledged',
    };
  }

  if (
    actualRemainingQty.gt(0) &&
    !(REMAINING_ACTIONS as readonly string[]).includes(draft.remainingAction.trim())
  ) {
    return {
      ok: false,
      message: APPROVAL_MESSAGES.remainingActionRequired(actualRemainingQty.toFixed(2)),
      field: 'remainingAction',
    };
  }

  // ‏جسم الاعتماد غير جسم التقديم: لا `damageReason` ولا `closingNotes` فيه (سبب التلف يكتبه
  // المندوب عند التقديم ويقرؤه المحاسب من الصفّ)، فتُبنى الحمولة صريحةً لا بنسخ التقديم.
  return {
    ok: true,
    payload: {
      returnedQty: returnedQty.toFixed(4),
      damagedQty: damagedQty.toFixed(4),
      collectedCash: draft.collectedCash.trim() ? num(draft.collectedCash).toFixed(4) : undefined,
      actualRemainingQty: vehicleShare.declared
        ? undefined
        : draft.actualRemainingQty.trim()
          ? actualRemainingQty.toFixed(4)
          : undefined,
      vehicleCountQty: vehicleShare.declared
        ? vehicleShare.vehicleCount.toFixed(4)
        : undefined,
      damageInspected: draft.damageInspected,
      salaryDeductionApproved: draft.salaryDeductionApproved,
      selfApprovalOverride: draft.selfApprovalOverride || undefined,
      notes: orUndefined(draft.notes),
      remainingAction: orUndefined(draft.remainingAction.trim()),
      settleStockAdjustment: draft.settleStockAdjustment,
      surplusAcknowledged: draft.surplusAcknowledged,
    },
  };
}

/**
 * 🧮 الفصل الرباعي — القاعدة التي لا تُكسر: مرتجعٌ سليم، وتالف، وعجز، ومتبقٍ فعلي. أربعة
 * أرقامٍ لا رقمٌ واحد «مفقود»، وكلّ واحدٍ له مصيرٌ ومسؤوليةٌ مختلفان. والأرقام من صفّ الخادم
 * (‏`expectedRemainingQty`/`actualRemainingQty`/`countVarianceQty`/`shortageQty`) لا من حساب
 * المتصفح — فالشاشة تعرض ما قاله الخادم، وتضيف التسمية لا الرقم.
 */
export type SeparationRow = {
  soldQty?: string | number | null;
  bonusQty?: string | number | null;
  returnedQty?: string | number | null;
  damagedQty?: string | number | null;
  shortageQty?: string | number | null;
  actualRemainingQty?: string | number | null;
  expectedRemainingQty?: string | number | null;
  countVarianceQty?: string | number | null;
};

export type FourWaySeparation = {
  sold: string;
  bonus: string;
  returned: string;
  damaged: string;
  /** موجب = عجز عن الجرد (لا يُدمج مع التالف ولا مع المرتجع). */
  shortage: string;
  /** سالب `countVarianceQty` = فائض عن المستندات (إقرارٌ صريح، لا إيراد ولا هدية). */
  surplus: string;
  actualRemaining: string;
  expectedRemaining: string;
  countVariance: string;
  hasSurplus: boolean;
  hasShortage: boolean;
};

export function fourWaySeparation(row: SeparationRow): FourWaySeparation {
  const variance = num(row.countVarianceQty);
  const actualRemaining = num(row.actualRemainingQty);
  return {
    sold: num(row.soldQty).toFixed(2),
    bonus: num(row.bonusQty).toFixed(2),
    returned: num(row.returnedQty).toFixed(2),
    damaged: num(row.damagedQty).toFixed(2),
    shortage: num(row.shortageQty).toFixed(2),
    surplus: variance.lt(0) ? variance.abs().toFixed(2) : '0.00',
    actualRemaining: actualRemaining.toFixed(2),
    expectedRemaining: num(row.expectedRemainingQty).toFixed(2),
    countVariance: variance.toFixed(2),
    hasSurplus: variance.lt(0),
    hasShortage: num(row.shortageQty).gt(0),
  };
}

/** `van_load_orders.shortage_policy_status` — نصٌّ حرّ (بلا قيد CHECK في الترحيل 0122). */
export const SHORTAGE_POLICY_STATUSES = [
  'pending_policy_approval',
  'policy_configured',
  'charged_to_employee',
] as const;
export type ShortagePolicyStatus = (typeof SHORTAGE_POLICY_STATUSES)[number];

export const SHORTAGE_POLICY_STATUS_LABELS: Record<ShortagePolicyStatus, string> = {
  pending_policy_approval: 'بانتظار سياسة التقييم',
  policy_configured: 'السياسة مضبوطة (لم يُعتمد التحميل)',
  /** ‏الشريحة 4: العلم صار دليلاً — رُحِّل قيدٌ على ذمّة الموظف. */
  charged_to_employee: 'محمَّل على ذمّة الموظف (رُحِّل قيد)',
};

/** قيمةٌ غير معروفة تُعرض خاماً — أصدق من تسميةٍ مخترَعة تُخفي أنّ الشاشة لا تعرف. */
export function shortagePolicyStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const labels: Record<string, string> = SHORTAGE_POLICY_STATUS_LABELS;
  return labels[status] ?? status;
}

/**
 * الأساس الذي قُيِّم به العجز **فعلاً** (`van_load_orders.shortage_charge_basis`) — سلسلة
 * `resolveShortageUnitPriceInTx` بترتيبها: سعرٌ صريح في السياسة، ثمّ التكلفة إن كانت السياسة
 * `unit_cost` (من دفعة الإنتاج، وإلا فمتوسط تكلفة الرصيد الرسمي لمستودع المصدر ثمّ للسيارة ثمّ
 * تكلفة الصنف في بطاقته — كي لا ينقلب قرار «بالتكلفة» سعرَ بيعٍ لحمولةٍ بلا دفعة)، ثمّ متوسط
 * أسعار مستندات الأمر، ثمّ سعر الصنف، ثمّ متوسط الحمولة.
 */
export const CHARGE_BASES = [
  'explicit_policy_price',
  'unit_cost',
  'stock_average_cost',
  'average_document_price',
  'item_sale_price',
  'item_purchase_price',
  'loaded_average',
  'load_order_unit_cost',
  /** تكلفةُ مستندات الأمر — ملاذُ سياسة «التكلفة» لأمرٍ بلا صنف (ولا سعرَ بيعٍ عندها). */
  'document_unit_cost',
] as const;
export type ChargeBasis = (typeof CHARGE_BASES)[number];

export const CHARGE_BASIS_LABELS: Record<ChargeBasis, string> = {
  explicit_policy_price: 'سعرٌ صريح في السياسة',
  unit_cost: 'التكلفة (قرار السياسة)',
  stock_average_cost: 'متوسط تكلفة الرصيد الرسمي (حمولةٌ بلا دفعة إنتاج)',
  average_document_price: 'متوسط سعر البيع في مستندات الأمر',
  item_sale_price: 'سعر بيع الصنف',
  item_purchase_price: 'سعر شراء الصنف',
  loaded_average: 'متوسط قيمة الحمولة',
  load_order_unit_cost: 'تكلفة أمر التحميل',
  document_unit_cost: 'تكلفةُ مستندات الأمر (أمرٌ بلا صنفٍ في بطاقته)',
};

export function chargeBasisLabel(basis: string | null | undefined): string {
  if (!basis) return '—';
  const labels: Record<string, string> = CHARGE_BASIS_LABELS;
  return labels[basis] ?? basis;
}

/** `van_sales.policy.shortageValuationBasis` — ما تكتبه `PUT /van-sales/policy`. */
export const VALUATION_BASES = ['unconfigured', 'unit_cost', 'selling_price'] as const;
export type ValuationBasis = (typeof VALUATION_BASES)[number];

export const VALUATION_BASIS_LABELS: Record<ValuationBasis, string> = {
  unconfigured: 'بلا سياسة (يُقاس بسلسلة الاحتياط)',
  unit_cost: 'بالتكلفة',
  selling_price: 'بسعر البيع',
};

export function valuationBasisLabel(basis: string | null | undefined): string {
  if (!basis) return '—';
  const labels: Record<string, string> = VALUATION_BASIS_LABELS;
  return labels[basis] ?? basis;
}

/**
 * تسمية `valuationSource` من `GET /van-sales/policy` — وهو إمّا أساسُ السياسة
 * (‏`unit_cost`/`selling_price`/`unconfigured`) أو `explicit_policy_price` حين يتقدّم سعرٌ
 * مكتوب على الأساس. فالقاموسان يُستشاران بالترتيب، وقيمةٌ غير معروفة تُعرض خاماً.
 */
export function valuationSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  const policyLabels: Record<string, string> = VALUATION_BASIS_LABELS;
  const chargeLabels: Record<string, string> = CHARGE_BASIS_LABELS;
  return policyLabels[source] ?? chargeLabels[source] ?? source;
}

/**
 * ⚖️ أثر القرار **قبل** الضغط — الأمانة التي طلبها المالك: لا يُعتمد تحميلٌ ماليّ على
 * موظفٍ دون أن يُقال كم، وعلى أيّ حساب، وبأيّ أساس، وهل سيُرفض.
 *
 * المبلغ من الخادم لا من الشاشة: `shortageValue` (بسياسة التقييم) و`countVarianceCostValue`
 * (على أساس التكلفة) يُكتبان عند تقديم الإقفال. وقبل التقديم لا رقم — فتقول الشاشة ذلك بدل
 * أن تخترع تقديراً.
 */
export type ChargeRow = {
  shortageQty?: string | number | null;
  shortageValue?: string | number | null;
  countVarianceCostValue?: string | number | null;
  shortageChargeAmount?: string | number | null;
  shortageChargeBasis?: string | null;
  shortageJournalEntryId?: string | null;
  salaryDeductionApproved?: boolean | null;
  salesmanId?: string | null;
};

export type ChargeReadiness = {
  employeeLinked?: boolean | null;
  employeeAccountReady?: boolean | null;
  employeeAccountName?: string | null;
  creditAccountMapped?: boolean | null;
  creditAccountName?: string | null;
  ready?: boolean | null;
  blockingReason?: string | null;
};

export type ChargePreview = {
  /** هل سيُرحَّل قيد فعلاً عند هذا الاعتماد؟ */
  willPost: boolean;
  /** القيد رُحِّل من قبل — فتُعرض نتيجته لا وَعده. */
  posted: boolean;
  amountText: string;
  costValueText: string;
  basisText: string;
  debitText: string;
  creditText: string;
  /** مانعٌ معلوم قبل الضغط (‏`GET /van-sales/policy?salesmanId=`)، وإلا `null`. */
  blockingReason: string | null;
};

export function chargePreview(
  row: ChargeRow,
  readiness: ChargeReadiness | null | undefined,
  deductionApproved: boolean,
): ChargePreview {
  const shortageQty = num(row.shortageQty);
  const posted = Boolean(row.shortageJournalEntryId);
  const willPost = !posted && deductionApproved && shortageQty.gt(0);
  const chargeValue = num(row.shortageChargeAmount ?? row.shortageValue);
  const hasChargeValue = chargeValue.gt(0);
  const employeeAccount = readiness?.employeeAccountName ?? null;
  const creditAccount = readiness?.creditAccountName ?? null;

  return {
    willPost,
    posted,
    amountText: hasChargeValue ? chargeValue.toFixed(2) : '—',
    costValueText: num(row.countVarianceCostValue).gt(0)
      ? num(row.countVarianceCostValue).toFixed(2)
      : '—',
    basisText: chargeBasisLabel(row.shortageChargeBasis ?? null),
    debitText: employeeAccount ?? (willPost ? 'حساب الموظف المرتبط بالمندوب' : '—'),
    creditText: creditAccount ?? (willPost ? 'الحساب الدائن المربوط لـ van_shortage_charge' : '—'),
    blockingReason:
      willPost && readiness?.ready === false
        ? (readiness.blockingReason ?? 'مانعٌ غير معروف')
        : null,
  };
}

/**
 * هل يُعرض إجراءٌ على الصفّ؟ مرآةٌ لرفض الخادم لا حكمٌ مستقل: تُخفي إجراءً مآله 409 مؤكّد
 * (`VAN_LOAD_ORDER_ALREADY_SETTLED`)، والخادم يبقى القاضي.
 */
export function canSubmitClosing(row: { status?: string | null }): boolean {
  return row.status === 'loaded' || row.status === 'in_route';
}

export function canApproveClosing(row: { status?: string | null }): boolean {
  return row.status === 'pending_closing';
}

/** استكمال تسويةٍ معلّقة: الكميات اعتُمدت والمستند الرسمي لم يكتمل. */
export function canSettleStock(row: {
  status?: string | null;
  stockSettlementStatus?: string | null;
}): boolean {
  return (
    row.status === 'pending_stock_settlement' ||
    row.stockSettlementStatus === 'pending_count_decision'
  );
}

/** فرق العبور (استلامٌ ناقص) قرارٌ مستقلّ عن الإقفال — ولا تُغلق عهدةٌ قبله. */
export function canCloseTransitDifference(row: {
  status?: string | null;
  stockSettlementStatus?: string | null;
  discrepancyQty?: string | number | null;
}): boolean {
  return (
    row.stockSettlementStatus === 'pending_transit_decision' ||
    (row.status === 'loaded' && num(row.discrepancyQty).gt(0))
  );
}

/**
 * 🚫 القاعدة التي لا تُكسر: **لا تُغلق عهدةٌ بفرق مخزونٍ غير مُسوّى**. الصفّ الذي ما زالت
 * تسويته معلّقة يُعرض مفتوحاً مع سببه (‏`stockSettlementNote` من الخادم) ولا يُعرض إجراءُ
 * إغلاقٍ يوحي بأنّه اكتمل.
 */
export function unsettledStockReason(row: {
  stockSettlementStatus?: string | null;
  status?: string | null;
  stockSettlementNote?: string | null;
}): string | null {
  const status = row.stockSettlementStatus ?? 'not_required';
  if (status === 'not_required' || status === 'settled_officially') return null;
  const note = row.stockSettlementNote?.trim();
  if (note) return note;
  if (status === 'pending_transit_decision') {
    return 'فرق العبور لم يُحسم: إما تأكيد استلام الباقي أو إغلاق المناقلة بمرتجع رسمي.';
  }
  if (status === 'pending_count_decision') {
    return 'مستند الجرد الرسمي لم يُرحَّل: فوّض الترحيل من «استكمال تسوية المخزون».';
  }
  if (status === 'blocked_missing_accounts') {
    return 'حسابات المخزون ناقصة في ملف الترحيل — لا تُرحَّل تسويةٌ بلا طرفين.';
  }
  return status;
}

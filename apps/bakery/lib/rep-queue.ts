/**
 * 🚐 طابورُ المندوب — **منطقٌ نقيّ**: ما يُحفظ دون اتصال، وما لا يُحفظ ولماذا، وكيف تُقرأ
 * نتيجةُ الإعادة، وما تقولُه الشاشةُ قبل أن يضغط المندوب.
 *
 * ولا سطرَ شبكةٍ ولا IndexedDB هنا: التخزينُ في `@erp/web-core/offline-db` (مخزن `vanQueue`)
 * والمفاتيحُ في `@erp/web-core/idempotency` — وما هنا القرارُ والحكم، وكلاهما قابلٌ
 * للاختبار بلا متصفّح.
 *
 * والقاعدتان اللتان بُني عليهما كلّ شيء، وكلاهما **مقاسةٌ في الخادم** لا مفترضة:
 *
 * 1. **الإعادةُ الآمنة تحتاج مفتاحًا في الجسم.** فـ`POST /van-sales/documents` و
 *    ‏`…/documents/:id/returns` و`…/collections` تقبل `idempotencyKey` في الجسم، والخادمُ
 *    يفحصه ويعيد بلا أثرٍ ثانٍ: ‏`createDocument` ⇒ `if (existing) return this.dashboard(…)`
 *    (‏٢٠١ وبلا مستندٍ جديد)، والمرتجعُ ⇒ ٢٠١ وبلا تغيير (مقاسٌ في
 *    `van-sales-stock-acceptance.spec.ts`). وأمّا `submit-closing` و`confirm-receipt`
 *    **فلا مفتاحَ في جسميهما** ⇒ لا يُحفظان في الطابور إطلاقًا (انظر
 *    `NOT_QUEUEABLE_OPERATIONS` للسببين المقاسَين، وهما مختلفان).
 * 2. **لا مزامنةَ جماعية في التوزيع.** فلا يوجد `POST /van-sales/offline-sync` (و`…/pos/
 *    offline-sync` خاصٌّ بنقطة البيع وجسمُه `OfflineCheckoutPayload`) — فالإعادةُ نيّةٌ
 *    نيّةً إلى مسارها الرسميّ نفسه، والخادمُ هو السلطةُ بعدها.
 *
 * وربطُ الجهاز: `deviceId` من `meta` المشتركة في `@erp/web-core/offline-db` (لا هويّةَ
 * ثانية)، ويظهر على الشاشة — وهو **وسمُ تتبّعٍ لا حدٌّ أمنيّ**: فمن يمسح تخزينَ المتصفّح
 * يأخذ هويّةً جديدة، وتسجيلُ الأجهزة في الخادم قرارٌ معلّقٌ في سجلّ البنود المفتوحة (أ٥).
 */
import {
  newSubmissionNonce,
  submissionIdempotencyKey,
  SUBMISSION_KEY_MAX_LENGTH,
} from '@erp/web-core/idempotency';
import type { VanQueueOperation, VanQueueRecord, VanQueueStatus } from '@erp/web-core/offline-db';
import { formatRequiredPermissionsAr } from './permissions-ar';

/** رموزُ الصلاحية كما في `van-sales.controller.ts` — حرفًا، فإخفاءُ الزرّ ليس ضبطًا. */
export const REP_PERMISSIONS = {
  view: 'van_sales.view',
  invoice: 'van_sales.invoice.create',
  collection: 'van_sales.collection.create',
  closing: 'van_sales.closing.submit',
} as const;

/** عمليتان مرفوضتان من الطابور — لكلٍّ سببُها المقاس. */
export type OfflineOnlyOperation = 'closing' | 'receipt';

export type RepOperation = VanQueueOperation | OfflineOnlyOperation;

type QueueableSpec = {
  labelAr: string;
  /** بادئةُ المفتاح: جزءٌ يُقرأ في السجلات، ونمطُها `^[a-z0-9][a-z0-9-]*$`. */
  keyPrefix: string;
  permission: string;
  /** المسارُ بلا `/api/v1` (يضيفه `apiPost`). والمرتجعُ يحتاج مستنده المصدر في المسار. */
  endpointOf: (targetId?: string | null) => string;
};

/**
 * ما يُحفظ في الطابور. والمساراتُ والبادئاتُ والصلاحياتُ هي نفسها المستعملةُ في بقية
 * أوجه التوزيع (`van-document`/‏`van-return`/‏`van-collection` في شاشات المكتب، و`rep-sale`/
 * `rep-collect` في شاشة المندوب بالطاقم) — وبادئاتُ هذا الوجه `rep-*` كي يُقرأ في السجلّ
 * أنّ النيّةَ جاءت من تطبيق المندوب لا من شاشة المكتب، والمفتاحُ نفسه لا يتصادم لأنّ
 * بصمةَ الحمولة ورقمَ المحاولة جزءان منه.
 */
export const QUEUEABLE_OPERATIONS: Readonly<Record<VanQueueOperation, QueueableSpec>> = {
  document: {
    labelAr: 'مستند بيع',
    keyPrefix: 'rep-document',
    permission: REP_PERMISSIONS.invoice,
    endpointOf: () => '/van-sales/documents',
  },
  return: {
    labelAr: 'مرتجع عميل',
    keyPrefix: 'rep-return',
    permission: REP_PERMISSIONS.invoice,
    endpointOf: (documentId) => `/van-sales/documents/${documentId ?? ''}/returns`,
  },
  collection: {
    labelAr: 'تحصيل من عميل',
    keyPrefix: 'rep-collection',
    permission: REP_PERMISSIONS.collection,
    endpointOf: () => '/van-sales/collections',
  },
};

/**
 * ما **لا** يُحفظ في الطابور — والسببان مقاسان ومختلفان، فلا يُقال «غير آمن» على عواهنه:
 *
 * ‏- **الإقفال**: جسمُه `{returnedQty, damagedQty, damageReason, collectedCash,
 *   actualRemainingQty, vehicleCountQty, closingNotes}` **بلا `idempotencyKey`**، وحرّاسُ
 *   `submitClosing` هي ٤٠٤ و٤٠٩ `VAN_LOAD_ORDER_ALREADY_SETTLED` (إذا صارت الحالةُ
 *   ‏`settled` فقط) و٤٢٢ على الكميات وسبب التلف — فإعادةٌ عمياء والأمرُ ما زال
 *   ‏`pending_closing` **تعيد كتابةَ إعلان المندوب** بدل أن تُرفض. وهو إعلانُ جردٍ يترتّب
 *   عليه اعتمادُ المحاسب ومديونيةُ العجز، فلا يُرسل من طابورٍ يُعيد ما حفظه.
 * ‏- **الاستلام**: جسمُه `{receivedQty, notes}` بلا مفتاحٍ كذلك، لكنّ له حارسَ حالة:
 *   ‏`status !== 'pending_receipt'` ⇒ ٤٠٩ `VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT` («تم تأكيد
 *   استلام أمر التحميل هذا مسبقًا ولا يمكن تكرار الاستلام»). فالإعادةُ **لا تُحرّك البضاعة
 *   مرّتين** — لكنّ نيّةً نجحت تظهر للمندوب خطأً، والاستلامُ قرارٌ على بضاعةٍ واقفةٍ أمامه
 *   يؤكّدها لحظةَ عودة الشبكة لا من طابور.
 */
export const NOT_QUEUEABLE_OPERATIONS: Readonly<
  Record<OfflineOnlyOperation, Omit<QueueableSpec, 'keyPrefix'> & { reasonAr: string }>
> = {
  closing: {
    labelAr: 'إغلاق الوردية',
    permission: REP_PERMISSIONS.closing,
    endpointOf: (loadOrderId) => `/van-sales/load-orders/${loadOrderId ?? ''}/submit-closing`,
    reasonAr:
      'إغلاقُ الوردية لا يُحفظ دون اتصال: فمساره لا يحمل مفتاحَ عدم تكرار، والخادمُ لا يرفض إعادةَ الإرسال ما دام الأمرُ بانتظار الإقفال — فإعادةٌ عمياء تعيد كتابةَ إعلان الجرد الذي يترتّب عليه اعتمادُ المحاسب ومديونيةُ العجز. وأرسله لحظةَ عودة الشبكة وأنت تنظر إلى السيارة.',
  },
  receipt: {
    labelAr: 'تأكيد استلام توريد',
    permission: REP_PERMISSIONS.view,
    endpointOf: (loadOrderId) => `/van-sales/load-orders/${loadOrderId ?? ''}/confirm-receipt`,
    reasonAr:
      'تأكيدُ الاستلام لا يُحفظ دون اتصال: فمساره لا يحمل مفتاحَ عدم تكرار، وإعادةُ إرساله تُرفض ٤٠٩ («تم تأكيد استلام أمر التحميل هذا مسبقًا») فتظهر نيّةٌ ناجحةٌ للمندوب خطأً. والبضاعةُ أمامك: أكِّد استلامَها لحظةَ عودة الشبكة.',
  },
};

/** نصوصُ هذا الوجه بالعربية الواضحة دون إظهار رموز الصلاحيات التقنية. */
export const REP_QUEUE_MESSAGES = {
  /** نصُّ عدم توفّر الصلاحية بالعربية. */
  permissionRequired: (codes: readonly string[]) => formatRequiredPermissionsAr(codes),
  storedOffline: (labelAr: string) =>
    `حُفظت النيّةُ محليًّا (${labelAr}) وستُرسل إلى مسارها الرسميّ لحظةَ عودة الشبكة بمفتاحِ عدم تكرارٍ واحد — فلا مستندَ مكرَّر ولو أُعيد الإرسال مرّات.`,
  offlineNumbersAreStale:
    'الأرقامُ المعروضة من آخر قراءةٍ ناجحة: فالطابورُ يحفظ النيّات ولا يحسب المجاميع — والمجاميعُ من الخادم وحده (`totals` و`custody` في `/van-sales/me`).',
  deviceLine: (deviceId: string | null) =>
    deviceId
      ? `جهازُ هذا المتصفّح: ${deviceId} — وسمُ تتبّعٍ يظهر في مفاتيح عدم التكرار، وليس حدًّا أمنيًّا: فمن مسح تخزينَ المتصفّح أخذ هويّةً جديدة.`
      : 'لم يُنشأ بعدُ وسمُ جهازٍ لهذا المتصفّح — يُنشأ عند أوّل نيّةٍ محفوظة.',
  nothingQueued: 'لا نيّاتٍ محفوظة: كلّ ما أرسلتَه وصل.',
} as const;

/** المسارُ الرسميّ لعمليّةٍ — ولا يُخترع مسارُ مزامنةٍ جماعية. */
export function endpointFor(operation: RepOperation, targetId?: string | null): string {
  if (operation === 'closing' || operation === 'receipt')
    return NOT_QUEUEABLE_OPERATIONS[operation].endpointOf(targetId);
  return QUEUEABLE_OPERATIONS[operation].endpointOf(targetId);
}

/**
 * مفتاحُ النيّة — **يُبنى مرّةً واحدةً عند الحفظ** ويُخزَّن مع الجسم، فتستعمله كلّ إعادة.
 * وهو `submissionIdempotencyKey` نفسه (‏`<بادئة>:<بصمة الحمولة>:<رقم محاولة>`) الذي تبنيه
 * شاشاتُ المكتب من `useSubmissionKey` — فلا مخطّطَ مفاتيحَ ثانٍ في المنتج.
 */
export function buildQueueIdempotencyKey(
  operation: VanQueueOperation,
  body: Record<string, unknown>,
): string {
  const { keyPrefix } = QUEUEABLE_OPERATIONS[operation];
  const key = submissionIdempotencyKey(keyPrefix, body, newSubmissionNonce());
  if (key.length > SUBMISSION_KEY_MAX_LENGTH)
    throw new Error(`مفتاحُ النيّة أطول من ${SUBMISSION_KEY_MAX_LENGTH} حرفًا`);
  return key;
}

/** نتيجةُ محاولةِ إعادة: هل وصلت، أم رُفضت، أم لم تصل بعد؟ */
export type ReplayOutcome = {
  nextStatus: VanQueueStatus;
  /** سببٌ مقروءٌ يُسجَّل في `lastMessage` حين لا تكون للخادم رسالة. */
  reasonAr: string;
};

/**
 * تصنيفُ نتيجة الإعادة — والحالاتُ مقاسةٌ من غلاف الخطأ RFC-9457 (‏`code` و`detail`) ومن
 * سلوك المعترِضات:
 *
 * ‏- ‏٢٠٠/٢٠١ ⇒ وصلت (ومنها إعادةُ المفتاح نفسه: فالخادمُ يعيد ٢٠١ بلا أثرٍ ثانٍ).
 * ‏- ٤٠٩ `IDEMPOTENCY_REPLAY` ⇒ **مرفوضةٌ وتُقال**: فالمفتاحُ نفسه استُعمل بحمولةٍ مختلفة
 *   (أو الطلبُ ما زال في الطيران) — ومعناه أنّ نيّةً محفوظةً عُدِّلت بعد حفظها، وهذا يحتاج
 *   المندوب لا إعادةً عمياء.
 * ‏- ٤٢٢/٤٠٣/٤٠٤ وسائر ٤٠٩ ⇒ مرفوضةٌ برسالة الخادم العربية كما هي.
 * ‏- ٥٠٠ وما فوقها، وبلا حالةٍ أصلًا (انقطاعُ الشبكة) ⇒ **تبقى `pending`**: فالنيّةُ لم
 *   تُرفض، بل لم تصل — ورفضُها محليًّا يعني ضياعَ بيعٍ لم يقل أحدٌ إنّه مرفوض.
 */
export function classifyReplay(response: {
  status?: number | null;
  code?: string | null;
  detail?: string | null;
}): ReplayOutcome {
  const status = typeof response.status === 'number' ? response.status : null;
  const detail = response.detail?.trim() || '';
  if (status === null)
    return { nextStatus: 'pending', reasonAr: 'لم تصل النيّةُ إلى الخادم (انقطاع شبكة) — تبقى في الطابور.' };
  if (status >= 200 && status < 300)
    return { nextStatus: 'synced', reasonAr: detail || 'وصلت النيّةُ إلى الخادم.' };
  if (status >= 500)
    return { nextStatus: 'pending', reasonAr: `خطأُ خادمٍ (${status}) — النيّةُ لم تُرفض فتبقى في الطابور.` };
  if (response.code === 'IDEMPOTENCY_REPLAY')
    return {
      nextStatus: 'refused',
      reasonAr:
        detail ||
        'المفتاحُ نفسه استُعمل بحمولةٍ مختلفة — النيّةُ عُدِّلت بعد حفظها وتحتاج قرار المندوب، لا إعادةً عمياء.',
    };
  return {
    nextStatus: 'refused',
    reasonAr: detail || `رفضَ الخادمُ النيّةَ (${status}).`,
  };
}

/**
 * خطّةُ المزامنة: ما يُعاد فعلًا، وبالترتيب الذي أُدخل به. فالمرتجعُ بعد مستنده والتحصيلُ
 * بعد فاتورته — وترتيبُ `sequenceNo` تصاعديًّا هو ما يضمن ذلك بلا تواريخ.
 */
export function syncPlan(records: readonly VanQueueRecord[]): VanQueueRecord[] {
  return records
    .filter((record) => record.status === 'pending')
    .sort((left, right) => left.sequenceNo - right.sequenceNo);
}

export type QueueCounts = { pending: number; synced: number; refused: number; total: number };

export function countQueue(records: readonly VanQueueRecord[]): QueueCounts {
  return {
    pending: records.filter((record) => record.status === 'pending').length,
    synced: records.filter((record) => record.status === 'synced').length,
    refused: records.filter((record) => record.status === 'refused').length,
    total: records.length,
  };
}

/** سطرُ الحالة للشاشة — فالمرفوضُ يُقال ولا يُخفى خلف رقمٍ إجماليّ. */
export function queueSummaryLine(counts: QueueCounts): string {
  if (counts.total === 0) return REP_QUEUE_MESSAGES.nothingQueued;
  const parts = [
    counts.pending > 0 ? `${counts.pending} بانتظار الإرسال` : null,
    counts.refused > 0 ? `${counts.refused} مرفوضةٌ تحتاج قرار المندوب` : null,
    counts.synced > 0 ? `${counts.synced} وصلت` : null,
  ].filter((part): part is string => part !== null);
  return `في الطابور ${counts.total} نيّة: ${parts.join(' · ')}.`;
}

export type QueueVerdictInput = {
  online: boolean;
  operation: RepOperation;
  /** دالةُ الصلاحية من الجلسة (`useSession().can`) — فالحكمُ هنا لا يستبدل حارسَ الخادم. */
  can: (permission: string) => boolean;
  /** للمستندات التي تحتاج هدفًا في المسار (مرتجعٌ على مستند، إقفالٌ على أمر). */
  targetId?: string | null;
};

export type QueueVerdict = { blocked: string[]; warnings: string[] };

/**
 * حكمُ ما قبل الإرسال **في بُعد الطابور وحده**: فالكمياتُ والأسعارُ وسقفُ الائتمان أحكامُ
 * `documentVerdict` في `sales-screen.ts` ولا تُعاد هنا (نسخةٌ ثانيةٌ من حكمٍ ماليّ تتباعد)،
 * وما هنا: هل الشبكةُ قائمة؟ وهل العمليّةُ قابلةٌ للحفظ أصلًا؟ وهل للمندوب الصلاحية؟
 *
 * والحكمُ **محليٌّ استباقيّ** لا ضبطًا: فالخادمُ هو الذي يرفض، وإخفاءُ الزرّ ليس ضبطًا.
 */
export function queueVerdict(input: QueueVerdictInput): QueueVerdict {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const spec =
    input.operation === 'closing' || input.operation === 'receipt'
      ? NOT_QUEUEABLE_OPERATIONS[input.operation]
      : QUEUEABLE_OPERATIONS[input.operation];

  if (!input.can(spec.permission)) blocked.push(REP_QUEUE_MESSAGES.permissionRequired([spec.permission]));

  if (!input.online) {
    if (input.operation === 'closing' || input.operation === 'receipt') {
      blocked.push(NOT_QUEUEABLE_OPERATIONS[input.operation].reasonAr);
    } else {
      warnings.push(REP_QUEUE_MESSAGES.storedOffline(spec.labelAr));
      warnings.push(REP_QUEUE_MESSAGES.offlineNumbersAreStale);
    }
  }

  if (
    (input.operation === 'return' || input.operation === 'closing' || input.operation === 'receipt') &&
    !input.targetId
  ) {
    blocked.push(
      input.operation === 'return'
        ? 'حدّد مستندَ البيع الأصلي للمرتجع'
        : 'حدّد أمرَ التحميل المطلوب',
    );
  }

  return { blocked, warnings };
}

/** هل النيّةُ قابلةٌ للحفظ دون اتصال؟ — سؤالُ الشاشة قبل أن تُخفي زرًّا أو تُعطّله. */
export function isQueueable(operation: RepOperation): operation is VanQueueOperation {
  return operation !== 'closing' && operation !== 'receipt';
}

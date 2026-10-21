import { Decimal } from 'decimal.js';

import type { DashboardWindows } from './dashboard-windows';
import {
  decimalOrNull,
  documentRemaining,
  hasOpenDebt,
  type DocumentRow,
  type PostingReadiness,
  type Verdict,
} from './sales-screen';

/**
 * 💵 منطق شاشة «التحصيل» النقيّ — ما يُحصَّل، ممّن، و**هل وصل السند إلى الأستاذ**.
 *
 * القاعدة المحاسبية التي تحكم الشاشة: تحصيلٌ لا يُرحَّل سندُه ليس مالًا في الدفاتر، فهو
 * وعد. والخادم نفسه يقول ذلك: يُنشئ سند قبضٍ ويرحّله **فقط** حين ينحلّ حساب ذمم العملاء
 * (من بطاقة العميل ثمّ من ملف ترحيل الفرع)، وإلا بقي السند مسودةً وتُكتب الجملة في سبب
 * الحركة («مسجّل (غير مُرحَّل — يلزم تحديد حساب ذمم العملاء)»). ولهذا تقرأ الشاشة سبب أحدث
 * حركة `collection_receipt` بعد السند وتقول حالته **بنصّ الخادم**، لا باستنتاجٍ من عندها.
 *
 * والأرقام: المتبقي على الفاتورة (`total − paidAmount`) يُحسب بـ`decimal.js` للعرض ويُسمّى
 * محسوبًا؛ وجملةُ «مبلغ التحصيل يتجاوز الرصيد المتبقي» تُبنى بالأرقام نفسها التي يبنيها
 * الخادم (‏`toFixed(2)` للطرفين) فتنطبق على رفضه حرفاً؛ وأمّا مجموع الذمم المعروض فمجموعُ
 * **نافذة اللوحة** (أحدث ١٢٠ مستندًا) ويُقال ذلك، ومجموعُ المنشأة من `summary` الذي حسبه
 * الخادم (`totalCreditReceivablesSar`).
 */

/** حركة مخزون/أستاذ من `dashboard.movements` — منها يُقرأ سبب سند القبض كما كتبه الخادم. */
export type MovementRow = {
  id: string;
  movementType: string;
  batchNo: string;
  qty: string;
  unitPrice: string;
  amount: string;
  reason: string;
  voucherId: string | null;
  salesmanName: string;
  customerName: string;
  actorLabel: string;
  approvedByLabel: string;
  createdAt: string;
};

export type CollectionDashboard = {
  postingReadiness: PostingReadiness;
  /**
   * ‏وذممُ المنشأة **صافيةٌ من المرتجعات**: فالإشعارُ الدائن يُخصم من ذمّة العميل كما
   * يخصمها القيدُ الرسميّ (Cr «عميل عام»). وأطرافُ المرتجعات معروضةٌ بجانبها فلا يُقرأ
   * رقمٌ صافٍ كأنّ مرتجعًا لم يحدث.
   */
  summary: {
    totalCollectedCashSar: string;
    totalCreditReceivablesSar: string;
    totalSalesGrossSar: string;
    totalReturnsSar: string;
    totalReturnsVatSar: string;
    returnDocumentCount: number;
    returnsWithoutCostCount: number;
  };
  documents: DocumentRow[];
  movements: MovementRow[];
  /** نوافذُ الخادم المعلنة — انظر `SalesDashboard.windows`. */
  windows?: DashboardWindows | null;
};

/** نصوصُ الخادم في `collectCustomerDebt` — حرفاً، ومنها تُبنى جملةُ التجاوز بالأرقام. */
export const COLLECTION_MESSAGES = {
  documentAndAmountRequired: 'حدد الفاتورة الآجلة ومبلغ التحصيل',
  invoiceAlreadyPaid: 'هذه الفاتورة مسددة بالكامل مسبقاً ولا يمكن تسجيل تحصيل إضافي عليها',
  invoiceNotFound: 'الفاتورة غير موجودة',
  /** ‏`مبلغ التحصيل (X ريال) يتجاوز الرصيد المتبقي على الفاتورة (Y ريال)` — كبناء الخادم. */
  exceedsRemaining: (collectedText: string, remainingText: string): string =>
    `مبلغ التحصيل (${collectedText} ريال) يتجاوز الرصيد المتبقي على الفاتورة (${remainingText} ريال)`,
} as const;

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/collections`. */
export const COLLECTION_PERMISSION = 'van_sales.collection.create';
/** والتي يفرضها على `POST /van-sales/legacy-reconciliation` (بوضعيه: المعاينة والتنفيذ). */
export const RECONCILIATION_PERMISSION = 'van_sales.override.approve';

/** حدودُ الدفعة في أداة المطابقة كما يكتبها الخادم (`Math.max(1, Math.min(200, …))`). */
export const RECONCILIATION_BATCH_MIN = 1;
export const RECONCILIATION_BATCH_MAX = 200;
export const RECONCILIATION_BATCH_DEFAULT = 50;

export const COLLECTIONS_WINDOW_NOTE =
  'القائمة من نافذة اللوحة (أحدث ١٢٠ مستندًا)؛ ومجموع ذمم المنشأة من summary الذي حسبه الخادم، لا من جمع هذه الصفوف.';

/** المتبقي على الفاتورة نصًّا — ما يُعرض في الجدول وفي جملة الرفض. */
export function remainingText(doc: DocumentRow): string {
  return documentRemaining(doc).toFixed(2);
}

/**
 * الذمم القائمة: مستنداتٌ آجلة بقي عليها شيء، الأقدم أولًا — فالتحصيل يبدأ من أطول دينٍ
 * عمرًا، لا من أسهل صفٍّ قراءة.
 */
export function receivableRows(documents: DocumentRow[]): DocumentRow[] {
  return documents
    .filter((row) => hasOpenDebt(row))
    .sort((left, right) => (left.docDate < right.docDate ? -1 : left.docDate > right.docDate ? 1 : 0));
}

/** عمرُ الدين بالأيام من تاريخ المستند — للترتيب والعرض، لا لحساب غرامةٍ لم تُقرَّر. */
export function ageDays(doc: DocumentRow, now: Date = new Date()): number | null {
  const at = new Date(doc.docDate || doc.createdAt);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

/** مجموع ما في القائمة — ويُسمّى مجموعَ القائمة، لا ذمم المنشأة. */
export function receivablesTotal(rows: DocumentRow[]): Decimal {
  return rows.reduce((sum, row) => sum.plus(documentRemaining(row)), new Decimal(0));
}

/** ذممُ عميلٍ واحد من القائمة — لسطر «لهذا العميل» فوق الجدول. */
export function partyReceivables(rows: DocumentRow[], partyId: string): Decimal {
  return rows
    .filter((row) => row.partyId === partyId)
    .reduce((sum, row) => sum.plus(documentRemaining(row)), new Decimal(0));
}

export type CollectionDraft = {
  documentId: string;
  collectedAmount: string;
  cashLocationId: string;
  offsetAccountId: string;
  notes: string;
};

export function emptyCollectionDraft(): CollectionDraft {
  return { documentId: '', collectedAmount: '', cashLocationId: '', offsetAccountId: '', notes: '' };
}

/** حمولة `POST /van-sales/collections` — الخانة الفارغة `undefined` لا نصًّا فارغاً. */
export function buildCollectionPayload(draft: CollectionDraft) {
  const collected = decimalOrNull(draft.collectedAmount);
  return {
    documentId: draft.documentId,
    collectedAmount: collected ? collected.toFixed(4) : draft.collectedAmount.trim(),
    cashLocationId: draft.cashLocationId.trim() || undefined,
    offsetAccountId: draft.offsetAccountId.trim() || undefined,
    notes: draft.notes.trim() || undefined,
  };
}

export type CollectionVerdictContext = {
  documents: DocumentRow[];
  postingReadiness?: PostingReadiness;
};

/**
 * حكمُ التحصيل قبل الإرسال. والمحظورات الثلاثة هي ما يحسبه الخادم بالحساب نفسه (بلا مستندٍ
 * أو بلا مبلغ، وفاتورةٌ مسدَّدة، ومبلغٌ يتجاوز المتبقي) — وجملةُ التجاوز تُبنى كأرقامه
 * فتنطبق على رفضه. وأمّا «غير مُرحَّل» فليس سببًا للمنع (المال قُبض فعلًا)، بل **تحذير**
 * يُقال قبل الضغط: سندٌ مسودةٌ يعني أنّ الصندوق زاد والأستاذ لم يعرف بعد.
 */
export function collectionVerdict(draft: CollectionDraft, context: CollectionVerdictContext): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const collected = decimalOrNull(draft.collectedAmount);

  if (!draft.documentId || !collected || collected.lte(0)) {
    blocked.push(COLLECTION_MESSAGES.documentAndAmountRequired);
  }

  const doc = context.documents.find((row) => row.id === draft.documentId) ?? null;
  if (draft.documentId && !doc) {
    warnings.push(
      `الفاتورة المختارة ليست في نافذة اللوحة (أحدث ١٢٠ مستندًا) — إن لم يجدها الخادم قال: «${COLLECTION_MESSAGES.invoiceNotFound}».`,
    );
  }

  if (doc) {
    const remaining = documentRemaining(doc);
    if (remaining.lte(0)) {
      blocked.push(COLLECTION_MESSAGES.invoiceAlreadyPaid);
    } else if (collected && collected.gt(remaining)) {
      blocked.push(
        COLLECTION_MESSAGES.exceedsRemaining(collected.toFixed(2), remaining.toFixed(2)),
      );
    }
    if (doc.paymentMethod !== 'credit' && remaining.gt(0)) {
      warnings.push(
        `مستندٌ بطريقة دفع «${doc.paymentMethod}» وعليه متبقٍّ (${remaining.toFixed(2)}) — النقد والشبكة يُسجَّلان مدفوعين لحظة الإصدار عند الخادم، فمتبقٍّ عليهما إشارةُ مراجعةٍ في الترحيل لا تحصيلٌ عاديّ.`,
      );
    }
    if (collected && remaining.gt(0) && collected.lt(remaining)) {
      warnings.push(
        `تحصيلٌ جزئيّ: يبقى على الفاتورة (${remaining.minus(collected).toFixed(2)}) بعد هذا السند، وتظلّ في قائمة الذمم.`,
      );
    }
  }

  if (!draft.cashLocationId) {
    warnings.push(
      'بلا صندوقٍ نقديّ محدَّد: يكتب الخادم السند على صندوق الفرع الافتراضيّ إن وجد، وإلا بقي بلا صندوق — والمال يُعدّ في الصندوق الذي قُبض فيه فعلًا.',
    );
  }
  if (context.postingReadiness && !context.postingReadiness.receiptVoucher) {
    warnings.push(
      'ملف ترحيل الفرع لا يغطّي سند القبض: قد يُسجَّل التحصيل ويبقى السند **مسودةً غير مُرحَّلة** (يلزم حساب ذمم العملاء على بطاقة العميل أو في ملف الترحيل) — فيزيد الصندوق ولا يعرف الأستاذ.',
    );
  }
  if (draft.offsetAccountId) {
    warnings.push(
      'حسابُ مقابلةٍ محدَّد يدويًّا: يتقدّم على حساب ذمم العميل في بطاقته وعلى حساب الذمم في ملف ترحيل الفرع — فاستعمله حين تقصد حسابًا بعينه، وإلا فاتركه فارغًا ليأخذ الخادم ترتيبه.',
    );
  }

  return { blocked, warnings };
}

/** أحدث حركة سند قبض — فالاستجابة من `POST /van-sales/collections` هي اللوحة كاملة. */
export function latestCollectionReceipt(movements: MovementRow[]): MovementRow | null {
  return movements.find((row) => row.movementType === 'collection_receipt') ?? null;
}

export type VoucherPostState = 'posted' | 'draft' | 'none' | 'unknown';

/**
 * حالةُ سند القبض **من كلمات الخادم** في سبب الحركة: «مُرحَّل» / «غير مُرحَّل» / «بدون سند
 * خزينة». ولا يُستنتج شيءٌ من وجود `voucherId` وحده: سندٌ مسودةٌ له معرّفٌ ولم يصل الأستاذ.
 */
export function voucherPostState(reason: string | null | undefined): VoucherPostState {
  const text = (reason ?? '').trim();
  if (text.length === 0) return 'unknown';
  if (text.includes('غير مُرحَّل')) return 'draft';
  if (text.includes('بدون سند خزينة')) return 'none';
  if (text.includes('مُرحَّل')) return 'posted';
  return 'unknown';
}

export const VOUCHER_POST_LABELS: Record<VoucherPostState, string> = {
 posted: 'سند القبض مُرحَّل — المال في الصندوق وفي الأستاذ',
 draft: 'سند القبض مسجّل وغير مُرحَّل — يلزم حساب ذمم العملاء',
 none: 'تحصيلٌ بلا سند خزينة — لم يُنشأ سند قبض لهذه الحركة',
 unknown: 'حالة السند غير مقروءة من سبب الحركة — اقرأ السبب كما كتبه الخادم',
};

/** جملةُ الشاشة بعد التحصيل: نصُّ الخادم كما هو، ثمّ حالته كما فُهمت من كلماته. */
export function collectionOutcome(movement: MovementRow | null): {
  state: VoucherPostState;
  label: string;
  reason: string;
} | null {
  if (!movement) return null;
  const state = voucherPostState(movement.reason);
  return { state, label: VOUCHER_POST_LABELS[state], reason: movement.reason };
}

/* ------------------------------------------------------------------ */
/* أداة فحص ومطابقة البيانات القديمة (Phase 6) — معاينةٌ ثمّ تنفيذ        */
/* ------------------------------------------------------------------ */

export type ReconciliationCounts = {
  totalProductionBatches: number;
  linkedProductionBatches: number;
  unlinkedProductionBatches: number;
  totalLoadOrders: number;
  linkedLoadOrders: number;
  unlinkedLoadOrders: number;
  pendingShortagePolicyOrders: number;
  totalDocuments: number;
  linkedDocuments: number;
  unlinkedDocuments: number;
  internalDeliveryDocuments: number;
  customerPricesWithoutHistory: number;
};

export type ReconciliationConflict = {
  entityType: string;
  entityId: string;
  code: string;
  detail: string;
};

export type ReconciliationPlanItem = {
  entityType: string;
  entityId: string;
  number: string;
  action: string;
  canBackfillSafely: boolean;
  blockingReason: string | null;
};

export type ReconciliationExecution = {
  succeededCount: number;
  failedCount: number;
  succeeded: Array<{ entityType: string; entityId: string; linkedId: string }>;
  failed: Array<{ entityType: string; entityId: string; reason: string }>;
  nextResumeCursor: string | null;
};

export type ReconciliationResult = {
  mode: 'dry_run' | 'execute';
  executedAt: string;
  counts: ReconciliationCounts;
  conflicts: ReconciliationConflict[];
  plan: ReconciliationPlanItem[];
  execution: ReconciliationExecution;
};

export type ReconciliationDraft = {
  mode: 'dry_run' | 'execute';
  resumeFromId: string;
  batchLimit: string;
};

export function emptyReconciliationDraft(): ReconciliationDraft {
  return { mode: 'dry_run', resumeFromId: '', batchLimit: '' };
}

/**
 * حمولة `POST /van-sales/legacy-reconciliation` — والوضع `dry_run` ما لم يُطلب `execute`
 * صراحةً (والخادم يُسقط أيّ قيمةٍ أخرى إلى المعاينة أيضًا). وحدُّ الدفعة يُقَصّ كما يقصّه
 * الخادم فلا يُرسل رقمٌ سيُردّ.
 */
export function buildReconciliationPayload(draft: ReconciliationDraft) {
  const parsed = decimalOrNull(draft.batchLimit);
  const limit = parsed
    ? Math.max(
        RECONCILIATION_BATCH_MIN,
        Math.min(RECONCILIATION_BATCH_MAX, Math.trunc(parsed.toNumber())),
      )
    : undefined;
  return {
    mode: draft.mode === 'execute' ? ('execute' as const) : ('dry_run' as const),
    resumeFromId: draft.resumeFromId.trim() || undefined,
    batchLimit: limit,
  };
}

export function reconciliationVerdict(
  draft: ReconciliationDraft,
  context: { canOverride: boolean; lastResult?: ReconciliationResult | null },
): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];

  if (!context.canOverride) {
    blocked.push(
      `المطابقة (معاينةً كانت أو تنفيذًا) تحتاج ${RECONCILIATION_PERMISSION} — والخادم يرفض 403 على المسار كله.`,
    );
  }
  if (draft.mode === 'execute') {
    warnings.push(
      'تنفيذٌ لا معاينة: الأداة تربط مستنداتٍ قديمة بفواتيرها الرسمية وتكتب تاريخ أسعارٍ ناقصًا. اقرأ conflicts وplan من dry_run أولًا؛ وما لا يُستكمل بأمان (canBackfillSafely=false) يتخطّاه الخادم ولا يحذفه، والتنفيذ يُستأنف من nextResumeCursor.',
    );
    if (!context.lastResult || context.lastResult.mode !== 'dry_run') {
      warnings.push('لم تُجرَ معاينة (dry_run) في هذه الجلسة بعد — نفّذ معاينةً واقرأ خطتها قبل التنفيذ.');
    }
  }
  if (draft.resumeFromId.trim().length > 0 && !context.lastResult?.execution.nextResumeCursor) {
    warnings.push(
      'معرف استئناف مُدخل يدويًّا: الأداة تُستأنف من nextResumeCursor الذي أرجعته الدفعة السابقة، ومعرفٌ من غيرهِا يتخطّى سجلّاتٍ بلا قراءة.',
    );
  }

  return { blocked, warnings };
}

/** ما يُقال عن نتيجة المطابقة — أرقامُها كما رجعت، وبلا ادّعاء أنّ «كلّ شيء سليم». */
export function reconciliationHeadline(result: ReconciliationResult): string {
  const mode = result.mode === 'execute' ? 'تنفيذ' : 'معاينة (بلا كتابة)';
  const blocking = result.plan.filter((item) => !item.canBackfillSafely).length;
  return `${mode} في ${result.executedAt}: ${result.conflicts.length} تعارضًا يحتاج مراجعةً يدوية، و${result.plan.length} بندًا في الخطة (${blocking} لا يُستكمل بأمان)، ومستنداتٌ غير مربوطة ${result.counts.unlinkedDocuments} من ${result.counts.totalDocuments}.`;
}

export function movementTypeLabel(kind: string): string {
  const labels: Record<string, string> = {
 collection_receipt: 'سند قبض وتحصيل مديونية',
 van_sale: 'بيع فعلي لعميل',
 van_bonus: 'كمية مجانية / عينات',
 van_return: 'إرجاع سليم للمستودع',
 van_damage: 'تالف مفحوص ومعتمد',
 van_shortage: 'عجز عهدة',
 van_load: 'صرف وتحميل عهدة مندوب',
 production_in: 'إنتاج يومي للمستودع الرئيسي',
  };
  return labels[kind] ?? kind; // ‏النوع غير المعروف يُعرض خاماً.
}

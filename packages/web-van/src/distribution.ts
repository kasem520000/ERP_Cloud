import { num } from './production';

/**
 * 🚚 عقد التوزيع والأحمال — أمر التحميل من المستودع الأمّ إلى عهدة المندوب.
 *
 * نفس مبدأ عقد الإنتاج: **لا قواعد أعمال هنا**، بل شكل الحمولة كما يقرأها الخادم حرفاً
 * (`POST /van-sales/load-orders`) وأحكام الرفض التي يقولها الخادم بالعربية، حتى لا يضيع
 * طلبٌ ميت ولا يُعرض للمشرف وعدٌ لا ينفّذه الخادم.
 *
 * ما ثبته المسح في الخادم (`apps/api/src/modules/van-sales/van-sales.service.ts`):
 *   · الترتيب `salesmanId` ← `loadedQty` ← مصدر الصنف: «اختر المندوب لأمر التحميل» (422)،
 *     ثمّ كميةٌ موجبة، ثمّ `itemId` أو `productionBatchNo` الذي يحمل الصنف والمستودع؛
 *   · `vanWarehouseId` تُشتقّ من مستودع المندوب حين لا تُرسل، و`warehouseId` من دفعة
 *     الإنتاج — فما لا تعرفه الشاشة **لا تُرسله** بدل أن تخمّنه؛
 *   · تأكيد الاستلام: `receivedQty` فارغة ⇒ يستعمل الخادم الكمية المحمّلة، ومرفوضٌ أن
 *     تتجاوزها («الكمية المستلمة (…) تتجاوز الكمية المصروفة (…)»)، والصفر مقبول؛
 *   · الرفض والإلغاء: `reason` اختيارية وللخادم نصٌّ افتراضي، والحالة تُحسم عنده
 *     (`VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT` / `VAN_LOAD_ORDER_NOT_CANCELLABLE`).
 */

/** رقمٌ نصّيّ صالح — هنا الصفر مقبول، فلا يكفي `num()` التي تقرأ التالف صفراً. */
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

function orUndefined(value: string): string | undefined {
  const text = value.trim();
  return text === '' ? undefined : text;
}

/** مسودة أمر التحميل كما تكتبها الشاشة. */
export type LoadOrderDraft = {
  salesmanId: string;
  /** الصنف المحمَّل — أو يُترك فارغاً حين تحدّده دفعة الإنتاج المرتبطة. */
  itemId: string;
  /**
   * 🏷️ هل الصنف المختار يُتتبَّع بالدفعات (`items.track_lot`)؟ تُقرأ من بطاقة الصنف في
   * `GET /organization/catalog/items` ولا تُرسل إلى الخادم — وهو يتحقّق منها بنفسه من
   * بطاقته (`VAN_LOAD_ORDER_BATCH_REQUIRED`)، فالضابط هناك والشاشة تقول الحكم قبل الإرسال.
   */
  itemTrackLot?: boolean;
  /** اسم الصنف كما تُسمّيه الشاشة — لتقول جملة الرفض باسمه كما يقولها الخادم. */
  itemName?: string;
  productionBatchNo: string;
  loadedQty: string;
  /** المستودع المصدر؛ فارغ ⇒ يقرأه الخادم من دفعة الإنتاج. */
  warehouseId: string;
  /** مستودع السيارة (العهدة)؛ فارغ ⇒ مستودع المندوب المُسند إليه. */
  vanWarehouseId: string;
  vehiclePlate: string;
  notes: string;
};

export type LoadOrderPayload = {
  salesmanId: string;
  loadedQty: string;
  itemId?: string;
  productionBatchNo?: string;
  warehouseId?: string;
  vanWarehouseId?: string;
  vehiclePlate?: string;
  notes?: string;
};

export type LoadOrderVerdict =
  | { ok: true; payload: LoadOrderPayload }
  | { ok: false; message: string };

/**
 * نصوص الرفض **حرفاً كما يقولها الخادم** (`createLoadOrder` في `van-sales.service.ts`) — لا
 * صياغةٌ ثانية من عندنا: فالمشرف الذي يقرأ الرفض قبل الإرسال يجب أن يقرأ الجملة نفسها التي
 * سيراه لو أرسل. والنصوص مثبّتةٌ من طرف الخادم في
 * `apps/api/test/van-sales-stock-acceptance.spec.ts`، فأيّ تعديلٍ هنا بلا تعديلٍ هناك يكسر
 * الاختبار ولا يبقى النصّان متطابقين بالنيّة.
 *
 * و`sourceRequired` نصّ الخادم حرفاً: طلبٌ بلا صنفٍ وبلا دفعة يرفضه الخادم بالجملة نفسها
 * (‏422 «اختر الصنف المورَّد…»). وكان الخادم **يختلق** رقم دفعةٍ (`PROD-<اليوم>-0001`) فيشتقّ
 * الصنف منها إن وُجدت في المستأجر دفعةٌ بهذا الرقم، فكانت الشاشة أشدّ منه؛ وأُزيل الاختلاق
 * (‏§5.1) فصارا يرفضان معاً، وتبقى الشاشة ترفض **قبل الإرسال** لأنّ حمولةً تُنسب إلى صنفٍ لم
 * يختره المشرف عهدةٌ بلا قصد.
 *
 * ‏وكذلك `batchRequired`: نصّ الخادم `VAN_LOAD_ORDER_BATCH_REQUIRED` بمعناه وحروفه (وحده اسم
 * الصنف تضمّنه الشاشة حين تعرفه) — مثبّتٌ من طرف الخادم في
 * `apps/api/test/van-sales-load-order-basis.spec.ts`.
 */
export const LOAD_ORDER_MESSAGES = {
  salesmanRequired: 'اختر المندوب لأمر التحميل',
  qtyRequired: 'الكمية المحمّلة للمندوب يجب أن تكون أكبر من صفر',
  sourceRequired: 'اختر الصنف المورَّد للمندوب من الأصناف المسجلة (أو حدد دفعة إنتاج مرتبطة بصنف)',
  /**
   * 🏷️ §5.1 — صنفٌ يُتتبَّع بالدفعات لا تُحمَّل عهدته بلا دفعةٍ مُسمّاة. نصُّ الخادم حرفاً
   * (`VAN_LOAD_ORDER_BATCH_REQUIRED`)، وهو يضمّن اسم الصنف كما تضمّنه الشاشة حين تعرفه.
   */
  batchRequired: (itemName?: string) =>
    `الصنف${itemName ? ` «${itemName}»` : ''} يُتتبَّع بالدفعات ولا يجوز تحميل عهدته بلا دفعة إنتاج مُسمّاة: رقمُ الدفعة هو ما تُنسب إليه اللوتات عند البيع وعند جرد الإقفال. سمِّ الدفعة (productionBatchNo)، أو سجّل دفعة إنتاجٍ لها أوّلاً — ولا يُفترض رقمٌ من تاريخ اليوم لأنه يلتقي برقم أوّل دفعةٍ تُنشأ اليوم نفسها.`,
  sameWarehouse:
    'مستودع الصرف ومستودع سيارة المندوب واحد — حدد مستودعين مختلفين حتى تُسجَّل مناولة مخزنية رسمية',
} as const;

/**
 * بناء حمولة أمر التحميل وحكمها.
 *
 * الترتيب مقصود وهو ترتيب الخادم نفسه: المندوب ← الكمية ← مصدر الصنف. وما لا تعرفه
 * الشاشة (المستودع المصدر، مستودع السيارة) يُرسل `undefined` فيشتقّه الخادم من المندوب
 * ومن دفعة الإنتاج — وتخمينه في المتصفح يعني عهدةً تُنسب لمستودعٍ لم يختره أحد.
 */
export function buildLoadOrderPayload(draft: LoadOrderDraft): LoadOrderVerdict {
  const salesmanId = draft.salesmanId.trim();
  if (!salesmanId) return { ok: false, message: LOAD_ORDER_MESSAGES.salesmanRequired };

  const loadedQty = num(draft.loadedQty);
  if (!draft.loadedQty.trim() || !NUMERIC_TEXT.test(draft.loadedQty.trim()) || loadedQty.lte(0)) {
    return { ok: false, message: LOAD_ORDER_MESSAGES.qtyRequired };
  }

  const itemId = draft.itemId.trim();
  const productionBatchNo = draft.productionBatchNo.trim();
  if (!itemId && !productionBatchNo) return { ok: false, message: LOAD_ORDER_MESSAGES.sourceRequired };

  // 🏷️ صنفٌ يُتتبَّع بالدفعات بلا دفعةٍ مُسمّاة ⇒ الخادم يرفضه 422، فتقوله الشاشة أوّلاً.
  // والترتيب ترتيب الخادم: الصنف (أو الدفعة التي يشتقّ منها الصنف) ← ثمّ تتبعُ الدفعات.
  if (!productionBatchNo && draft.itemTrackLot === true) {
    return { ok: false, message: LOAD_ORDER_MESSAGES.batchRequired(draft.itemName?.trim() || undefined) };
  }

  // ‏المستودعان مكتوبين ومتطابقين ⇒ مآله 422 عند الخادم (لا مناولة بين مستودعٍ ونفسه).
  // وأمّا أحدهما فارغ فليس تطابقاً: الخادم يشتقّ الناقص، وقد يشتقّه مختلفاً.
  const warehouseId = orUndefined(draft.warehouseId);
  const vanWarehouseId = orUndefined(draft.vanWarehouseId);
  if (warehouseId && vanWarehouseId && warehouseId === vanWarehouseId) {
    return { ok: false, message: LOAD_ORDER_MESSAGES.sameWarehouse };
  }

  return {
    ok: true,
    payload: {
      salesmanId,
      loadedQty: loadedQty.toFixed(4),
      itemId: orUndefined(itemId),
      productionBatchNo: orUndefined(productionBatchNo),
      warehouseId,
      vanWarehouseId,
      vehiclePlate: orUndefined(draft.vehiclePlate),
      notes: orUndefined(draft.notes),
    },
  };
}

/** مسودة تأكيد الاستلام؛ `loadedQty` من الصفّ نفسه ليُقاس بها التجاوز قبل الإرسال. */
export type ReceiptDraft = {
  receivedQty: string;
  notes: string;
  loadedQty: string;
};

export type ReceiptPayload = { receivedQty?: string; notes?: string };

export type ReceiptVerdict =
  | { ok: true; payload: ReceiptPayload; usesLoadedQty: boolean }
  | { ok: false; message: string };

/** نصوص `confirmReceipt` في الخادم حرفاً — والثاني قالبٌ لأنّ الخادم يحشو الرقمين فيه. */
export const RECEIPT_MESSAGES = {
  qtyInvalid: 'الكمية المستلمة يجب أن تكون رقمًا موجبًا أو صفرًا',
  exceedsLoaded: (received: string, loaded: string): string =>
    `الكمية المستلمة (${received}) تتجاوز الكمية المصروفة (${loaded})`,
} as const;

/**
 * تأكيد الاستلام — ما يُدخل الحمولة في العهدة الرسمية للمندوب.
 *
 * الحقل الفارغ **ليس صفراً**: الخادم يستعمل عندها الكمية المحمّلة، وتُعلَم الشاشة بذلك
 * (`usesLoadedQty`) لتقولها للمشرف بدل أن يوحي الفراغ بأنه «لم يستلم شيئاً». أمّا الصفر
 * المكتوب صراحةً فمقبول (ما استلم شيئاً) ويُقال أثره: الفرق يُسجَّل في `discrepancyQty`.
 */
export function buildReceiptPayload(draft: ReceiptDraft): ReceiptVerdict {
  const text = draft.receivedQty.trim();
  const notes = orUndefined(draft.notes);
  if (!text) return { ok: true, payload: { notes }, usesLoadedQty: true };
  if (!NUMERIC_TEXT.test(text)) return { ok: false, message: RECEIPT_MESSAGES.qtyInvalid };

  const received = num(text);
  if (received.lt(0)) return { ok: false, message: RECEIPT_MESSAGES.qtyInvalid };

  const loaded = num(draft.loadedQty);
  if (loaded.gt(0) && received.gt(loaded)) {
    return {
      ok: false,
      message: RECEIPT_MESSAGES.exceedsLoaded(received.toFixed(2), loaded.toFixed(2)),
    };
  }
  return { ok: true, payload: { receivedQty: received.toFixed(4), notes }, usesLoadedQty: false };
}

/** حالات `van_load_orders.status` كما ثبّتها الترحيل 0124 (قيد CHECK). */
export const LOAD_ORDER_STATUSES = [
  'draft',
  'pending_receipt',
  'loaded',
  'in_route',
  'pending_closing',
  'pending_stock_settlement',
  'settled',
  'reconciled',
  'rejected',
  'canceled',
] as const;

export type LoadOrderStatus = (typeof LOAD_ORDER_STATUSES)[number];

export const LOAD_ORDER_STATUS_LABELS: Record<LoadOrderStatus, string> = {
  draft: 'مسودة',
  pending_receipt: 'بانتظار تأكيد الاستلام',
  loaded: 'محمَّلة',
  in_route: 'في الطريق',
  pending_closing: 'بانتظار الإقفال',
  pending_stock_settlement: 'بانتظار تسوية المخزون',
  settled: 'مُسوّاة',
  reconciled: 'مُطابَقة',
  rejected: 'مرفوضة الاستلام',
  canceled: 'ملغاة',
};

/**
 * تسمية الحالة — و**قيمةٌ غير معروفة تُعرض خاماً** لا بتسميةٍ مخترَعة: إن أضاف الخادم
 * حالةً جديدة فقراءتها «pending_xyz» أصدق من «مسودة» تُخفي أنّ الشاشة لا تعرف.
 */
export function loadOrderStatusLabel(status: string): string {
  const labels: Record<string, string> = LOAD_ORDER_STATUS_LABELS;
  return labels[status] ?? status;
}

/** `van_load_orders.stock_settlement_status` — مسار التسوية الرسمية للمخزون. */
export const STOCK_SETTLEMENT_STATUSES = [
  'not_required',
  'pending_transit_decision',
  'pending_count_decision',
  'settled_officially',
  'blocked_missing_accounts',
] as const;

export type StockSettlementStatus = (typeof STOCK_SETTLEMENT_STATUSES)[number];

export const STOCK_SETTLEMENT_STATUS_LABELS: Record<StockSettlementStatus, string> = {
  not_required: 'لا تحتاج تسوية',
  pending_transit_decision: 'بانتظار قرار فرق العبور',
  pending_count_decision: 'بانتظار قرار الجرد',
  settled_officially: 'سُوّيت رسمياً',
  blocked_missing_accounts: 'متوقفة: حسابات المخزون ناقصة',
};

export function stockSettlementStatusLabel(status: string): string {
  const labels: Record<string, string> = STOCK_SETTLEMENT_STATUS_LABELS;
  return labels[status] ?? status;
}

/**
 * هل يُعرض إجراءٌ على الصفّ؟ هذه **مرآةٌ لرفض الخادم** لا حكمٌ مستقل: تُخفي إجراءً مآله
 * 409 مؤكَّد (`VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT` / `VAN_LOAD_ORDER_NOT_CANCELLABLE`)،
 * والخادم يبقى القاضي — فلو تغيّرت الحالات عنده سقطت الاختبارات هنا لا عند المستخدم.
 *
 * والحالة غائبةً أو `null` (صفٌّ لم يكتمل من اللوحة) ⇒ لا إجراء: الإخفاء هنا أهون من 409
 * مؤكّد، والصفّ يبقى معروضاً بحالته الخام في الجدول.
 */
export function canConfirmReceipt(row: { status?: string | null }): boolean {
  return row.status === 'pending_receipt';
}

export function canCancelLoadOrder(row: { status?: string | null }): boolean {
  return row.status === 'draft' || row.status === 'pending_receipt';
}

import { Decimal } from 'decimal.js';

/**
 * 🏭 مسودة دفعة الإنتاج — عقد الحمولة التي ترسلها شاشتا الإنتاج (في `apps/staff` وفي
 * `apps/bakery`) إلى `POST /van-sales/production-batches`.
 *
 * لماذا دوالّ نقية خارج الصفحة؟ لأن **عقد الشبكة هنا هو الفارق بين دفعة تُرحَّل ودفعة
 * تُرفض**، وليس تفصيلاً شكلّيًا:
 *
 *   · الخادم يقرأ المكوّنات من `components: Array<{ itemId, qty }>` — الحقل **`qty`**
 *     (`van-sales.controller.ts:94` ← `ProductionOrdersService.create`)، فلو أُرسل
 *     `quantity` لمرّ الطلب وفيه مكوّناتٌ بلا كميات؛
 *   · دفعةٌ بلا مكوّنات ولا قائمة مواد تُرفض `VAN_PRODUCTION_INPUT_REQUIRED` — لأن
 *     الدفعة تُدخل مخزوناً بلا مصدر ولا تكلفة؛
 *   · المكوّن المكرر مرفوض `PRODUCTION_COMPONENT_DUPLICATE`، والصنف المنتج لا يكون
 *     مكوّناً في دفعته `PRODUCTION_COMPONENT_IS_OUTPUT`، والكمية غير الموجبة مرفوضة
 *     `PRODUCTION_COMPONENT_QTY_INVALID`؛
 *   · الفاقد بلا سبب مرفوض `VAN_PRODUCTION_SCRAP_REASON_REQUIRED`.
 *
 * وهذه الدوال تقول للمستخدم بالعربية ما سيقوله الخادم، قبل أن يضيع طلبه — مع بقاء
 * الخادم هو الحَكَم (إخفاء الزر ليس ضبطاً، وفحص المتصفح ليس رقابة).
 *
 * **ولا تُرسل الدفعة تكلفةً مكتوبة**: التكلفة الفعلية هي قيمة ما صُرف من المكوّنات عبر
 * أمر الإنتاج الرسمي (القرار المعتمد)، فإرسال رقمٍ يدوي يعني إرسال رقمٍ يُتجاهل.
 */

export type ProductionComponentDraft = { itemId: string; qty: string };

export type ProductionBatchDraft = {
  itemId: string;
  warehouseId: string;
  productionDate?: string;
  itemName?: string;
  producedQty: string;
  scrapQty?: string;
  scrapReason?: string;
  /** 🏷️ يُترك فارغاً ليُخصَّص رقم تسلسلي رسمي؛ وإن كُتب صار رقم دفعة الناتج (اللوت) مثله. */
  batchNo?: string;
  supervisorName?: string;
  notes?: string;
  components: ProductionComponentDraft[];
};

/** الحمولة كما يقرأها الخادم — وبلا مفتاح `unitCost` إطلاقاً. */
export type ProductionBatchPayload = {
  itemId: string;
  warehouseId?: string;
  productionDate?: string;
  itemName?: string;
  producedQty: string;
  scrapQty: string;
  scrapReason?: string;
  batchNo?: string;
  supervisorName?: string;
  notes?: string;
  components: Array<{ itemId: string; qty: string }>;
};

export type ProductionBatchVerdict =
  | { ok: true; payload: ProductionBatchPayload; lines: Array<{ itemId: string; qty: string }> }
  | { ok: false; message: string };

export const PRODUCTION_MESSAGES = {
  itemRequired: 'اختر الصنف المنتج من الأصناف المسجلة — الرصيد الرسمي يُحتسب بالصنف والمستودع',
  qtyRequired: 'الكمية المنتجة الصالحة يجب أن تكون رقماً أكبر من صفر',
  /** نصّ الرفض الذي يقوله الخادم (`VAN_PRODUCTION_INPUT_REQUIRED`) ومع البديل النظامي. */
  componentsRequired:
    'أضف مكوّناً واحداً على الأقل بكمية أكبر من صفر: دفعة الإنتاج تُصرف موادها رسمياً من ' +
    'مستودع المنشأة، وبلا مكوّنات (أو قائمة مواد مرتبطة بالصنف) تُرفض. الوارد من خارج ' +
    'المنشأة يُسجَّل بإذن إدخال مخزني رسمي أو تسوية جرد معتمدة.',
  componentItemRequired: 'اختر الصنف لكل مكوّن — أو احذف السطر الفارغ',
  componentQtyRequired:
    'كمية المكوّن يجب أن تكون رقماً أكبر من صفر: مكوّنٌ بلا كمية يعني دفعةً تُنتَج بلا مواد تُصرف',
  duplicateComponent:
    'المكوّن مكرر — اجمع الكميتين في سطر واحد، فأمر الإنتاج الرسمي يرفض تكرار الصنف',
  componentIsOutput: 'الصنف المنتج لا يكون مكوّناً في دفعته نفسها — اختر مواد الإدخال فقط',
  scrapNegative: 'كمية الفاقد لا تكون سالبة',
  /** حرفيّ الحكم في الخادم: لا يُرحَّل فاقد بلا سبب. */
  scrapReasonRequired: 'لا يُرحَّل فاقد بلا سبب: اكتب سبب الفاقد مع أي كمية فاقد أكبر من صفر',
} as const;

/** رقمٌ آمن: نصٌّ فارغ أو تالف يُقرأ صفراً بدل أن يرمي `Decimal` استثناءً في وجه المستخدم. */
function num(value: string | number | null | undefined): Decimal {
  try {
    const parsed = new Decimal(value === null || value === undefined || value === '' ? 0 : value);
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/**
 * بناء حمولة دفعة الإنتاج وحكمها.
 *
 * الترتيب مقصود: الصنف ← الكمية ← الفاقد وسببه ← المكوّنات. و**السطر الجديد الذي لم
 * يُلمس** (بلا صنف وبلا كمية) يُتجاهل، أما السطر الناقص (صنفٌ بلا كمية أو كميةٌ بلا صنف)
 * فيُرفض ولا يُحذف صامتاً — فحذف مكوّنٍ نسي المشرف كميته يعني دفعةً تُنتَج بأقلّ مما
 * صُرف فعلاً، أي تكلفةً ناقصة وربحاً مصطنعاً عند أول بيع.
 */
export function buildProductionBatchPayload(draft: ProductionBatchDraft): ProductionBatchVerdict {
  const itemId = (draft.itemId ?? '').trim();
  if (!itemId) return { ok: false, message: PRODUCTION_MESSAGES.itemRequired };

  const producedQty = num(draft.producedQty);
  if (producedQty.lte(0)) return { ok: false, message: PRODUCTION_MESSAGES.qtyRequired };

  const scrapQty = num(draft.scrapQty);
  if (scrapQty.lt(0)) return { ok: false, message: PRODUCTION_MESSAGES.scrapNegative };
  const scrapReason = (draft.scrapReason ?? '').trim();
  if (scrapQty.gt(0) && !scrapReason) {
    return { ok: false, message: PRODUCTION_MESSAGES.scrapReasonRequired };
  }

  const lines: Array<{ itemId: string; qty: string }> = [];
  const seen = new Set<string>();
  for (const row of draft.components ?? []) {
    const componentItemId = (row?.itemId ?? '').trim();
    const qtyText = (row?.qty ?? '').trim();
    if (!componentItemId && !qtyText) continue;
    if (!componentItemId) return { ok: false, message: PRODUCTION_MESSAGES.componentItemRequired };
    const qty = num(qtyText);
    if (qty.lte(0)) return { ok: false, message: PRODUCTION_MESSAGES.componentQtyRequired };
    if (componentItemId === itemId) {
      return { ok: false, message: PRODUCTION_MESSAGES.componentIsOutput };
    }
    if (seen.has(componentItemId)) {
      return { ok: false, message: PRODUCTION_MESSAGES.duplicateComponent };
    }
    seen.add(componentItemId);
    lines.push({ itemId: componentItemId, qty: qty.toFixed(4) });
  }
  if (lines.length === 0) return { ok: false, message: PRODUCTION_MESSAGES.componentsRequired };

  const batchNo = (draft.batchNo ?? '').trim();
  const warehouseId = (draft.warehouseId ?? '').trim();
  const payload: ProductionBatchPayload = {
    itemId,
    warehouseId: warehouseId || undefined,
    productionDate: (draft.productionDate ?? '').trim() || undefined,
    itemName: (draft.itemName ?? '').trim() || undefined,
    producedQty: producedQty.toFixed(4),
    scrapQty: scrapQty.toFixed(4),
    scrapReason: scrapReason || undefined,
    /** 🏷️ لا يُخترع رقمٌ في المتصفح: التفرد على (المستأجر + رقم الدفعة) قيدٌ في القاعدة. */
    batchNo: batchNo || undefined,
    supervisorName: (draft.supervisorName ?? '').trim() || undefined,
    notes: (draft.notes ?? '').trim() || undefined,
    components: lines,
  };
  return { ok: true, payload, lines };
}

/** صفّ رصيد رسمي كما يعود من `GET /van-sales/dashboard` (`officialStock`). */
export type OfficialStockRowForEstimate = {
  itemId: string;
  warehouseId?: string | null;
  quantity: string;
  averageCost: string;
};

export type ComponentCostEstimate = {
  /** مجموع قيمة المكوّنات بالمتوسط الرسمي — نصّ بخانتين. */
  totalValue: string;
  /** التكلفة المتوقعة للكيلو المنتج — نصّ بأربع خانات. */
  perKg: string;
  /** عدد المكوّنات التي ليس لها قيمة أو رصيد في المستودع المختار (ستُرفض الدفعة لأجلها). */
  unvalued: number;
};

/**
 * 💵 تقدير تكلفة الدفعة من **المتوسط المرجّح الرسمي** للمكوّنات في المستودع المختار.
 *
 * رقمٌ إرشادي يظهر للمشرف قبل الاعتماد لا غير — والفعلي هو قيمة ما يخرج من الرفّ في أمر
 * الإنتاج الرسمي. وفائدته الحقيقية التحذير: مكوّنٌ بلا قيمة أو بلا رصيد يعني أن الدفعة
 * ستُرفض (`VAN_PRODUCTION_COST_REQUIRED`)، فيُقال للمشرف قبل أن يضغط لا بعدها.
 */
export function estimateComponentCost(input: {
  lines: Array<{ itemId: string; qty: string }>;
  producedQty: string;
  stockRows: OfficialStockRowForEstimate[];
  warehouseId?: string;
}): ComponentCostEstimate {
  const rows = input.stockRows.filter(
    (row) => !input.warehouseId || row.warehouseId === input.warehouseId,
  );
  let totalValue = new Decimal(0);
  let unvalued = 0;
  for (const line of input.lines) {
    const row = rows.find((candidate) => candidate.itemId === line.itemId);
    const averageCost = num(row?.averageCost);
    const stockQty = num(row?.quantity);
    if (averageCost.lte(0) || stockQty.lte(0)) unvalued += 1;
    totalValue = totalValue.plus(averageCost.times(num(line.qty)));
  }
  const produced = num(input.producedQty);
  return {
    totalValue: totalValue.toFixed(2),
    perKg: produced.gt(0) ? totalValue.div(produced).toFixed(4) : '0.0000',
    unvalued,
  };
}

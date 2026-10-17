import {
  canConfirmReceipt,
  loadOrderStatusLabel,
  stockSettlementStatusLabel,
} from '@erp/web-van/distribution';

import { numberText, type ItemOption } from './lookups';
import type { ProductionBatchRow } from './production-screen';
import type { ScreenColumn } from './ui-kit';

/**
 * 🚚 glue شاشة التوزيع — **دوالّ صافية وحدها** (تُقاس في `tests/distribution-screen.spec.ts`)،
 * والطلب والشاشة في `app/distribution/page.tsx`.
 *
 * كلّ حقلٍ هنا مُتحقَّقٌ منه في مصدره: صفوف الأحمال من إسقاط `GET /van-sales/dashboard`
 * (‏`van-sales.service.ts` — ‏`loadOrders`)، وصفوف المندوبين من `GET /van-sales/salesmen`
 * (‏`listSalesmenWithCustody`). ولا اختراع: ما لم يقله الخادم لا يُعرض، والغائب `—` لا صفر.
 *
 * وما **ليس** هنا مقصود: الإقفال والاعتماد وتسوية فرق العهدة — انظر `lib/navigation.ts`
 * (وحدة «إقفال العهدة») و`apps/staff`.
 */

/** صفّ أمر تحميل كما يعود في `loadOrders` من لوحة القيادة — الحقول التي تقرأها هذه الشاشة. */
export type LoadOrderRow = {
  id?: string | null;
  number?: string | null;
  loadDate?: string | null;
  status?: string | null;
  productionBatchNo?: string | null;
  vehiclePlate?: string | null;
  salesmanId?: string | null;
  salesmanName?: string | null;
  warehouseId?: string | null;
  vanWarehouseId?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  loadedQty?: string | number | null;
  receivedQty?: string | number | null;
  discrepancyQty?: string | number | null;
  discrepancyNotes?: string | null;
  receivedAt?: string | null;
  awaitingReceipt?: boolean | null;
  remainingQty?: string | number | null;
  stockSettlementStatus?: string | null;
  stockSettlementNote?: string | null;
};

/** مندوب كما يعود من `GET /van-sales/salesmen` — الحقول التي تقرأها هذه الشاشة. */
export type SalesmanRow = {
  id?: string | null;
  name?: string | null;
  active?: boolean | null;
  employeeId?: string | null;
  employeeNo?: string | null;
  employeeName?: string | null;
  membershipId?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  vehiclePlate?: string | null;
  custody?: {
    custodyQty?: string | number | null;
    openLoadOrders?: number | null;
    pendingReceipts?: number | null;
  } | null;
  readiness?: {
    hasEmployee?: boolean | null;
    hasLoginAccount?: boolean | null;
    loginActive?: boolean | null;
    hasVanWarehouse?: boolean | null;
    hasVanSalesPermissions?: boolean | null;
  } | null;
};

export type DistributionDashboard = {
  loadOrders?: LoadOrderRow[] | null;
  productionBatches?: ProductionBatchRow[] | null;
  mainWarehouseId?: string | null;
  policy?: { shortagePolicy?: string | null; productionCostBasis?: string | null } | null;
};

/** صفوف الأحمال: يُستبعد ما لا `id` له (لا يُنفَّذ إجراءٌ على صفٍّ بلا معرّف). */
export function mapLoadOrders(payload: DistributionDashboard | null | undefined): LoadOrderRow[] {
  return (payload?.loadOrders ?? []).filter(
    (row): row is LoadOrderRow => typeof row?.id === 'string' && row.id.length > 0,
  );
}

/** صفوف المندوبين: يُستبعد ما لا `id` له، ويُعرض غير النشط بعلامته لا بحذفه. */
export function mapSalesmen(rows: readonly SalesmanRow[] | null | undefined): SalesmanRow[] {
  return (rows ?? []).filter((row): row is SalesmanRow => typeof row?.id === 'string' && row.id.length > 0);
}

/** اسم المندوب كما يقول الخادم: الاسم، ثمّ رقم الموظف أو اسمه إن وُجد — ولا تركيب من عندنا. */
export function salesmanLabel(row: SalesmanRow): string {
  const name = row.name ?? row.employeeName ?? null;
  const ref = row.employeeNo ?? null;
  if (name && ref) return `${name} (${ref})`;
  return name ?? ref ?? row.id ?? '—';
}

/**
 * ما يمنع الحمولة فعلياً قبل أن يُرسل الطلب — لا نوايا ولا ذوق:
 * الخادم يشتقّ مستودع السيارة من المندوب، فمندوبٌ بلا مستودع سيارة حمولته مرفوضة عنده.
 * و`null` حين لا مانع معلوم.
 */
export function salesmanBlockingWarning(row: SalesmanRow): string | null {
  if (row.readiness?.hasVanWarehouse === false || (row.warehouseId ?? null) === null) {
    return 'لا يملك مستودع سيارة (وجهة الحمولة) — أضفه في بطاقة المندوب أو اختر مستودع الوجهة يدوياً.';
  }
  return null;
}

/** تنبيهٌ لا يمنع: ما يُقال للمشرف ولا يوقف الإرسال (الحكم للخادم). */
export function salesmanAdvisories(row: SalesmanRow): string[] {
  const out: string[] = [];
  if (row.active === false) out.push('البطاقة غير نشطة.');
  if (row.readiness?.hasEmployee === false) out.push('لا موظف مرتبطاً — السجل بلا مسؤولية وظيفية.');
  if (row.readiness?.hasLoginAccount === false) out.push('لا حساب دخول — لا يعمل من تطبيق المندوب.');
  else if (row.readiness?.loginActive === false) out.push('حساب الدخول غير مفعّل.');
  if (row.readiness?.hasVanSalesPermissions === false) out.push('لا صلاحية مبيعات سيارات.');
  return out;
}

/**
 * الأحمال التي تنتظر استلاماً الآن — مرآة `canConfirmReceipt` في العقد المشترك، أي مرآة
 * رفض الخادم (`pending_receipt` وحدها).
 */
export function awaitingReceiptRows(rows: readonly LoadOrderRow[]): LoadOrderRow[] {
  return rows.filter((row) => canConfirmReceipt(row));
}

/** تسمية الدفعة في قائمة الاختيار: الرقم والصنف والكمية المنتَجة والحالة كما هي. */
export function batchOptionLabel(row: ProductionBatchRow): string {
  const parts: string[] = [];
  const batchNo = row.batchNo ?? null;
  if (batchNo) parts.push(batchNo);
  const itemName = row.itemName ?? null;
  if (itemName) parts.push(itemName);
  const produced = numberText(row.producedQty);
  if (produced !== '—') parts.push(`أنتج ${produced}`);
  const status = row.status ?? null;
  if (status) parts.push(status);
  if (parts.length === 0) return row.id ?? '—';
  return parts.join(' · ');
}

/** صنفٌ من صفّ دفعة إنتاج: لتعبئة خانة الصنف حين تُختار دفعة (لا تخمين من الاسم). */
export function batchItemOption(row: ProductionBatchRow): ItemOption | null {
  const id = row.itemId ?? null;
  if (!id) return null;
  return { id, nameAr: row.itemName ?? null };
}

/**
 * 🏷️ عمود «الدفعة» كما هو حقّاً: أمرٌ **بلا دفعةٍ مُسمّاة** يُعرض «بلا دفعة» — لا بياضاً ولا
 * صفراً ولا رقماً مُختلَعاً. والخادم كان يكتب `PROD-<اليوم>-0001` حين لا تُذكر دفعة، فأُزيل
 * الاختلاق (§5.1) وصارت السلسلة الفارغة حالةً نظاميةً لصنفٍ لا يُتتبَّع بالدفعات — ولزاماً أن
 * تُقال كما هي، فالبياض في العمود يظنّه القارئ نقصاً في العرض لا حقيقةً في الأمر.
 */
export function batchCellText(row: LoadOrderRow): string {
  const text = (row.productionBatchNo ?? '').trim();
  return text === '' ? 'بلا دفعة' : text;
}

/**
 * ‏هل هذا الأمر مرفوضٌ عند الخادم قبل أن يُرسل؟ صنفٌ يُتتبَّع بالدفعات (`items.track_lot`) بلا
 * دفعةٍ مُسمّاة ⇒ ‏422 `VAN_LOAD_ORDER_BATCH_REQUIRED`. وتُقرأ البطاقة من قائمة الأصناف
 * (‏`GET /organization/catalog/items`) لا من صفّ الأمر: فالصفّ لا يحمل `track_lot`.
 */
export function itemRequiresBatch(
  items: ItemOption[],
  itemId: string,
  productionBatchNo: string,
): boolean {
  if (productionBatchNo.trim() !== '') return false;
  const wanted = itemId.trim();
  if (wanted === '') return false;
  return items.find((row) => row.id === wanted)?.trackLot === true;
}

/* --------------------------------------------------------------------------
 * جدولُ الأحمال على `DataTable` — الشاشةُ تُعلن الأعمدةَ والحالة، والنظام يرسم.
 *
 * والأعمدةُ هي ذاتُ أعمدة الجدول اليدويّ الذي كانت ترسمه الصفحة، مع
 * تسمياتِ الحالات المحسوبة مرةً واحدةً في صفوف العرض (لا في كلّ خلية).
 * ------------------------------------------------------------------------ */

/** أعمدةُ جدول الأحمال — إعلانٌ في منطق الشاشة النقيّ (يثبّته الاختبار). */
export const LOAD_ORDER_COLUMNS: readonly ScreenColumn[] = [
  { key: 'number', labelAr: 'رقم الأمر', ltr: true },
  { key: 'loadDate', labelAr: 'التاريخ', ltr: true },
  { key: 'salesmanName', labelAr: 'المندوب' },
  { key: 'itemName', labelAr: 'الصنف' },
  { key: 'batchText', labelAr: 'الدفعة', ltr: true },
  { key: 'loadedQty', labelAr: 'مصروف', numeric: true },
  { key: 'receivedQty', labelAr: 'مستلم', numeric: true },
  { key: 'discrepancyQty', labelAr: 'الفرق', numeric: true },
  { key: 'remainingQty', labelAr: 'المتبقي', numeric: true },
  { key: 'statusText', labelAr: 'الحالة' },
  { key: 'settlementText', labelAr: 'تسوية المخزون' },
];

/** صفُّ أمر التحميل كما يُعرض — التسمياتُ العربية تُحسب هنا مرةً واحدة. */
export type LoadOrderViewRow = LoadOrderRow & {
  batchText: string;
  statusText: string;
  settlementText: string;
};

/**
 * صفوفُ العرض من صفوف الخادم: «الدفعة» كما يُقال لها (بلا دفعةٍ ≠ بياض)،
 * والحالة وتسوية المخزون بتسميات العقد المشترك — وغير المعروف يُعرض
 * خاماً كما يُصرّح بهما، لا اسمٌ مُختلَع.
 */
export function loadOrderViewRows(rows: readonly LoadOrderRow[]): LoadOrderViewRow[] {
  return rows.map((row) => ({
    ...row,
    batchText: batchCellText(row),
    statusText: loadOrderStatusLabel(row.status ?? ''),
    settlementText: stockSettlementStatusLabel(row.stockSettlementStatus ?? ''),
  }));
}

/**
 * قارئُ الخلية — القواعدُ الأربع نفسها التي في `reports-screen.cellText`
 * (نصٌّ/رقمٌ/منطقيّ وما عداها «—»): فالغائبُ «—» لا صفرٌ مُختلَع.
 */
export function loadOrderCellText(
  row: LoadOrderViewRow | null,
  column: ScreenColumn,
): string {
  const value = row ? (row as Record<string, unknown>)[column.key] : null;
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return column.numeric ? numberText(value) : String(value);
  if (typeof value === 'string') return column.numeric ? numberText(value) : value;
  return '—';
}

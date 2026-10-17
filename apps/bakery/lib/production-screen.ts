import type { OfficialStockRowForEstimate } from '@erp/web-van/production';

import type { ScreenColumn } from './ui-kit';
import { numberText, warehouseLabel, type WarehouseOption } from './lookups';

/**
 * 🏭 glue شاشة الإنتاج — **دوالّ صافية وحدها** (تُقاس في `tests/production-screen.spec.ts`)،
 * والطلب والشاشة في `app/production/page.tsx`.
 *
 * ما هنا ترجمةٌ لما يُعيد الخادم فعلًا: `GET /van-sales/dashboard` (الدفعات
 * ‏`productionBatches` والأرصدة الرسمية `officialStock` و`mainWarehouseId`)، و`GET /warehouses`،
 * ‏و`GET /organization/catalog/items`. ولا اختراع: قيمةُ تعدادٍ غير معروفة تُعرض كما هي
 * (خام) بدل تسميةٍ مُختلَعة، والحقل الغائب يُقال إنه غائب.
 *
 * والأسماء العربية لأساس التكلفة مطابقةٌ حرفاً لما تقوله لوحة staff، فلا يقرأ المشرفان
 * wording مختلفاً للحكم نفسه.
 */

/** صفّ رصيدٍ رسمي كما يعود من `officialStock` في `GET /van-sales/dashboard`. */
export type OfficialStockRowDto = {
  itemId?: string | null;
  itemName?: string | null;
  warehouseId?: string | null;
  warehouseName?: string | null;
  quantity?: string | number | null;
  averageCost?: string | number | null;
};

/** دفعة إنتاج كما تعود من الخادم (`factory_production_batches`). */
export type ProductionBatchRow = {
  id?: string | null;
  batchNo?: string | null;
  productionDate?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  warehouseId?: string | null;
  producedQty?: string | number | null;
  scrapQty?: string | number | null;
  unitCost?: string | number | null;
  totalCost?: string | number | null;
  /** ‏`manufacturing_order` | `manual_input` | `item_cost` | null — ‏CHECK من الترحيل 0127. */
  costBasis?: string | null;
  /** ‏`active` | `exhausted` | `closed` — ‏CHECK من الترحيل 0120. */
  status?: string | null;
  lotId?: string | null;
  supervisorName?: string | null;
  notes?: string | null;
};

export type DashboardPayload = {
  productionBatches?: ProductionBatchRow[] | null;
  officialStock?: OfficialStockRowDto[] | null;
  mainWarehouseId?: string | null;
  policy?: { productionCostBasis?: string | null } | null;
};

export {
  itemLabel,
  numberText,
  pickDefaultWarehouse,
  warehouseLabel,
  type ItemOption,
  type WarehouseOption,
} from './lookups';


/**
 * صفوف الأرصدة بالصيغة التي يقرؤها `estimateComponentCost` في الحزمة المشتركة — والحقل
 * الغائب يُقرأ صفراً (لا `NaN` ولا استثناء)، و`itemId` الغائب يُستبعد لأنه لا يُطابَق بشيء.
 */
export function mapOfficialStock(
  rows: readonly OfficialStockRowDto[] | null | undefined,
): OfficialStockRowForEstimate[] {
  return (rows ?? [])
    .filter((row): row is OfficialStockRowDto => typeof row?.itemId === 'string' && row.itemId.length > 0)
    .map((row) => ({
      itemId: String(row.itemId),
      warehouseId: row.warehouseId ?? null,
      quantity: row.quantity === null || row.quantity === undefined ? '0' : String(row.quantity),
      averageCost: row.averageCost === null || row.averageCost === undefined ? '0' : String(row.averageCost),
    }));
}

/** ‏`factory_production_batches.status` — وغير المعروف يُعرض خاماً بدل تسميةٍ مُختلَعة. */
export function batchStatusLabel(status?: string | null): string {
  switch (status) {
    case 'active':
      return 'نشطة (تُصرف منها الأحمال)';
    case 'exhausted':
      return 'استُنفدت الكمية';
    case 'closed':
      return 'مُقفلة';
    default:
      return status ? String(status) : '—';
  }
}

/**
 * ‏`cost_basis` (الترحيل 0127): التكلفة الفعلية هي ما صُرف عبر أمر التصنيع الرسمي؛ وما
 * عداها تكلفةٌ مدخلة أو من بطاقة الصنف، وتُعرض بوسم تحذير لا بوسم نجاح.
 */
export function costBasisLabel(basis?: string | null): { text: string; tone: 'ok' | 'warn' } {
  if (basis === 'manufacturing_order') {
    return { text: 'تكلفة فعلية من أمر تصنيع رسمي', tone: 'ok' };
  }
  if (basis === 'manual_input') {
    return { text: 'تكلفة مدخلة يدوياً — ليست من أمر تصنيع رسمي', tone: 'warn' };
  }
  if (basis === 'item_cost') {
    return { text: 'تكلفة من بطاقة الصنف — ليست من أمر تصنيع رسمي', tone: 'warn' };
  }
  return { text: basis ? `أساس التكلفة: ${String(basis)}` : 'أساس التكلفة غير مُعاد من الخادم', tone: 'warn' };
}

/** سطور مكوّنات فارغة للبداية — وسطرٌ لم يُمسّ يتجاهله العقد المشترك ولا يُرسل. */
export function emptyComponentRows(count = 2): Array<{ itemId: string; qty: string }> {
  return Array.from({ length: Math.max(1, count) }, () => ({ itemId: '', qty: '' }));
}

/** تاريخ اليوم بحساب UTC — والخادم هو من يفصل في التأريخ النهائي (قرارٌ معلّق في §10). */
export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------
 * جدولُ الدفعات على `DataTable` — الشاشةُ تُعلن الأعمدةَ والحالة، والنظام يرسم.
 *
 * والأعمدةُ هي ذاتُ أعمدة الجدول اليدويّ الذي كانت ترسمه الصفحة (رقم الدفعة،
 * التاريخ، الصنف، المستودع، المنتَج، الفاقد، تكلفة الوحدة، أساس التكلفة، الحالة)
 * — فالترحيلُ لا يغيّر ما يُقرأ، بل كيف يُرسم: فرزٌ وإخفاءُ أعمدةٍ محفوظٌ
 * ورأسٌ لاصقٌ بدل جدولٍ ثابت.
 * ------------------------------------------------------------------------ */

/** أعمدةُ جدول الدفعات — إعلانٌ في منطق الشاشة النقيّ (يثبّته الاختبار). */
export const BATCH_COLUMNS: readonly ScreenColumn[] = [
  { key: 'batchNo', labelAr: 'رقم الدفعة', ltr: true },
  { key: 'productionDate', labelAr: 'التاريخ', ltr: true },
  { key: 'itemName', labelAr: 'الصنف' },
  { key: 'warehouseName', labelAr: 'المستودع' },
  { key: 'producedQty', labelAr: 'المنتَج', numeric: true },
  { key: 'scrapQty', labelAr: 'الفاقد', numeric: true },
  { key: 'unitCost', labelAr: 'تكلفة الوحدة', numeric: true },
  { key: 'costBasisText', labelAr: 'أساس التكلفة' },
  { key: 'statusText', labelAr: 'الحالة' },
];

/** صفُّ الدفعة كما يُعرض — الحقولُ المشتقة تُحسب مرةً واحدةً هنا لا في كلّ خلية. */
export type ProductionBatchViewRow = ProductionBatchRow & {
  warehouseName: string;
  costBasisText: string;
  statusText: string;
};

/**
 * صفوفُ العرض من صفوف الخادم: اسمُ المستودع من بطاقته (لا معرّفًا خامًا)،
 * وأساسُ التكلفة والحالة بتسمياتهما العربية — غير المعروف يُعرض خامًا
 * كما يفعل `costBasisLabel` و`batchStatusLabel` ولا يُترجم إلى اسمٍ مُختلَع.
 */
export function batchViewRows(
  batches: readonly ProductionBatchRow[] | null | undefined,
  warehouses: readonly WarehouseOption[],
): ProductionBatchViewRow[] {
  return (batches ?? []).map((row) => {
    const warehouseId = row.warehouseId;
    const found =
      typeof warehouseId === 'string' && warehouseId.length > 0
        ? warehouses.find((candidate) => candidate.id === warehouseId)
        : undefined;
    return {
      ...row,
      warehouseName: !warehouseId ? '—' : found ? warehouseLabel(found) : warehouseId,
      costBasisText: costBasisLabel(row.costBasis).text,
      statusText: batchStatusLabel(row.status),
    };
  });
}

/**
 * قارئُ الخلية — القواعدُ الأربع نفسها التي في `reports-screen.cellText`
 * (نصٌّ/رقمٌ/منطقيّ وما عداها «—»): فالغائبُ «—» لا صفرٌ مُختلَع، والرقمُ
 * الذي يُحاذى بعمودٍ رقميٍّ يُنسَّق كما يُنسَّق في كلّ جدولٍ مهاجر.
 */
export function batchCellText(
  row: ProductionBatchViewRow | null,
  column: ScreenColumn,
): string {
  const value = row ? (row as Record<string, unknown>)[column.key] : null;
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return column.numeric ? numberText(value) : String(value);
  if (typeof value === 'string') return column.numeric ? numberText(value) : value;
  return '—';
}

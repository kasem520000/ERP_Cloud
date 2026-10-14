import type { OfficialStockRowForEstimate } from '@erp/web-van/production';

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

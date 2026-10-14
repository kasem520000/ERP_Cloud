/**
 * 🔎 أبحاثٌ مشتركة بين شاشات واجهة المخابز — **دوالّ وأنواعٌ صافية** لا تعرف طلباً ولا شاشة.
 *
 * كانت هذه في `lib/production-screen.ts`؛ ولمّا احتاجتها شاشة التوزيع صارت هنا، لأنّ بديل
 * مشاركتها هو نسخها — ونسختان من `numberText` تعني شاشةً تعرض صفراً حيث الأخرى تعرض «—»،
 * أي رقمين مختلفين للحقيقة نفسها.
 *
 * القاعدة التي تحكمها: **لا اختراع**. الحقل الغائب `—` لا صفر، والاسم يُقرأ من أيٍّ من
 * تهجئات الخادم (`nameAr`/`name_ar`/`name`) لا من تسميةٍ مفترضة، والمستودع لا يُختار إن لم
 * يقل الخادم أيّها الرئيسي.
 */

export type ItemOption = {
  id: string;
  sku?: string | null;
  nameAr?: string | null;
  name_ar?: string | null;
  nameEn?: string | null;
  name?: string | null;
};

export type WarehouseOption = {
  id: string;
  code?: string | null;
  name?: string | null;
  nameAr?: string | null;
  name_ar?: string | null;
  isDefault?: boolean | null;
};

/** نصّ عددٍ كما جاء من الخادم — والغائب `—` لا صفرٌ مُختلَع. */
export function numberText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function itemLabel(row: ItemOption): string {
  const name = row.nameAr ?? row.name_ar ?? row.name ?? row.nameEn ?? null;
  const sku = row.sku ?? null;
  if (name && sku) return `${name} (${sku})`;
  return name ?? sku ?? row.id;
}

export function warehouseLabel(row: WarehouseOption): string {
  const name = row.nameAr ?? row.name_ar ?? row.name ?? null;
  const code = row.code ?? null;
  if (name && code) return `${name} (${code})`;
  return name ?? code ?? row.id;
}

/**
 * المستودع المقترح: الافتراضيّ في البطاقة أولاً، ثمّ ما تقول اللوحة إنه الرئيسي
 * (‏`mainWarehouseId`)، ثمّ الأول في القائمة — و`undefined` حين لا مستودع، فتبقى الخانة
 * فارغة ويقول الخادم كلمته (لا يُخترع مستودع).
 */
export function pickDefaultWarehouse(
  warehouses: readonly WarehouseOption[],
  mainWarehouseId?: string | null,
): WarehouseOption | undefined {
  const flagged = warehouses.find((row) => row.isDefault === true);
  if (flagged) return flagged;
  if (mainWarehouseId) {
    const main = warehouses.find((row) => row.id === mainWarehouseId);
    if (main) return main;
  }
  return warehouses[0];
}

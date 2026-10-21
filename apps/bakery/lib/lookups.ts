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
  /**
   * 🏷️ ‏`items.track_lot` كما يعود من `GET /organization/catalog/items` (صفوف drizzle ⇒
   * ‏camelCase). صنفٌ يُتتبَّع بالدفعات لا يجوز تحميل عهدته بلا دفعةٍ مُسمّاة (§5.1).
   */
  trackLot?: boolean | null;
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

export type PartyOption = {
  id: string;
  code?: string | null;
  name?: string | null;
  nameAr?: string | null;
  name_ar?: string | null;
  kind?: string | null;
  phone?: string | null;
  taxNo?: string | null;
  tax_no?: string | null;
};

export type CashLocationOption = {
  id: string;
  name?: string | null;
  nameAr?: string | null;
  name_ar?: string | null;
  kind?: string | null;
  /**
   * 💵 حسابُ الصندوق — وهو الذي يجعل سند القبض يُرحَّل. صندوقٌ بلا حسابٍ يُقبل في القائمة
   * ويُقال ذلك في اسمه: فاختياره يعني سندًا قد يبقى مسودةً، والمال قُبض فعلًا.
   */
  accountId?: string | null;
  account_id?: string | null;
  isDefault?: boolean | null;
  is_default?: boolean | null;
  branchId?: string | null;
};

export type AccountOption = {
  id: string;
  code?: string | null;
  nameAr?: string | null;
  name_ar?: string | null;
  nameEn?: string | null;
  type?: string | null;
  isPostable?: boolean | null;
  is_postable?: boolean | null;
};

export function partyLabel(row: PartyOption): string {
  const name = row.nameAr ?? row.name_ar ?? row.name ?? null;
  const code = row.code ?? null;
  if (name && code) return `${name} (${code})`;
  return name ?? code ?? row.id;
}

/** رقمُ العميل الضريبي كما كُتب في بطاقته — ولا يُخترع رقم. */
export function partyTaxNo(row: PartyOption): string | null {
  return row.taxNo ?? row.tax_no ?? null;
}

export function cashLocationLabel(row: CashLocationOption): string {
  const name = row.nameAr ?? row.name_ar ?? row.name ?? row.id;
  const hasAccount = (row.accountId ?? row.account_id ?? null) !== null;
  const flagged = row.isDefault === true || row.is_default === true;
  const suffix = [flagged ? 'افتراضيّ' : null, hasAccount ? null : 'بلا حسابٍ محاسبيّ']
    .filter((part): part is string => part !== null)
    .join(' · ');
  return suffix.length > 0 ? `${name} — ${suffix}` : name;
}

export function accountLabel(row: AccountOption): string {
  const name = row.nameAr ?? row.name_ar ?? row.nameEn ?? null;
  const code = row.code ?? null;
  if (name && code) return `${code} — ${name}`;
  return name ?? code ?? row.id;
}

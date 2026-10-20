/**
 * 🧰 جسرُ شاشات المخابز إلى نظام التصميم `@erp/ui` — ولا مكوّنَ جديدَ هنا.
 *
 * ‏**لماذا هذا الملفّ**: شاشاتُ المخابز كانت تستعمل خمسةَ مكوّناتٍ فقط من النظام
 * (‏`Button`, `Card`, `CardBody`, `CardHeader`, `Input`) وتبني **اثني عشر جدولًا يدويًّا**
 * (`<table className="w-full border-collapse text-[12.5px]">`) وثلاثَ نسخٍ من `selectClass`
 * وفقرةَ تنبيهٍ منسوخةً في كلّ صفحة. والنظامُ يملك أصلًا ما تحتاجه الشاشات: ‏`DataTable`
 * (رأسٌ لاصق، فرزٌ، مُختارُ أعمدةٍ محفوظٌ في `localStorage`، ترقيمُ صفحاتٍ «n من m»،
 * و**أربعُ حالاتٍ صادقة**: فارغ/تحميل/خطأ/ممنوع — «بلا صمتٍ أبدًا» بحسب §6.1 من Design v3)،
 * و`Kpi` (بطاقةُ رقمٍ بدلالةٍ واتّجاه)، و`EmptyState`، و`Skeleton`، و`Badge`/‏`statusTone`
 * (نبرةُ الحالة من اسمها لا من ذوق كلّ شاشة)، و`Select`/‏`MoneyField`/‏`DateRangePicker`.
 *
 * وما هنا **ثلاثةُ محوّلاتٍ فقط** — لا مكوّناتٌ ولا أنماطٌ جديدة:
 *
 * 1. `tableColumns`: إعلانُ أعمدةِ الشاشة (`{key, labelAr, numeric?, ltr?}` — وهو الشكلُ
 *    الموجود أصلًا في `reports-screen.ts` و`sales-screen.ts`) إلى `Column<T>` الذي تقرأه
 *    ‏`DataTable`. فالإعلانُ يبقى في منطق الشاشة النقيّ (حيث تُثبته الاختبارات) والرسمُ
 *    للنظام.
 * 2. `listState`: حالةُ الشاشة (`loading`/`error`/`forbidden`) إلى `TableState` — فلا table
 *    يُرسم فارغًا بينما الطلبُ في الطريق، ولا يُعرض «لا بيانات» مكانَ «لا صلاحية».
 * 3. `rowKeyFrom`: مفتاحُ الصفّ من أوّل حقلٍّ موجودٍ من قائمة — فجداولُ التقرير تُعرِّف
 *    صفوفَها بـ`id` وجدولُ المندوبين بـ`salesmanId`، ومفتاحٌ ثابتٌ لكلّ الجداول يعني
 *    صفوفًا تتبادل حالتَها عند الفرز.
 *
 * والقاعدةُ التي تحكم الهجرة: **الشاشةُ تُعلن الأعمدةَ والحالة، والنظامُ يرسم**. فمن أضاف
 * عمودًا في منطق الشاشة ظهر في الجدول بفرزه وإخفائه ومحاذاة أرقامه، بلا JSX يُلمس.
 */
import type { Column, TableState } from '@erp/ui';

/** شكلُ إعلان العمود في منطق الشاشة — ومتوافقٌ بنيويًّا مع `ReportColumn` في `reports-screen`. */
export type ScreenColumn = {
  readonly key: string;
  readonly labelAr: string;
  /** رقمٌ يُحاذى بجدولٍ رقميٍّ (`tabular-nums`) — فالمحاذاةُ لليمين تُفسد مقارنةَ الأعمدة. */
  readonly numeric?: boolean;
  /** مُعرِّفٌ لاتينيّ يُعرض LTR كي لا ينقلب داخل جملةٍ عربية. */
  readonly ltr?: boolean;
  /** عمودٌ عريضٌ قلّما يُقرأ: يُخفى مبدئيًّا ويُستدعى من مُختار الأعمدة. */
  readonly defaultHidden?: boolean;
};

/**
 * إعلانُ الأعمدة ⇒ أعمدةُ `DataTable`.
 *
 * ‏`readCell` هي قارئُ الخلية الموجود في منطق الشاشة (`cellText` في `reports-screen`) فلا
 * تُكتب قاعدةُ عرضٍ ثانيةٌ هنا: وما ليس نصًّا ولا رقمًا ولا منطقيًّا يُعرض «—» هناك لا
 * ‏«[object Object]» هنا. وكلُّ عمودٍ يُفرز ويُخفى (`sortable`, `hideable`) لأنّ هذا هو
 * سببُ استعمال الجدول المشترك بدل جدولٍ يدويّ.
 */
export function tableColumns<T>(
  columns: readonly ScreenColumn[],
  readCell: (row: T, column: ScreenColumn) => string,
): Column<T>[] {
  return columns.map((column) => ({
    key: column.key,
    header: column.labelAr,
    cell: (row: T) => readCell(row, column),
    numeric: column.numeric ?? false,
    ltr: column.ltr ?? false,
    sortable: true,
    hideable: true,
    defaultHidden: column.defaultHidden ?? false,
  }));
}

/**
 * حالةُ القائمة ⇒ `TableState` بأربع حالاتٍ صادقة.
 *
 * والترتيبُ مقصود: **الممنوعُ قبل التحميل قبل الخطأ**. فلو عُرض «يُحمَّل» على شاشةٍ لا
 * صلاحيةَ لها لانتظر المستخدمُ تحميلًا لا يحدث، ولو عُرض «لا بيانات» مكانَ الخطأ لقِيل
 * إنّ السجلّ فارغٌ وهو طلبٌ فشل.
 */
export function listState(input: {
  loading?: boolean;
  error?: string | null;
  forbidden?: boolean;
  forbiddenMessage?: string;
}): TableState {
  if (input.forbidden) return { kind: 'forbidden', message: input.forbiddenMessage ?? undefined };
  if (input.loading) return { kind: 'loading' };
  if (input.error) return { kind: 'error', message: input.error };
  return { kind: 'ready' };
}

/**
 * مفتاحُ الصفّ من أوّل حقلٍّ موجودٍ من القائمة، وإلا الموضع.
 *
 * ومفتاحُ الصفّ ليس تفصيلًا: فبه تُحفظ حالةُ التحديد والصفُّ النشط، وبه يعرف الجدولُ أنّ
 * الصفَّ نفسه انتقل بعد الفرز. ومفتاحٌ ثابتٌ (‏`id`) على جدولٍ صفوفُه بلا `id` (كجدول
 * أداء المندوبين) يعني مفاتيحَ `undefined` مكرّرة.
 */
export function rowKeyFrom(
  fields: readonly string[],
): (row: Record<string, unknown>, index: number) => string {
  return (row, index) => {
    for (const field of fields) {
      const value = row ? row[field] : undefined;
      if (typeof value === 'string' && value.trim().length > 0) return value;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return `row-${index}`;
  };
}

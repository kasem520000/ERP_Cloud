/**
 * 🪟 نوافذ اللوحة كما **يعلنها الخادم** — لا كما تحفظها الشاشة رقمًا ثابتًا.
 *
 * استجابة `GET /van-sales/dashboard` تحمل قوائمَ محدودةً بـ`LIMIT` في استعلاماتها (٥٠ دفعة
 * إنتاج، ٦٠ أمر تحميل، ١٢٠ مستند بيع، ٨٠ حركة، ٥٠ سجل تسعير)، وتحمل معها `windows`: ما
 * رجعته كلّ قائمةٍ وما في جدولها. وأمّا `summary` فجمعُ الجدول كلّه (بلا `LIMIT`) — وهذا
 * الفرقُ هو ما جعل الأرقام الكاملة تُعرض بجانب قوائمَ ناقصة بلا قول، فأُعلن العددان.
 *
 * والقاعدة هنا: **لا رقمَ يُخترع**. فإن لم يُرجع الخادم `windows` (أو أرجع صفًّا ناقصًا أو
 * فاسدًا) تُعرض الجملةُ الاحتياطية المكتوبة في شاشة المستند — وهي صادقةٌ في حدود ما تعرفه
 * (حدُّ النافذة من الاستعلام) — بدل عددٍ مخمَّن عن حجم الجدول.
 */

export interface DashboardWindow {
  /** ما رجعته القائمة فعلًا. */
  returned: number;
  /** ما في الجدول كلّه (بلا `LIMIT`) — ومنه يُعرف أنّ القائمة ناقصة. */
  total: number;
  /** حدُّ النافذة في استعلام الخادم. */
  limit: number;
}

export type DashboardWindowKey =
  | 'productionBatches'
  | 'loadOrders'
  | 'documents'
  | 'movements'
  | 'customerPriceHistory';

/** كلّ المفاتيح اختيارية: فغيابُ أحدها يعني «لا أعرف»، لا «صفر». */
export type DashboardWindows = Partial<Record<DashboardWindowKey, DashboardWindow>>;

export const WINDOW_LABELS: Record<DashboardWindowKey, string> = {
  productionBatches: 'دفعات الإنتاج',
  loadOrders: 'أوامر التحميل',
  documents: 'مستندات البيع',
  movements: 'حركات الخطّ',
  customerPriceHistory: 'سجلُّ تسعير العملاء',
};

/** ذيلٌ ثابت يُقال مع كلّ نافذة ناقصة: فالرقم الكامل ليس جمعَ الصفوف المعروضة. */
const TOTALS_CLAUSE = 'أرقامُ summary جمعُ الجدول كلّه لا جمعُ هذه الصفوف';

function isWindow(entry: unknown): entry is DashboardWindow {
  if (entry === null || typeof entry !== 'object') return false;
  const candidate = entry as Record<string, unknown>;
  return (
    Number.isFinite(candidate.returned) &&
    Number.isFinite(candidate.total) &&
    Number.isFinite(candidate.limit)
  );
}

/** هل القائمة كلّ السجلّ؟ — فلا يُقال «ناقصة» عن قائمةٍ كاملة، ولا «كاملة» عن ناقصة. */
export function windowIsComplete(entry: DashboardWindow | null | undefined): boolean {
  if (!isWindow(entry)) return false;
  return Number(entry.total) <= Number(entry.returned);
}

/**
 * جملةُ النافذة للعرض. و`fallback` هي الجملةُ المكتوبة في الشاشة (حدُّ النافذة من استعلام
 * الخادم) وتُعرض حين لا يقول الخادم كم في الجدول — فلا يُخترع رقم.
 */
export function windowNote(
  windows: DashboardWindows | null | undefined,
  key: DashboardWindowKey,
  fallback: string,
): string {
  const entry = windows?.[key];
  const label = WINDOW_LABELS[key];
  if (!isWindow(entry)) return fallback;
  if (windowIsComplete(entry)) {
    return `${label}: ${entry.returned} من ${entry.total} — القائمة كلّ السجلّ، ولا صفوف خارجها.`;
  }
  const missing = Number(entry.total) - Number(entry.returned);
  return (
    `${label}: ${entry.returned} من ${entry.total} (نافذةُ الخادم LIMIT ${entry.limit}) — ` +
    `${missing} صفًّا خارج هذه القائمة، و${TOTALS_CLAUSE}.`
  );
}

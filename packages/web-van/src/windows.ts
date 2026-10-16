/**
 * 🪟 نوافذُ القراءة كما **يعلنها الخادم** — تنفيذٌ واحدٌ لكلّ وجهٍ يعرض قوائمَ التوزيع.
 *
 * ‏`GET /van-sales/dashboard` و`GET /van-sales/me` يحملان قوائمَ محدودةً بـ`LIMIT` في
 * استعلاماتها، ويحملان معها `windows`: ما رجعته كلّ قائمةٍ وما في جدولها وحدَّها. وأمّا
 * المجاميع (`summary` في اللوحة، و`totals`/‏`custody` عند المندوب) فجمعُ الجدول كلّه بلا
 * `LIMIT` — وهذا الفرقُ هو ما جعل أرقامًا كاملةً تُعرض بجانب قوائمَ ناقصةٍ بلا قول، فأُعلن
 * العددان.
 *
 * **ولماذا هنا لا في كلّ تطبيق:** كانت الجملةُ في `apps/bakery/lib/dashboard-windows.ts`
 * وحدها، وشاشةُ المندوب في `apps/staff` تعرض قوائمَ ناقصةً بلا جملة، وتطبيقُ المندوب
 * (‏`/rep`) سيحتاجها أيضًا — فثلاثةُ أوجهٍ كانت ستكتب الجملةَ نفسها ثلاثَ مرّات وتتباعد.
 *
 * والقاعدةُ هنا: **لا رقمَ يُخترع**. فإن لم يُرجع الخادم `windows` (أو أرجع صفًّا ناقصًا أو
 * فاسدًا) تُعرض الجملةُ الاحتياطيةُ التي تكتبها الشاشة — وهي صادقةٌ في حدود ما تعرفه
 * (حدُّ النافذة من الاستعلام) — بدل عددٍ مخمَّنٍ عن حجم الجدول.
 */

export interface DashboardWindow {
  /** ما رجعته القائمة فعلًا. */
  returned: number;
  /** ما في الجدول كلّه (بلا `LIMIT`) — ومنه يُعرف أنّ القائمة ناقصة. */
  total: number;
  /** حدُّ النافذة في استعلام الخادم. */
  limit: number;
}

/**
 * مفاتيحُ النوافذ في الوجهين معًا: فلوحةُ الخطّ تُعلن `productionBatches` و`loadOrders` و
 * `documents` و`movements` و`customerPriceHistory` (‏`dashboard()`)، ومساحةُ عمل المندوب
 * تُعلن `loadOrders` و`documents` و`collections` و`notifications` (‏`repWorkspace`). وأمّا
 * `balances` و`pendingReceipts` فكاملتان في استعلاميهما (بلا `LIMIT`) ⇒ **لا نافذةَ لهما**
 * ولا مفتاحَ هنا، وهذا مقيسٌ في حكم الخادم لا مفترضٌ في العميل.
 */
export type DashboardWindowKey =
  | 'productionBatches'
  | 'loadOrders'
  | 'documents'
  | 'movements'
  | 'customerPriceHistory'
  | 'collections'
  | 'notifications';

/** كلّ المفاتيح اختيارية: فغيابُ أحدها يعني «لا أعرف»، لا «صفر». */
export type DashboardWindows = Partial<Record<DashboardWindowKey, DashboardWindow>>;

export const WINDOW_LABELS: Record<DashboardWindowKey, string> = {
  productionBatches: 'دفعات الإنتاج',
  loadOrders: 'أوامر التحميل',
  documents: 'مستندات البيع',
  movements: 'حركات الخطّ',
  customerPriceHistory: 'سجلُّ تسعير العملاء',
  collections: 'حركات التحصيل',
  notifications: 'الإشعارات',
};

/** الذيلُ الافتراضيّ: فأيًّا كان الوجه، المجاميعُ ليست جمعَ الصفوف المعروضة. */
export const DEFAULT_TOTALS_CLAUSE = 'المجاميعُ جمعُ الجدول كلّه لا جمعُ هذه الصفوف';

/**
 * ذيلُ أوجه **لوحة الخطّ** (`GET /van-sales/dashboard`): فالمجاميعُ هناك اسمُها `summary`
 * في الحمولة، وتقولها شاشةُ المبيعات والتحصيل والتقارير في المخابز وشاشةُ التوزيع في
 * الطاقم — نصٌّ واحدٌ هنا كي لا تكتبه أربعُ شاشاتٍ بأربع صيغ.
 */
export const DASHBOARD_TOTALS_CLAUSE = 'أرقامُ summary جمعُ الجدول كلّه لا جمعُ هذه الصفوف';

/** ذيلُ أوجه **المندوب** (`GET /van-sales/me`): فالمجاميعُ هناك `totals` و`custody`. */
export const REP_TOTALS_CLAUSE = 'أرقامُ المندوب جمعُ جدوله كلّه لا جمعُ هذه الصفوف';

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
 * جملةُ النافذة للعرض.
 *
 * ‏- `fallback`: الجملةُ المكتوبة في الشاشة (حدُّ النافذة من استعلام الخادم)، وتُعرض حين لا
 *   يقول الخادم كم في الجدول — فلا يُخترع رقم.
 * ‏- `totalsClause`: اسمُ المجاميع في ذلك الوجه، فتقول اللوحةُ «أرقامُ summary …» وتقول
 *   شاشةُ المندوب «أرقامُ المندوب …» — والجملةُ تُبنى هنا مرّةً واحدةً ويختار الوجهُ
 *   مفردتَه وحدها.
 */
export function windowNote(
  windows: DashboardWindows | null | undefined,
  key: DashboardWindowKey,
  fallback: string,
  options?: { totalsClause?: string },
): string {
  const entry = windows?.[key];
  const label = WINDOW_LABELS[key];
  if (!isWindow(entry)) return fallback;
  if (windowIsComplete(entry)) {
    return `${label}: ${entry.returned} من ${entry.total} — القائمة كلّ السجلّ، ولا صفوف خارجها.`;
  }
  const clause = options?.totalsClause ?? DEFAULT_TOTALS_CLAUSE;
  const missing = Number(entry.total) - Number(entry.returned);
  return (
    `${label}: ${entry.returned} من ${entry.total} (نافذةُ الخادم LIMIT ${entry.limit}) — ` +
    `${missing} صفًّا خارج هذه القائمة، و${clause}.`
  );
}

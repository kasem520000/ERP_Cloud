/**
 * 🪟 نوافذُ لوحة الخطّ — **غلافٌ رقيق** حول التنفيذ المشترك في `@erp/web-van/windows`.
 *
 * وكان التنفيذُ هنا وحده، وشاشةُ المندوب في `apps/staff` تعرض قوائمَ ناقصةً بلا جملة،
 * وتطبيقُ المندوب (`/rep`) سيحتاجها — فثلاثةُ أوجهٍ كانت ستكتب الجملةَ نفسها ثلاثَ مرّات
 * وتتباعد. رُفع التنفيذُ إلى الحزمة المشتركة (ومعها مفاتيحُ نوافذ المندوب: ‏`collections`
 * و`notifications`)، وبقي هنا ما يخصّ هذا الوجه وحده: **مفردةُ المجاميع**. فاللوحةُ تعرض
 * `summary` والجملةُ تقول «أرقامُ summary …» بالضبط كما كانت، والمندوبُ يعرض `totals`
 * فيقول «أرقامُ المندوب …» — والبناءُ واحدٌ في الحزمة.
 *
 * والقاعدةُ كما هي: **لا رقمَ يُخترع**، فغيابُ `windows` (أو صفٌّ ناقص/فاسد) يُعرض معه
 * `fallback` المكتوب في الشاشة بدل عددٍ مخمَّن.
 */
import {
  DASHBOARD_TOTALS_CLAUSE as SHARED_DASHBOARD_TOTALS_CLAUSE,
  windowIsComplete as sharedWindowIsComplete,
  windowNote as sharedWindowNote,
  type DashboardWindow,
  type DashboardWindowKey,
  type DashboardWindows,
  WINDOW_LABELS as SHARED_WINDOW_LABELS,
} from '@erp/web-van/windows';

export type { DashboardWindow, DashboardWindowKey, DashboardWindows };

export const WINDOW_LABELS = SHARED_WINDOW_LABELS;

/**
 * ذيلُ الجملة في هذا الوجه — **من الحزمة المشتركة** لا منسوخًا هنا: فالمفردةَ نفسها تقولها
 * شاشةُ التوزيع في الطاقم، ونسختان من نصٍّ واحد تتباعدان.
 */
export const DASHBOARD_TOTALS_CLAUSE = SHARED_DASHBOARD_TOTALS_CLAUSE;

export function windowIsComplete(entry: DashboardWindow | null | undefined): boolean {
  return sharedWindowIsComplete(entry);
}

export function windowNote(
  windows: DashboardWindows | null | undefined,
  key: DashboardWindowKey,
  fallback: string,
): string {
  return sharedWindowNote(windows, key, fallback, { totalsClause: DASHBOARD_TOTALS_CLAUSE });
}

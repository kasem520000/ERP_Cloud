/**
 * 📅 «اليوم» في تقويم مكة — لا `new Date().toISOString().slice(0, 10)` الذي يقرأ **UTC**.
 *
 * العطبُ مقاسٌ لا مقدَّر: الخادم مضبوط على `Asia/Riyadh` (+03) في `main.ts`، فبين
 * **00:00 و03:00** بتوقيت مكة يكون تاريخُ UTC هو **أمس**. فكلُّ سندٍ أو فاتورةٍ أو قيدٍ
 * يُنشأ في تلك الساعات كان يُؤرَّخ بيومٍ سابق: فاتورةٌ ضريبية بتاريخ أمس، وحركةُ مخزونٍ
 * تسبق مستندها، وحركةٌ في آخر الشهر تقع في الشهر الماضي (وقد يكون مرحَّلاً أو مغلقاً).
 *
 * والمصدرُ واحدٌ في المنصّة أصلاً: نقاط البيع وبطاقات الطباعة وتجهيز المنشآت ورواتب
 * الموارد البشرية تُنسّق اليوم بـ`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' })`.
 * وهذا الملفُّ يجمعها في دالّةٍ واحدةٍ مختبَرة (`test/server-date.spec.ts`) بدل ثلاث نسخ.
 *
 * ولماذا `en-CA`؟ تنسيقُها الافتراضي `YYYY-MM-DD` — وهو الشكلُ الذي تقبله أعمدة
 * `date` ومسطرة `isRealCalendarDay` في `date-param.ts`، بلا تحويلٍ يدويٍّ للشهور.
 */

/** المنطقة الزمنية للمنشأة — مكة المكرمة (توقيت السعودية، بلا توقيتٍ صيفي). */
export const BUSINESS_TIME_ZONE = 'Asia/Riyadh';

/**
 * مُنسِّقٌ واحدٌ لكل منطقة: `Intl.DateTimeFormat` بناؤه مكلف، وهذا يُستدعى في كل
 * مستندٍ (بل في حلقات المخزون). والتخزينُ مفتاحُه المنطقة، فلا يختلط مُنسِّقٌ بغيره.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

/**
 * يومٌ تقويميٌّ (`YYYY-MM-DD`) للحظةٍ ما **بتوقيت المنطقة** — والافتراضي مكة.
 *
 * ومنطقةٌ غير معروفة (`Asia/Riyadhh` مثلاً) لا تُسقِط المستند: نعود إلى مكة، وهي
 * المرجعُ المتفق عليه، بدل أن نرمي استثناءً في منتصف إنشاء فاتورة.
 */
export function isoDayInTimezone(at: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  try {
    return formatterFor(timeZone).format(at);
  } catch {
    return formatterFor(BUSINESS_TIME_ZONE).format(at);
  }
}

/** يومُ اليوم في مكة — بديلُ `new Date().toISOString().slice(0, 10)` في تواريخ المستندات. */
export function todayIso(now: Date = new Date()): string {
  return isoDayInTimezone(now, BUSINESS_TIME_ZONE);
}

/** يومُ مكة بعد/قبل `days` يوماً من `now` — للمهل ونهايات الاستحقاق في الاختبارات والوحدات. */
export function dayOffsetIso(days: number, now: Date = new Date()): string {
  return isoDayInTimezone(new Date(now.getTime() + days * 86_400_000), BUSINESS_TIME_ZONE);
}

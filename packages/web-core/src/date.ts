/**
 * 🗓️ «اليوم» بتوقيت المنشأة (مكة) — للمتصفّح كما للخادم.
 *
 * `new Date().toISOString().slice(0, 10)` يقرأ **UTC**؛ فمستخدمٌ في مكة يفتح شاشة السند
 * في الساعة 01:00 يجد التاريخ الافتراضي **أمس**. والخادم يؤرّخ بتوقيت مكة (`apps/api/src/common/server-date.ts`
 * بالقاعدة نفسها)، فصندوقُ تاريخٍ يعرض «أمس» ينتج مستنداً بتاريخٍ غير مقصود.
 *
 * والقاعدة هنا واحدةٌ للجميع: اليومُ التقويميُّ للحظةٍ ما في `Asia/Riyadh`. والنصُّ الذي
 * هو تاريخٌ أصلاً (`YYYY-MM-DD` من الخادم) يُعاد كما هو — لا يُزاح بتوقيت المتصفح.
 */

/** المنطقة الزمنية للمنشأة — مكة المكرمة (توقيت السعودية، بلا توقيتٍ صيفي). */
export const MAKKAH_TIME_ZONE = 'Asia/Riyadh';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
 * اليومُ التقويميُّ (`YYYY-MM-DD`) للحظةٍ ما بتوقيت مكة.
 *
 * - نصٌّ تاريخيٌّ (`2026-03-01`) يُعاد كما هو: تحويله إلى `Date` ثم إلى مكة يوافق نفس
 *   اليوم، لكن الإعادة المباشرة تُبقي القيمة بلا اعتمادٍ على ساعة المتصفح أو منطقته.
 * - قيمةٌ غير صالحة تُعيد `''` بدل `Invalid Date` في صندوق تاريخ.
 */
export function dayInMakkah(value: Date | string | number = new Date()): string {
  if (typeof value === 'string' && CALENDAR_DAY.test(value.trim())) return value.trim();
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return formatterFor(MAKKAH_TIME_ZONE).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** تاريخ اليوم في مكة — الافتراضي في صناديق التاريخ والشاشات. */
export function todayInMakkah(): string {
  return dayInMakkah(new Date());
}

/** يومُ مكة بعد/قبل `days` يوماً (مهلٌ وتواريخ استحقاق). */
export function addDaysInMakkah(days: number, now: Date = new Date()): string {
  return dayInMakkah(new Date(now.getTime() + days * 86_400_000));
}

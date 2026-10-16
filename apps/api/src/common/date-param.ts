import { DomainError } from '@erp/contracts';

/**
 * 📅 مسطرةٌ واحدةٌ لتواريخ الطلبات وأوقاتها — **قبل** أن تصل إلى SQL.
 *
 * والسببُ مقاسٌ لا مقدَّر (‏2026-10-16): ‏`GET /api/v1/journal-entries?from=أمس` ⇒ **٥٠٠**
 * ‏`{"code":"INTERNAL","detail":"An unexpected error occurred"}`، و`?from=2026-02-30` ⇒ **٥٠٠**
 * كذلك؛ و`GET /api/v1/reports/sales-invoices?from=أمس` ⇒ ٤٢٢ «Expected YYYY-MM-DD» (فالتقاريرُ
 * تتحقّق من **الشكل**) لكن `?from=2026-02-30` ⇒ **٥٠٠** لأنّ الشكلَ سليمٌ والتقويمَ لا يحمل
 * اليوم. أي أنّ خطأَ إدخالٍ في صندوق تاريخٍ كان يُخرج «خطأً داخليًّا» بلا جملةٍ مقروءة،
 * وفي Reports كان يُخرج خطأَ قاعدةٍ (`22P02 invalid input syntax for type date`) أو قلبًا
 * صامتًا للتاريخ (‏`2026-02-30` ⇒ ٢ مارس في بعض المسارات).
 *
 * فالمسطرةُ هنا فحصان لا واحد: **الشكل** (`YYYY-MM-DD`) ثمّ **أنّ التقويمَ يحمل اليوم** —
 * والثاني بمقارنة النصّ بما تُنتجه `Date` من نفسها، فلا يُحتاج إلى جدولِ أطوال الشهور ولا
 * إلى قاعدةٍ كبيسةٍ مكتوبةٍ يدًا.
 *
 * وأمّا الأوقات فـ`reporting.service.ts` تملك `timeish` صارمةً أصلًا (وتعليقُها يشرح السببَ
 * نفسه: «a looser regex lets `99:99` through to Postgres, which answers with a 500 instead of
 * the 422 a wrong filter deserves») — و`parseClockParam` هنا هي القاعدةُ نفسها للوحدات التي
 * ترمي `::time` بلا zod.
 */

/** الشكلُ وحده لا يكفي: ‏`2026-02-30` تطابقه ولا يحملها التقويم. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** هل النصُّ يومٌ حقيقيٌّ في التقويم الميلادي (لا شكلُ يومٍ فحسب)؟ */
export function isRealCalendarDay(text: string): boolean {
  if (!DAY_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** هل النصُّ وقتٌ حقيقيّ (`HH:mm` أو `HH:mm:ss`)؟ — النمطُ نفسه الذي في `timeish`. */
export function isRealClockTime(text: string): boolean {
  return CLOCK_PATTERN.test(text);
}

export type ParamOptions = {
  /** اسمُ الحقلّ في غلاف الخطأ (`errors[].field`) — كما يسمّيه الطلب لا كما يسمّيه العمود. */
  field: string;
  /** تسميةٌ عربيةٌ مقروءة في الجملة («من تاريخ»، «إلى تاريخ»…). */
  labelAr: string;
  /** رمزُ الخطأ — لكلّ وحدةٍ رمزُها القائم إن وُجد، وإلا `DATE_PARAM_INVALID`. */
  code?: string;
};

/**
 * تاريخٌ من طلب. والفراغُ ⇒ `null` (فالمستدعي يقرّر افتراضيَّه: «اليوم» في حركات الموظف،
 * وبلا حدٍّ في السجلات) — فالمسطرةُ تتحقّق ممّا كُتب لا ممّا تُرك.
 */
export function parseDayParam(
  value: string | null | undefined,
  options: ParamOptions,
): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const { field, labelAr, code = 'DATE_PARAM_INVALID' } = options;
  if (!DAY_PATTERN.test(text))
    throw new DomainError(
      code,
      `${labelAr} غير صالح: «${text}» — المطلوبُ صيغةُ YYYY-MM-DD مثل 2026-10-16.`,
      422,
      { field },
    );
  if (!isRealCalendarDay(text))
    throw new DomainError(
      code,
      `${labelAr} ليس تاريخًا حقيقيًّا: «${text}» — فالتقويمُ لا يحمله.`,
      422,
      { field },
    );
  return text;
}

/** وقتٌ من طلب — والفراغُ `null` (فـ`coalesce(…::time, '00:00')` في SQL يبقى كما هو). */
export function parseClockParam(
  value: string | null | undefined,
  options: ParamOptions,
): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const { field, labelAr, code = 'TIME_PARAM_INVALID' } = options;
  if (!isRealClockTime(text))
    throw new DomainError(
      code,
      `${labelAr} غير صالح: «${text}» — المطلوبُ HH:mm أو HH:mm:ss (ساعاتٌ ٠٠–٢٣ ودقائقُ وثوانٍ ٠٠–٥٩).`,
      422,
      { field },
    );
  return text;
}

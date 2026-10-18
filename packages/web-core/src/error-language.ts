/**
 * Translate the presentation of a problem response without changing its HTTP status/code.
 * The API can return English, a proxy can return HTML, and 5xx details can expose internals;
 * none of those should become customer-facing text. Arabic business detail is preserved.
 */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'الطلب غير صالح. راجع المدخلات وحاول مجدداً.',
  401: 'انتهت الجلسة أو بيانات الدخول غير صحيحة. سجّل الدخول مجدداً.',
  403: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
  404: 'المورد المطلوب غير موجود.',
  409: 'تعارضت البيانات مع تحديث آخر. حدّث الصفحة وحاول مجدداً.',
  413: 'الملف أكبر من الحجم المسموح.',
  422: 'تعذّر قبول البيانات المدخلة. راجع الحقول وحاول مجدداً.',
  423: 'الحساب موقوف مؤقتاً. تواصل مع المسؤول.',
  429: 'محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً.',
  502: 'الخدمة غير متاحة الآن. حاول لاحقاً.',
  503: 'الخدمة غير متاحة الآن. حاول لاحقاً.',
  504: 'استغرق الطلب وقتاً أطول من المعتاد. حاول مجدداً.',
};

export function arabicErrorText(error: unknown, fallback = 'تعذّر الاتصال بالخدمة. حاول مجدداً.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /[\u0600-\u06ff]/.test(message) && !/[<>]/.test(message) ? message : fallback;
}

export function arabicProblem(
  status: number,
  title?: string,
  detail?: string,
): { message: string; detail?: string } {
  const fallback =
    STATUS_MESSAGES[status] ??
    (status >= 500 ? 'حدث خطأ في الخدمة. حاول لاحقاً.' : 'تعذّر إكمال الطلب. حاول مجدداً.');
  // Never show a raw stack trace, proxy HTML, or server internals on 5xx.
  if (status >= 500) return { message: fallback };
  const safeArabic = (text?: string) =>
    text?.trim() && /[\u0600-\u06ff]/.test(text) && !/[<>]/.test(text) ? text.trim() : undefined;
  const localizedDetail = safeArabic(detail);
  return { message: localizedDetail ?? safeArabic(title) ?? fallback, detail: localizedDetail };
}

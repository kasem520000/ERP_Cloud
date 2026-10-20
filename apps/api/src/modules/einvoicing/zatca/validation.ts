/**
 * 🧾 قواعد التحقق المحلية قبل الإرسال — ما ترفضه ZATCA شكلاً، نرفضه نحن قبل الرحلة.
 *
 * القيمة هنا ليست «نسخة من قواعد الهيئة» — هي منع مستندٍ خاطئ من استهلاك رقمٍ في السلسلة:
 * كل ملفٍّ يُرسل يأخذ ICV وPIH، وإعادة إرساله بعد الرفض تُربك السلسلة أو تحتاج تصحيحاً
 * يدوياً. فالفحص الرخيص يقع هنا، والرسالة عربية تشرح ما يجب تغييره.
 */

/** BR-KSA-44: ١٥ خانة، تبدأ بـ٣ وتنتهي بـ٣. */
const SAUDI_VAT = /^3\d{13}3$/;

/**
 * Normalises a buyer VAT number, or returns `null` when it cannot be valid.
 *
 * A number that is empty means a simplified (B2C) invoice — not an error. A number that is
 * *present but wrong* is the failure BR-KSA-44 exists for: the document would be built as a
 * standard invoice (because it carries a VAT field) with a value the authority rejects.
 */
export function normalizeVatNumber(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/[\s-]/g, '');
  if (!digits) return null;
  return SAUDI_VAT.test(digits) ? digits : null;
}

/** True when the tenant's own VAT number is well-formed — the seller side of BR-KSA-44. */
export function isValidSellerVat(value: string | null | undefined): boolean {
  return normalizeVatNumber(value) !== null;
}

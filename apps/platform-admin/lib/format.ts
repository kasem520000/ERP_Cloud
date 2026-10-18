/**
 * تنسيقات مشتركة لسطح المنصة.
 *
 * الأرقام لاتينية دائمًا، والتاريخ ISO معزول اتجاهيًا: خلية RTL كانت تقلب
 * «18‏/10‏/2027» إلى «182027/10/».
 */
export function dateText(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `\u2066${date.toISOString().slice(0, 10)}\u2069`;
}

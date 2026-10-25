/**
 * التعريب الكامل لرموز الصلاحيات في واجهة المخابز والتوزيع (`apps/bakery`).
 *
 * لا يظهر رمز الصلاحية الإنجليزي (`van_sales.*`، `sales.*`، `accounting.*`…) في الواجهة مطلقاً؛
 * بل تُعرض التسمية العربية الواضحة للصلاحية في رسائل التنبيه وحواجز الوصول.
 */
export const BAKERY_PERMISSION_LABELS_AR: Readonly<Record<string, string>> = {
  'van_sales.view': 'عرض التوزيع وحركة الخط',
  'van_sales.production.manage': 'إدارة دفعات الإنتاج اليومية',
  'van_sales.load.manage': 'إدارة أوامر التحميل وتوزيع العهدة',
  'van_sales.invoice.create': 'إصدار فواتير ومرتجعات التوزيع',
  'van_sales.collection.create': 'تسجيل سندات التحصيل من عملاء الخط',
  'van_sales.closing.submit': 'تقديم جرد وإغلاق وردية المندوب',
  'van_sales.closing.approve': 'اعتماد إغلاق العهدة وتسويتها',
  'van_sales.override.approve': 'اعتماد التجاوزات وسياسة التوزيع',
  'sales.salesman.manage': 'إدارة المناديب وربط حسابات الدخول',
  'sales.discount.override': 'تجاوز سقف الخصم المعتمد',
  'treasury.view': 'عرض سندات الخزينة',
  'organization.cashlocation.view': 'عرض الصناديق والحسابات النقدية',
  'accounting.reports.view': 'عرض التقارير المحاسبية',
  'accounting.account.view': 'عرض دليل الحسابات',
  'accounting.period.view': 'عرض الفترات المالية',
};

export function bakeryPermissionLabelAr(code: string): string {
  return BAKERY_PERMISSION_LABELS_AR[code.trim()] ?? 'صلاحية معتمدة للعملية';
}

export function formatRequiredPermissionsAr(codes: readonly string[]): string {
  const labels = codes.map((code) => bakeryPermissionLabelAr(code));
  return `الصلاحية المطلوبة غير متوفرة: ${labels.join(' أو ')}`;
}

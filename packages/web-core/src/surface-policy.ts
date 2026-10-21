/**
 * AUD-13 — تصنيف المسار حسب **حدّ المقطع** لا البادئة الخام.
 *
 * كان `AuthGate` في `apps/staff` يستعمل `startsWith('/m')` و`startsWith('/esign')`، فتطابق
 * `/marina` و`/migration` و`/manufacturing` قشرةَ الموظف، و`/esign-evil` يمرّ إلى الصفحة
 * العامة بلا جلسة. القاعدة هنا: المقطع كامل — المسار يساوي البادئة، أو يتبعها `/`.
 *
 * والآلية هنا والسياسة في التطبيق: **البادئات من كل واجهة** (staff: `/supplier-portal` و
 * `/esign` عامة، و`/m` قشرة موظف؛ والبوابة `platform-admin` بلا أسطح عامة ولا قشرة موظف)،
 * فالسياسة تُحقن ولا تُخمَّن — ومسارٌ عامّ مخمَّن هو ثغرة وصول لا ميزة.
 */

/** المطابقة بحدّ مقطع: `/m` و`/m/…` نعم، و`/mx` و`/marina` لا. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export type SurfacePolicy = {
  /** المسارات التي تصادق نفسها فلا تمرّ على البوابة. بادئات مطلقة (`/…`). */
  readonly publicPrefixes: readonly string[];
  /** مسار قشرة الموظف، إن كان للتطبيق واحدة. */
  readonly employeePrefix?: string;
  isPublicSurface(pathname: string): boolean;
  isEmployeeSurface(pathname: string): boolean;
};

/**
 * سياسة أسطح واجهةٍ واحدة.
 *
 * بلا بادئات ⇒ لا سطح عاماً (كل مسار يمرّ على فحص الجلسة)، وبلا `employeePrefix` ⇒ لا قشرة
 * موظف. والافتراض هو **الأضيق** لأن الخطأ في هذا الاتجاه يكلف نقرة دخول، والخطأ في الاتجاه
 * الآخر يكلف جلسةً مكشوفة.
 */
export function createSurfacePolicy(
  input: { publicPrefixes?: readonly string[]; employeePrefix?: string } = {},
): SurfacePolicy {
  const publicPrefixes = [...(input.publicPrefixes ?? [])];
  const employeePrefix = input.employeePrefix;
  return {
    publicPrefixes,
    employeePrefix,
    isPublicSurface: (pathname: string) =>
      publicPrefixes.some((prefix) => matchesPrefix(pathname, prefix)),
    isEmployeeSurface: (pathname: string) =>
      employeePrefix === undefined ? false : matchesPrefix(pathname, employeePrefix),
  };
}

/**
 * AUD-13 — أسطح **تطبيق الموظفين**: أي المسارات تصادق نفسها، وأيها قشرة الموظف.
 *
 * الآلية (المطابقة بحدّ مقطع لا ببادئة خام) في `@erp/web-core/surface-policy` — وهنا
 * السياسة وحدها، لأنها قرار هذه الواجهة: بوابة المورد وصفحة التوقيع العامة تصادقان
 * نفسيهما، و`/m` قشرة الموظف. وكانت القاعدة مطابقةً خاماً (`startsWith('/m')`) فتطابق
 * `/marina` و`/migration` و`/manufacturing` قشرةَ الموظف، و`/esign-evil` يمرّ بلا جلسة.
 */
import { createSurfacePolicy, matchesPrefix } from '@erp/web-core/surface-policy';

export { matchesPrefix };

/** مساراتٌ تصادق نفسها (بوابة المورد وصفحة التوقيع العامة) فلا تمرّ على AuthGate. */
const PUBLIC_PREFIXES = ['/supplier-portal', '/esign'] as const;

/** مسارات تطبيق الموظف (`/m`, `/m/…`) — قشرة مختلفة عن لوحة الإدارة. */
const EMPLOYEE_PREFIX = '/m';

export const SURFACE_POLICY = createSurfacePolicy({
  publicPrefixes: PUBLIC_PREFIXES,
  employeePrefix: EMPLOYEE_PREFIX,
});

export const isPublicSurface = SURFACE_POLICY.isPublicSurface;

export const isEmployeeSurface = SURFACE_POLICY.isEmployeeSurface;

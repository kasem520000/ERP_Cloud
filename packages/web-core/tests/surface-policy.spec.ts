import { describe, expect, it } from 'vitest';

import { createSurfacePolicy, matchesPrefix } from '../src/surface-policy';

/**
 * AUD-13 — حدود المسار: المقطع كاملاً لا البادئة الخام.
 *
 * هذه الأحكام كانت في `apps/staff/tests/surface-routing.spec.ts` على دوالّ staff، وصارت هنا
 * على الآلية نفسها في `@erp/web-core` (وبقيت في سبيك staff على سياسة staff: أي المسارات
 * عامة وأيها قشرة موظف). **لم يُخفَّف حكم**: `/marina` و`/migration` و`/manufacturing` ليست
 * تطبيق الموظف، و`/esign-evil` ليس سطحاً عاماً.
 */
describe('surface policy (web-core)', () => {
  const policy = createSurfacePolicy({
    publicPrefixes: ['/supplier-portal', '/esign'],
    employeePrefix: '/m',
  });

  it('matches a whole segment, never a raw prefix', () => {
    expect(matchesPrefix('/m', '/m')).toBe(true);
    expect(matchesPrefix('/m/', '/m')).toBe(true);
    expect(matchesPrefix('/m/x', '/m')).toBe(true);
    expect(matchesPrefix('/mx', '/m')).toBe(false);
    expect(matchesPrefix('/esign', '/esign')).toBe(true);
    expect(matchesPrefix('/esigning', '/esign')).toBe(false);
  });

  it('keeps the employee surface to /m and /m/… only', () => {
    for (const pathname of ['/m', '/m/', '/m/attendance', '/m/requests/new']) {
      expect(policy.isEmployeeSurface(pathname), pathname).toBe(true);
    }
    for (const pathname of ['/marina', '/marina/additions', '/migration', '/manufacturing', '/maintenance', '/']) {
      expect(policy.isEmployeeSurface(pathname), pathname).toBe(false);
    }
  });

  it('keeps the public surfaces to their own segments', () => {
    expect(policy.isPublicSurface('/esign')).toBe(true);
    expect(policy.isPublicSurface('/esign/document-1')).toBe(true);
    expect(policy.isPublicSurface('/esign-evil')).toBe(false);
    expect(policy.isPublicSurface('/supplier-portal/invoices')).toBe(true);
    expect(policy.isPublicSurface('/supplier-portal-evil')).toBe(false);
    expect(policy.isPublicSurface('/')).toBe(false);
  });

  it('defaults to the narrowest policy: nothing public, no employee shell', () => {
    const bare = createSurfacePolicy();
    expect(bare.isPublicSurface('/')).toBe(false);
    expect(bare.isPublicSurface('/supplier-portal')).toBe(false);
    expect(bare.isEmployeeSurface('/m')).toBe(false);
    expect(bare.publicPrefixes).toEqual([]);
    expect(bare.employeePrefix).toBeUndefined();
  });

  it('exposes the prefixes it was given, unchanged and in order', () => {
    expect(policy.publicPrefixes).toEqual(['/supplier-portal', '/esign']);
    expect(policy.employeePrefix).toBe('/m');
  });
});

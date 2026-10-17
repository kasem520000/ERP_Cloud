import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { isEmployeeSurface, isPublicSurface, matchesPrefix } from '../lib/surface-routing.js';

/**
 * AUD-13 — حدود المسار في AuthGate.
 *
 * كان `startsWith('/m')` يطابق `/marina` و`/migration` و`/manufacturing` فتغلّفها قشرة
 * الموظف، و`startsWith('/esign')` يفتح `/esign-evil` بلا جلسة. والحدّ الصحيح: المسار
 * يساوي البادئة أو يتبعها `/`.
 */
describe('AUD-13 — حدود مسار القشرة', () => {
  it('تطبيق الموظف: /m و/m/… فقط', () => {
    expect(isEmployeeSurface('/m')).toBe(true);
    expect(isEmployeeSurface('/m/')).toBe(true);
    expect(isEmployeeSurface('/m/attendance')).toBe(true);
    expect(isEmployeeSurface('/m/requests/new')).toBe(true);

    for (const pathname of ['/marina', '/marina/additions', '/migration', '/manufacturing', '/maintenance']) {
      expect(isEmployeeSurface(pathname), pathname).toBe(false);
    }
  });

  it('الأسطح العامة: /esign و/supplier-portal بحدّ مقطع', () => {
    expect(isPublicSurface('/esign')).toBe(true);
    expect(isPublicSurface('/esign/document-1')).toBe(true);
    expect(isPublicSurface('/esign-evil')).toBe(false);
    expect(isPublicSurface('/supplier-portal')).toBe(true);
    expect(isPublicSurface('/supplier-portal/invoices')).toBe(true);
    expect(isPublicSurface('/supplier-portal-evil')).toBe(false);
    expect(isPublicSurface('/')).toBe(false);
  });

  it('المطابقة لا تعتمد على بادئة خام', () => {
    expect(matchesPrefix('/m', '/m')).toBe(true);
    expect(matchesPrefix('/m/x', '/m')).toBe(true);
    expect(matchesPrefix('/mx', '/m')).toBe(false);
    expect(matchesPrefix('/esign', '/esign')).toBe(true);
    expect(matchesPrefix('/esigning', '/esign')).toBe(false);
  });

  /**
   * البوابة صارت مشتركة (`@erp/web-core/session-gate`) والسياسة هنا — فالحكم يُقاس على
   * الاثنين: لا مطابقة خاماً في أيٍّ منهما، وبوابة staff تمرّر سياسة هذه الواجهة فعلاً
   * (ولو نسيت `policy` لصارت كل المسارات محميّة ولانفتحت بوابة المورد وصفحة التوقيع).
   */
  it('AuthGate يمرّر سياسة الأسطح، ولا يعود هو ولا البوابة المشتركة إلى startsWith الخام', async () => {
    const gate = await readFile(new URL('../components/auth-gate.tsx', import.meta.url), 'utf8');
    const sharedGate = await readFile(
      new URL('../../../packages/web-core/src/session-gate.tsx', import.meta.url),
      'utf8',
    );
    const policy = await readFile(
      new URL('../../../packages/web-core/src/surface-policy.ts', import.meta.url),
      'utf8',
    );

    expect(gate).toContain('policy={SURFACE_POLICY}');
    expect(gate).toContain('SessionGate');
    for (const source of [gate, sharedGate]) {
      expect(source).not.toMatch(/startsWith\('\/m'\)/);
      expect(source).not.toMatch(/startsWith\('\/esign'\)/);
      expect(source).not.toMatch(/startsWith\('\/supplier-portal'\)/);
    }
    expect(sharedGate).toContain('policy?.isPublicSurface(pathname)');
    expect(sharedGate).toContain('policy?.isEmployeeSurface(pathname)');
    /** المطابقة الوحيدة المسموح بها هي بحدّ مقطع: `=== prefix` أو `/` بعدها. */
    expect(policy).toContain("pathname === prefix || pathname.startsWith(`${prefix}/`)");
  });

  it('قشرة الموظف تعرض لافتة الدخول المؤقّت مثل قشرة الإدارة', async () => {
    const shell = await readFile(new URL('../components/employee-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('ImpersonationBanner');
  });
});

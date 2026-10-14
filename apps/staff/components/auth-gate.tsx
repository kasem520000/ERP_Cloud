'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { SessionGate } from '@erp/web-core/session-gate';

import { useSession } from '../lib/session';
import { SURFACE_POLICY } from '../lib/surface-routing';

import { AppShell } from './app-shell';
import { EmployeeShell } from './employee-shell';
import { LoginScreen } from './login-screen';

/**
 * كل ما وراء هذا المكوّن يحتاج جلسة — وكانت اللوحة كلها عامة: من وصل إلى المنفذ 3001 رأى
 * الإدارة كاملة.
 *
 * وترتيب القرار في `@erp/web-core/session-gate` (سطحٌ عام ← فحص الجلسة ← مجهول ← قشرة
 * الموظف ← اللوحة)، وهنا **الربط وحده**: سياسة أسطح هذه الواجهة (`SURFACE_POLICY`)
 * وقشراتها وشاشة دخولها. والقراءة من `useSession` في التطبيق لا في الحزمة حتى يبقى مزوّد
 * الجلسة قرار الواجهة (§7.2 من تقرير المرحلة 0).
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useSession();
  const pathname = usePathname() ?? '';

  return (
    <SessionGate
      status={status}
      error={error}
      pathname={pathname}
      policy={SURFACE_POLICY}
      // ‏`LoginScreen` تقرأ الاستعلام (`useSearchParams`) فتحتاج حدّ `Suspense` عند
      // التصيير المسبق — والحدّ عند من يستعمل الاستعلام لا عند البوابة.
      login={(props) => (
        <Suspense>
          <LoginScreen {...props} />
        </Suspense>
      )}
      employeeShell={EmployeeShell}
      shell={AppShell}
    >
      {children}
    </SessionGate>
  );
}

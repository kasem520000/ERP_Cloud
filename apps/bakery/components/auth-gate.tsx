'use client';

import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { useSession } from '@erp/web-core/session';
import { SessionGate } from '@erp/web-core/session-gate';

import { SURFACE_POLICY } from '../lib/surface-routing';

import { BakeryGuard } from './bakery-guard';
import { LoginScreen } from './login-screen';

/**
 * كلّ ما وراء هذا المكوّن يحتاج جلسة — ولا سطحَ عامّاً في هذه الواجهة (سياستها في
 * ‏`lib/surface-routing.ts`: `createSurfacePolicy()` بلا بادئات ⇒ كلّ مسارٍ يُفحص).
 *
 * والآلية مشتركة (`SessionGate` من `@erp/web-core`: عام ← جلسة ← مجهول ← قشرة موظف ←
 * القشرة) والربطُ هنا وحده: سياسةُ هذه الواجهة، وقشرتُها، وشاشةُ دخولها. ولا مزوّد جلسة
 * محليّاً ولا جسر إعادة تصدير — الاستهلاك من الحزمة مباشرةً، وهذا هو المقصود من استخراجها.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { error, status } = useSession();
  const pathname = usePathname() ?? '';

  return (
    <SessionGate
      error={error}
      // ‏`LoginScreen` تقرأ الاستعلام (`useSearchParams`) فتحتاج حدّ `Suspense` عند
      // التصيير المسبق — والحدّ عند من يستعمل الاستعلام لا عند البوابة.
      login={(props) => (
        <Suspense>
          <LoginScreen {...props} />
        </Suspense>
      )}
      pathname={pathname}
      policy={SURFACE_POLICY}
      shell={BakeryGuard}
      status={status}
    >
      {children}
    </SessionGate>
  );
}

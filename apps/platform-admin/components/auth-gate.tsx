'use client';

import { SessionGate } from '@erp/web-core/session-gate';

import { useSession } from '../lib/session';

import { LoginScreen } from './login-screen';
import { PlatformGuard } from './platform-guard';

/**
 * كل ما وراء هذا المكوّن يحتاج جلسة منصة. ولا خدمة اشتراك ذاتي في اللوحة: مشغّلو المنصة
 * يُنشأون يدوياً وتُمنح أدوارهم من `/roles`.
 *
 * P-C1 نقل هيكل الصفحة (الشريط الجانبي والعلوي ومسار التنقّل) إلى `PlatformGuard`، فالبوابة
 * هنا حدّ الجلسة وحده: تحميل، أو دخول، أو اللوحة نفسها. ولا أسطح عامة ولا قشرة موظف في
 * هذه الواجهة ⇒ لا `policy` (والافتراض في `SessionGate` هو الأضيق: كل مسار يُفحص).
 *
 * **وجلسة اللوحة تبقى جلستها**: `useSession` هنا من `lib/session` الخاص بالمنصة (يفترق عن
 * نسخة staff)، والبوابة المشتركة تأخذ الحالة خصائصاً ولا تنادي مزوّداً — فلن تُستبدل جلسة
 * تطبيقٍ بحجة توحيد القشرة.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useSession();

  return (
    <SessionGate status={status} error={error} login={LoginScreen} shell={PlatformGuard}>
      {children}
    </SessionGate>
  );
}

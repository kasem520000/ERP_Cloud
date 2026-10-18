'use client';

import type { ReactNode } from 'react';

import type { SessionState } from './session';
import type { SurfacePolicy } from './surface-policy';

/**
 * 🚪 بوابة الجلسة — القرار نفسه في كل واجهة مستأجرة، وكان منسوخاً في واجهتين بحرفه:
 * سطحٌ عامّ يُترك بلا فحص، وجلسةٌ تُفحص، ومجهول يُرسل إلى شاشة الدخول، وموظفٌ على مساره
 * يأخذ قشرته، والباقي يأخذ لوحة التطبيق.
 *
 * **بلا خطّاف وبلا مزوّد عن قصد.** الحالة تُمرَّر إليها (`status`/`error`) فيبقى مصدر الجلسة
 * قرار التطبيق: `apps/platform-admin` لها مزوّد جلسةٍ وعميل API خاصّان بها (يفترقان عن
 * نسخة staff)، ولو نادى هذا المكوّن `useSession` من الحزمة لطلب مزوّداً غير موجود هناك
 * — أي أن «توفير البوابة» كان سيتحوّل إلى «استبدال جلسة التطبيق» صامتةً (وهو الفخّ نفسه
 * الذي يجعل `useQuery` غير قابل للهجرة وحده: `instanceof ApiError`).
 *
 * وثمنٌ مستحق: بلا خطّاف يصير المكوّن **دالةً نقية من خصائصها**، فتُرسم في اختبار بلا متصفح
 * (`renderToStaticMarkup`) بدل الاكتفاء بقراءة نصّ المصدر.
 */
export type SessionGateProps = {
  /** حالة الجلسة كما يقرؤها التطبيق من مزوّده. */
  status: SessionState['status'];
  /** سبب فشل آخر محاولة دخول — يُمرَّر إلى شاشة الدخول. */
  error?: string;
  /** المسار الحالي (`usePathname()` في التطبيق) — لا تستورده الحزمة من `next/navigation`. */
  pathname?: string;
  /** سياسة أسطح التطبيق؛ غيابها يعني ألا سطح عاماً ولا قشرة موظف. */
  policy?: SurfacePolicy;
  /** ما يُرسم أثناء فحص الجلسة — الافتراض `BootCard` (وهو ما كان في الواجهتين). */
  boot?: ReactNode;
  /** شاشة الدخول — قرار التطبيق (في staff تُغلَّف بـ`Suspense` لأنها تقرأ الاستعلام). */
  login: (props: { initialError?: string }) => ReactNode;
  /** قشرة التطبيق (لوحة الإدارة). */
  shell: (props: { children: ReactNode }) => ReactNode;
  /** قشرة الموظف — تُرسم على `policy.employeePrefix` وحده، وغيابها يعني قشرةً واحدة. */
  employeeShell?: (props: { children: ReactNode }) => ReactNode;
  children: ReactNode;
};

/** بطاقة الإقلاع — النصّ نفسه الذي كان في بوابتَي staff وplatform-admin حرفاً. */
export function BootCard({
  logo = 'ERP',
  text = 'جارٍ التحقق من الجلسة…',
}: {
  logo?: string;
  text?: string;
} = {}) {
  return (
    <div className="boot">
      <div className="boot-card">
        <span className="logo">{logo}</span>
        <p>{text}</p>
      </div>
    </div>
  );
}

export function SessionGate(props: SessionGateProps) {
  const {
    status,
    error,
    pathname = '',
    policy,
    boot,
    login,
    shell,
    employeeShell,
    children,
  } = props;

  // السطح العام أولاً: لا يُطلب من بوابة المورد ولا من صفحة التوقيع جلسة.
  if (policy?.isPublicSurface(pathname)) return <>{children}</>;

  if (status === 'loading') return <>{boot ?? <BootCard />}</>;

  // Render slots as React components, never invoke them as functions: login/shell
  // use hooks and swapping anonymous → authenticated must not change this gate's hook list.
  if (status === 'anonymous') {
    const Login = login;
    return <Login initialError={error} />;
  }

  // AUD-13 — قشرة الموظف على مساره وحده: `/marina` و`/migration` ليستا تطبيق الموظف.
  if (employeeShell && policy?.isEmployeeSurface(pathname)) {
    const EmployeeShell = employeeShell;
    return <EmployeeShell>{children}</EmployeeShell>;
  }

  const Shell = shell;
  return <Shell>{children}</Shell>;
}

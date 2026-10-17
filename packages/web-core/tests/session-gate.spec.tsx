import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import { BootCard, SessionGate } from '../src/session-gate';
import { createSurfacePolicy } from '../src/surface-policy';

/**
 * 🚪 بوابة الجلسة — **مرسومةٌ لا مقروءة**.
 *
 * اصطلاح المستودع في أحكام JSX كان قراءة نصّ المصدر (لا متصفح ولا مُصيِّر في البيئة)، وهو
 * يثبت ما كُتب لا ما يُرسم. والبوابة المشتركة بلا خطّاف وبلا مزوّد (حتى تبقى جلسة كل تطبيق
 * قراره) ⇒ فهي دالة نقية من خصائصها، فتُرسم هنا بـ`renderToStaticMarkup` ويُقاس مخرجها:
 * أي فرعٍ يُرسم، وبأي خصائص تُنادى شاشة الدخول.
 *
 * والترتيب المقاس هو الترتيب الذي كان في `apps/staff/components/auth-gate.tsx` حرفاً: سطحٌ
 * عامّ ← تحميل ← مجهول ← قشرة الموظف ← اللوحة.
 */
const staffPolicy = createSurfacePolicy({
  publicPrefixes: ['/supplier-portal', '/esign'],
  employeePrefix: '/m',
});

const shell = ({ children }: { children: ReactNode }) => <div className="app-shell">{children}</div>;
const employeeShell = ({ children }: { children: ReactNode }) => <div className="employee-shell">{children}</div>;
const login = ({ initialError }: { initialError?: string }) => (
  <form className="login">{initialError ? <p className="login-error">{initialError}</p> : null}</form>
);

const page = <main className="page">المحتوى</main>;

function render(props: Partial<Parameters<typeof SessionGate>[0]> = {}) {
  return renderToStaticMarkup(
    <SessionGate status="authenticated" login={login} shell={shell} {...props}>
      {page}
    </SessionGate>,
  );
}

describe('session gate (web-core)', () => {
  it('renders the boot card while the session is being checked — the same markup both apps had', () => {
    const markup = render({ status: 'loading' });
    expect(markup).toContain('class="boot"');
    expect(markup).toContain('class="boot-card"');
    expect(markup).toContain('<span class="logo">ERP</span>');
    expect(markup).toContain('جارٍ التحقق من الجلسة…');
    // لا تُرسم اللوحة ولا شاشة الدخول أثناء الفحص: جلسةٌ لم تُحسم بعد ليست إذناً.
    expect(markup).not.toContain('app-shell');
    expect(markup).not.toContain('class="login"');
  });

  it('lets the app replace the boot card', () => {
    expect(render({ status: 'loading', boot: <BootCard logo="مخبزي" text="جارٍ التحميل…" /> })).toContain(
      '<span class="logo">مخبزي</span>',
    );
    expect(render({ status: 'loading', boot: <p className="custom-boot">لحظة</p> })).toContain(
      'class="custom-boot"',
    );
  });

  it('sends the anonymous visitor to the login slot, carrying the failed attempt reason', () => {
    const markup = render({ status: 'anonymous', error: 'بيانات الدخول غير صحيحة' });
    expect(markup).toContain('class="login"');
    expect(markup).toContain('بيانات الدخول غير صحيحة');
    expect(markup).not.toContain('app-shell');
    // وبلا سبب لا يُخترع نصّ.
    expect(render({ status: 'anonymous' })).not.toContain('login-error');
  });

  it('wraps an authenticated visitor in the app shell', () => {
    const markup = render();
    expect(markup).toContain('class="app-shell"');
    expect(markup).toContain('المحتوى');
  });

  it('lets a public surface through without a session — and before the status is even read', () => {
    for (const status of ['loading', 'anonymous', 'authenticated'] as const) {
      const markup = render({ status, policy: staffPolicy, pathname: '/supplier-portal/invoices' });
      expect(markup, status).toContain('class="page"');
      expect(markup, status).not.toContain('boot-card');
      expect(markup, status).not.toContain('class="login"');
      expect(markup, status).not.toContain('app-shell');
    }
  });

  it('keeps a look-alike path behind the gate: /esign-evil is not a public surface', () => {
    const markup = render({ status: 'anonymous', policy: staffPolicy, pathname: '/esign-evil' });
    expect(markup).toContain('class="login"');
    expect(markup).not.toContain('class="page"');
  });

  it('gives /m and /m/… the employee shell, and /marina the admin shell (AUD-13)', () => {
    const employee = render({ policy: staffPolicy, pathname: '/m/attendance', employeeShell });
    expect(employee).toContain('class="employee-shell"');
    expect(employee).not.toContain('app-shell');

    for (const pathname of ['/marina', '/migration', '/manufacturing']) {
      const markup = render({ policy: staffPolicy, pathname, employeeShell });
      expect(markup, pathname).toContain('class="app-shell"');
      expect(markup, pathname).not.toContain('employee-shell');
    }
  });

  it('falls back to one shell when the app has no employee surface', () => {
    const markup = render({ policy: staffPolicy, pathname: '/m/attendance' });
    expect(markup).toContain('class="app-shell"');
    expect(markup).not.toContain('employee-shell');
  });
});

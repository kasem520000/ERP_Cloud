import Link from 'next/link';

import { SmartLogin } from '../../components/smart-login';
import { surfaceHref } from '../../lib/surfaces';

export default function LoginPage() {
  return (
    <div className="grid login-page-stack">
      <section className="card page-narrow">
        <h1>تسجيل الدخول الموحّد</h1>
        <p className="muted">
          سجّل الدخول مرّةً واحدة وسنوجّهك تلقائياً برمز تسليم آمن لمرّة واحدة: موظفو المنشأة إلى لوحة الإدارة
          الشاملة أو نظام المخابز ونقاط البيع، وعملاء المورد إلى بوابة العملاء.
        </p>
        <SmartLogin />
        <p className="muted">
          ليس لديك حساب؟ <Link href="/onboarding">أنشئ منشأتك مجاناً</Link>
        </p>
      </section>

      <section className="page-narrow login-surfaces-box" aria-label="الانتقال المباشر لواجهات السحابة">
        <h2 className="login-surfaces-title">أو انتقل مباشرةً إلى واجهة عملك</h2>
        <div className="login-surfaces-grid">
          <a className="card login-surface-card" href={surfaceHref('staff', '/login')}>
            <span className="badge ready">ويب · ERP</span>
            <h3>لوحة المنشأة والمحاسبة</h3>
            <p className="muted small">الأستاذ العام، الفواتير، الكاشير، المستودعات، الموارد البشرية، والتقارير.</p>
          </a>
          <a className="card login-surface-card" href={surfaceHref('bakery', '/login')}>
            <span className="badge ready">ويب · تشغيل</span>
            <h3>نظام المخابز والمناديب</h3>
            <p className="muted small">خطوط الإنتاج، تسليم عهد المناديب، نقاط البيع، وواجهة المندوب الميداني.</p>
          </a>
          <a className="card login-surface-card" href={surfaceHref('portal', '/auth/login')}>
            <span className="badge ready">بوابة خارجية</span>
            <h3>بوابة العملاء الذاتية</h3>
            <p className="muted small">استعراض الفواتير الضريبية، كشف الحساب التفصيلي، وتذاكر الدعم الفني.</p>
          </a>
        </div>
      </section>
    </div>
  );
}

'use client';

import { Screen } from '../../../components/screen';
import { useSession } from '../../../lib/session';

export default function HelpPage() {
  const { me } = useSession();

  return (
    <Screen title="إطلب المساعدة" subtitle="أرفق هذه المعلومات عند مراسلة الدعم لتسريع المعالجة." crumbs={['الدعم الفني']}>
      <section className="card">
        <h2>بيانات جلستك</h2>
        <dl className="kv">
          <dt>المنشأة</dt>
          <dd>
            {me?.membership.tenantName} (<span dir="ltr">{me?.membership.tenantCode}</span>)
          </dd>
          <dt>المستخدم</dt>
          <dd dir="ltr">{me?.user.email}</dd>
          <dt>الوقت</dt>
          <dd dir="ltr">{new Date().toISOString()}</dd>
        </dl>
        <button
          className="btn primary"
          type="button"
          style={{ marginTop: 10 }}
          onClick={() =>
            void navigator.clipboard.writeText(
              JSON.stringify(
                {
                  tenant: me?.membership.tenantCode,
                  user: me?.user.email,
                  at: new Date().toISOString(),
                  url: window.location.href,
                },
                null,
                2,
              ),
            )
          }
        >
          نسخ بيانات الدعم
        </button>
      </section>

      <section className="card">
        <h2>خطوات سريعة</h2>
        <ol className="muted" style={{ lineHeight: 2 }}>
          <li>تأكد أن الاشتراك فعّال من شاشة «الترخيص».</li>
          <li>راجع «صحة النظام» في لوحة المنصة للتأكد من اتصال الواجهة بالخادم.</li>
          <li>إذا ظهرت رسالة «لا تملك صلاحية»، اطلب من مالك الحساب منحك الصلاحية.</li>
        </ol>
      </section>
    </Screen>
  );
}

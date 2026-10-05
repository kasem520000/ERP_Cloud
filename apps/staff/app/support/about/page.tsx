'use client';

import { Screen } from '../../../components/screen';
import { apiBaseUrl } from '../../../lib/api';
import { screenCounts } from '../../../lib/navigation';

export default function AboutPage() {
  const counts = screenCounts();

  return (
    <Screen title="عن البرنامج" subtitle="معلومات الإصدار وحالة التنفيذ." crumbs={['الدعم الفني']}>
      <section className="card">
        <h2>Cloud SaaS ERP</h2>
        <dl className="kv">
          <dt>النسخة</dt>
          <dd dir="ltr">0.1.0</dd>
          <dt>البنية</dt>
          <dd>NestJS + PostgreSQL (RLS) + Next.js</dd>
          <dt>عنوان الـ API</dt>
          <dd dir="ltr">{apiBaseUrl}</dd>
          <dt>وثائق الـ API</dt>
          <dd>
            <a href="/api/v1/../docs" dir="ltr">
              /api/docs
            </a>
          </dd>
        </dl>
      </section>

      <section className="card" id="updates">
        <h2>حالة التنفيذ</h2>
        <p className="muted">
          شجرة النظام تحتوي على {counts.total} شاشة: {counts.ready} جاهزة، {counts.api} واجهتها البرمجية جاهزة،
          و{counts.planned} قيد التطوير. تُحدَّث هذه الأرقام تلقائياً من ملف شجرة التنقل.
        </p>
      </section>

      <section className="card">
        <h2>تحديث البرنامج</h2>
        <p className="muted">
          النظام سحابي: التحديثات تُنشر على الخادم ولا يحتاج العميل لتثبيت أي شيء. أعد تحميل الصفحة للحصول على
          آخر إصدار من الواجهة.
        </p>
      </section>
    </Screen>
  );
}

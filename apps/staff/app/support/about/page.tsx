'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';

import { Screen } from '../../../components/screen';

export default function AboutPage() {
  return (
    <Screen
      title="عن النظام"
      subtitle="معلومات المنصة السحابية والامتثال الضريبي والأمني."
      crumbs={['الدعم الفني']}
    >
      <Panel title="منصة ERP السحابية المتكاملة">
        <dl className="kv">
          <dt>الإصدار</dt>
          <dd dir="ltr">v1.0.0 — Cloud Enterprise Edition</dd>
          <dt>الامتثال الضريبي</dt>
          <dd>متوافق مع هيئة الزكاة والضريبة والجمارك (ZATCA — المرحلة الثانية للربط والتكامل)</dd>
          <dt>عزل البيانات والأمان</dt>
          <dd>عزل كامل متعدد المنشآت على مستوى الصفوف (PostgreSQL Row-Level Security) + تشفير AES-256-GCM</dd>
        </dl>
      </Panel>

      <Panel
        title="التحديثات السحابية والنسخ الاحتياطي"
        hint="ما يجري تلقائياً وما يُطلب منك — بلا وعدٍ لا يُنفّذه النظام."
      >
        <dl className="kv">
          <dt>التحديثات</dt>
          <dd>
            تُطبَّق التحديثات الأمنية والمحاسبية والضريبية على المنصة تلقائياً، دون توقف للخدمة ودون أي تثبيت
            محلي على أجهزة المستخدمين.
          </dd>
          <dt>النسخ الاحتياطي</dt>
          <dd>
            تُنشأ نسخة كاملة من بيانات منشأتك عند الطلب من شاشة «النسخ الاحتياطي»، وتُحفظ باسم منشأتك وحدها
            وتُتاح للتنزيل من الشاشة نفسها.
          </dd>
          <dt>الاستعادة</dt>
          <dd>
            الاستعادة عملية إدارية تُطلب من الدعم الفني وتُنفَّذ على المنصة — لا زرّ استعادة في واجهة
            المستأجر، حتى لا يُستبدل دفترٌ حقيقي بخطأ ضغطة.
          </dd>
        </dl>
        <div className="ui-form-actions">
          <span className="ui-form-actions-note">آخر ما نُسخ يظهر بتاريخه وحجمه في الشاشة.</span>
          <div className="ui-form-actions-buttons">
            <Link className="btn" href="/settings/backup">
              فتح النسخ الاحتياطي
            </Link>
          </div>
        </div>
      </Panel>
    </Screen>
  );
}

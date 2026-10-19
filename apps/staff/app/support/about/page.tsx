'use client';

import { Panel } from '@erp/ui';

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
        hint={
          <>
            يعمل النظام بالكامل على البنية السحابية المؤمّنة؛ تُطبَّق التحديثات الأمنية والمحاسبية والضريبية
            تلقائياً دون توقف للخدمة أو حاجة لأي تثبيت محلي على أجهزة المستخدمين.
          </>
        }
      ></Panel>
    </Screen>
  );
}

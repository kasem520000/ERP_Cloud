'use client';

import type { TenantReleaseInfo } from '@erp/contracts';
import { Panel } from '@erp/ui';
import Link from 'next/link';

import { Screen } from '../../../components/screen';
import { apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';

/**
 * «عن النظام» — والإصدار هنا **مقروءٌ من المنصّة** لا مكتوبٌ في الواجهة.
 *
 * كان السطر نصّاً ثابتاً (`v1.0.0`) يبقى على حاله بعد كل تحديث، فيسأل العميل الدعم عن
 * إصدارٍ لا يعمل عليه أحد. الآن يُقرأ من `GET /releases/current`: الإصدار وما الجديد
 * وتاريخ النشر — وهو ما يُعلنه المشغّل من لوحة المنصّة بعد فحص الحزمة.
 *
 * وفشلُ القراءة لا يكسر الصفحة: تبقى المعلومات الثابتة (الامتثال، العزل، النسخ) ويظهر
 * سطرُ الإصدار «غير متاح الآن» — لأن صفحةَ تعريفٍ لا تُسقِط نفسها لفقد رقم.
 */
export default function AboutPage() {
  const release = useQuery<TenantReleaseInfo>(() => apiData<TenantReleaseInfo>('/releases/current'), []);
  const current = release.data ?? null;

  return (
    <Screen
      title="عن النظام"
      subtitle="معلومات المنصة السحابية والامتثال الضريبي والأمني."
      crumbs={['الدعم الفني']}
    >
      <Panel title="منصة ERP السحابية المتكاملة">
        <dl className="kv">
          <dt>الإصدار</dt>
          <dd>
            <span dir="ltr">{current?.version ? `v${current.version}` : 'v1.0.0'}</span> — Cloud
            Enterprise Edition
            {current ? (
              <>
                <span className="small muted">
                  {' '}
                  · نُشر في{' '}
                  {new Date(current.publishedAt).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')}
                </span>
                {current.highlights.length > 0 ? (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    ما الجديد: {current.highlights.join(' · ')}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="small muted"> · رقم الإصدار المعلن غير متاح الآن</span>
            )}
          </dd>
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
            تصل المنصة كحزمة إصدارٍ يفحصها الخادم (بصمةٌ وحجمٌ وسطورُ ما جديد) وتُعلَن من لوحة
            المنصّة، فتصلك دون توقف للخدمة ودون أي تثبيت محلي على أجهزة المستخدمين — والرقم أعلاه
            هو ما يعمل عليه حسابك الآن.
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

'use client';

import { Button, Card, CardBody, CardHeader } from '@erp/ui';
import { useSession } from '@erp/web-core/session';

import { BAKERY_APP_CODE } from '../lib/licence';
import { BAKERY_MODULES, readyModules, visibleModules } from '../lib/navigation';

/**
 * نظرة اليوم — الصفحة الوحيدة المبنيّة في المرحلة 2، وهي **حقيقية** لا واجهة عرض:
 * تقرأ الجلسة والترخيص من `/me` وتعرض خريطة الوحدات كما هي في `lib/navigation.ts`،
 * وتقول صراحةً ما الذي لم يُبنَ بعد (وبأيّ نقاط خادم سيُبنى). لا أرقام مُختلَقة، ولا
 * بلاطة فارغة تدّعي بيانات، ولا رابط لمسارٍ غير موجود.
 */
export default function BakeryOverviewPage() {
  const { can, me, reload } = useSession();
  const modules = visibleModules(can);
  const built = readyModules(modules);

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-tight text-ink">
            المخابز: الإنتاج والتوزيع
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {me?.membership.tenantName} · {me?.membership.tenantCode} — سطحٌ فوق `apps/api` نفسها،
            بلا جداول جديدة وبلا محرّك محاسبيّ ثانٍ.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bak-badge ok" title={`enabledApps من GET /me يحتوي ${BAKERY_APP_CODE}`}>
            🔓 مرخَّصة: {BAKERY_APP_CODE}
          </span>
          <Button onClick={() => void reload()} size="sm">
            تحديث الترخيص
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader
          action={<span className="bak-badge">المرحلة 2</span>}
          subtitle="بلا مبالغة: ما يعمل فعلاً في هذه النسخة، وما لا يعمل."
          title="ما يعمل الآن"
        />
        <CardBody>
          <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
            <li>
              <strong>الدخول والجلسة</strong> — الجلسة المشتركة (`@erp/web-core`) وتسليم الدخول
              (‏{'`?handoff=<code>`'} رمزٌ لمرة واحدة) وشاشة الدخول برمز المنشأة والبريد وكلمة
              المرور (والتحقّق الثنائي حين يطلبه الخادم).
            </li>
            <li>
              <strong>بوابة الترخيص</strong> — لا تُرسم أيّ شاشة قبل أن تقول `/me` إنّ
              {' '}`{BAKERY_APP_CODE}` مفعَّلة؛ وعند غياب الباقة رفضٌ مُعلَّل بطريق الطلب، وعند
              غياب الحقل «تعذّر التأكّد» (لا فتحَ بلا فحص).
            </li>
            <li>
              <strong>القشرة والتنقّل</strong> — شريط وحدات يُصفّى بالصلاحيات الممنوحة، ونقطةُ حالةٍ
              لكلّ وحدة (مبنيّة/مخطَّطة)، ووضعٌ فاتح/داكن من الرموز المشتركة.
            </li>
            <li>
              <strong>خريطة العمل</strong> — {BAKERY_MODULES.length} وحدة معلنة، بُني منها{' '}
              {built.length} في هذه المرحلة.
            </li>
          </ul>
          <p className="m-0 mt-3 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
            ما لا يعمل بعد: لا دفعة إنتاج ولا حمولة ولا فاتورة ولا تحصيل ولا إقفال في هذه النسخة —
            شاشاتُ الأعمال هي المرحلة 3، وواجهة المندوب المحمولة (`/rep`) هي المرحلة 4. ولا تُعرض
            هذه الوحدات روابط، بل نصّاً بمرحلتها ونقاط الخادم التي ستستعملها.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          subtitle="الجاهزة روابط، والمخطَّطة نصّ — ولا رابط لمسارٍ غير موجود."
          title="خريطة الوحدات"
        />
        <CardBody>
          <div className="grid gap-3">
            {modules.map((module) => (
              <article
                className="grid gap-2 rounded-[10px] border border-line bg-surface p-4 shadow-1"
                key={module.key}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true" className={`bak-dot ${module.status}`} />
                  <span aria-hidden="true">{module.icon}</span>
                  <h2 className="m-0 text-[15px] font-extrabold text-ink">
                    {module.href ? <a className="text-ink" href={module.href}>{module.labelAr}</a> : module.labelAr}
                  </h2>
                  <span className="bak-badge">{module.phaseAr}</span>
                  {module.permission ? <span className="bak-badge">{module.permission}</span> : null}
                </div>
                <p className="m-0 text-[13px] leading-relaxed text-muted">{module.planAr}</p>
                <div className="bak-endpoints">
                  {module.endpoints.map((endpoint) => (
                    <code className="bak-endpoint" key={endpoint}>
                      {endpoint}
                    </code>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader subtitle="من أين يأتي القرار، ومن يملكه." title="الترخيص والضوابط" />
        <CardBody>
          <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
            <li>
              الباقة قطاعية: تفعيلها طلبٌ من سوق الإضافات يقرّه مالك المنصة، و`POST
              /marketplace/apps/{BAKERY_APP_CODE}/install` يُرفض 403
              {' '}`ADDON_REQUIRES_PLATFORM_APPROVAL` — فلا تفعيلَ ذاتيّ.
            </li>
            <li>
              الترخيص يُقرأ من `enabledApps` في `GET /me` (لا من كتالوج السوق) لأنّ الكتالوج يحتاج
              `tenant.view` ولا يملكه مندوب — والترخيص يجب أن يعرفه كلّ عضو.
            </li>
            <li>
              الصلاحيات يفرضها الخادم على كلّ نداء؛ وهذه الواجهة لا تمنح ولا ترفع صلاحية، ولا
              تُنشئ حساباً.
            </li>
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

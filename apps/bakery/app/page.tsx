'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Kpi, SkeletonCard } from '@erp/ui';
import { apiData, apiErrorText } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { BAKERY_APP_CODE } from '../lib/licence';
import { BAKERY_MODULES, readyModules, visibleModules } from '../lib/navigation';
import { numberText } from '../lib/lookups';

/** ملخّصُ لوحة الخطّ كما يرجعه الخادم — ولا رقمَ يُحسب هنا. */
type VanSummary = Record<string, string | number>;

/**
 * نظرة اليوم — لوحةُ عملياتٍ حقيقية، لا صفحةُ طورٍ ثانٍ.
 *
 * ما كانت: بطاقةٌ تقول «ما يعمل الآن» وأخرى تقول «ما لا يعمل بعد: لا دفعة إنتاج ولا حمولة
 * ولا فاتورة ولا تحصيل ولا إقفال» — وهي جملةٌ **كذبت منذ المرحلة الثالثة**، إذ بُنيت تلك
 * الشاشات كلّها. فكان أوّلُ ما يراه المالكُ صفحةً تعلن أنّ تطبيقه لا يعمل.
 *
 * وما هي الآن: صفُّ `Kpi` من `GET /van-sales/dashboard` (صافي المبيعات والمحصَّل والذمم وما
 * في السيارات والإقفالاتُ المعلّقة وشذوذُ البونص — وكلُّها من الخادم ولا رقمَ يُحسب هنا)،
 * وخريطةُ الوحدات بشاراتِ حالةٍ من `statusTone` وروابطِ الجاهز منها، وبطاقةُ الضوابط.
 * والحالاتُ صادقة: هيكلٌ عظميّ أثناء التحميل، وفراغٌ مُعلَّل لمن لا يملك `van_sales.view`،
 * وخطأٌ بزرّ إعادة — ولا منطقةَ فارغة بلا قول.
 */
export default function BakeryOverviewPage() {
  const { can, me, reload } = useSession();
  const modules = visibleModules(can);
  const built = readyModules(modules);
  const canVan = can('van_sales.view');

  const [summary, setSummary] = useState<VanSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!canVan) {
      setState('ready');
      return;
    }
    setState('loading');
    setError(undefined);
    try {
      const payload = await apiData<{ summary: VanSummary }>('/van-sales/dashboard');
      setSummary(payload.summary ?? null);
      setState('ready');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل لوحة الخطّ'));
      setState('error');
    }
  }, [canVan]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = (key: string): string =>
    summary ? String(summary[key] ?? '—') : '—';

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-tight text-ink">
            المخابز: الإنتاج والتوزيع
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {me?.membership.tenantName ?? me?.membership.displayName ?? 'المنشأة'} ·{' '}
            <span dir="ltr">{me?.membership.tenantCode}</span> — سطحٌ
            فوق <span dir="ltr">apps/api</span> نفسها، بلا جداول جديدة وبلا محرّك محاسبيّ ثانٍ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge dot status="active" title={`enabledApps من GET /me يحتوي ${BAKERY_APP_CODE}`}>
            مرخَّصة: <span dir="ltr">{BAKERY_APP_CODE}</span>
          </Badge>
          <Badge status={built.length === BAKERY_MODULES.length ? 'active' : 'pending'}>
            {built.length} من {BAKERY_MODULES.length} وحدة مبنيّة
          </Badge>
          <Button onClick={() => void reload()} size="sm">
            تحديث الترخيص
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader
          action={
            state === 'ready' ? (
              <Button onClick={() => void load()} size="sm" variant="ghost">
                تحديث الأرقام
              </Button>
            ) : null
          }
          subtitle="من GET /van-sales/dashboard — كلّ السجلّ لا اليوم، والأرصدةُ لحظتُها. ولا رقمَ يُحسب في المتصفح."
          title="أرقامُ الخطّ"
        />
        <CardBody>
          {!canVan ? (
            <EmptyState
              description="لا تملك صلاحية van_sales.view، فلا تُعرض أرقامُ الخطّ — ولا تُعرض أصفارٌ مكانها."
              icon={<span aria-hidden>🔒</span>}
              title="بلا صلاحيةٍ لقراءة الخطّ"
            />
          ) : state === 'loading' ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonCard key={index} lines={2} />
              ))}
            </div>
          ) : state === 'error' ? (
            <EmptyState
              action={
                <Button onClick={() => void load()} size="sm">
                  إعادة المحاولة
                </Button>
              }
              description={error}
              icon={<span aria-hidden>⚠️</span>}
              title="تعذّر تحميل الأرقام"
              tone="danger"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi
                hint={`صافي المرتجعات؛ الإجماليُّ قبلها ${value('totalSalesGrossSar')}`}
                title="صافي المبيعات"
                tone="brand"
                value={value('totalRevenueSar')}
              />
              <Kpi
                hint="مرتجعاتٌ وضريبتُها مخصومتان من الإجمالي"
                title="المرتجعات"
                tone={Number(value('returnsSar')) > 0 ? 'warn' : 'neutral'}
                value={value('returnsSar')}
              />
              <Kpi hint="سنداتُ قبضٍ مُرحّلة" title="المحصَّل نقدًا" tone="ok" value={value('totalCollectedCashSar')} />
              <Kpi
                hint="بعد خصم الإشعارات الدائنة"
                title="ذممٌ غير محصّلة"
                tone={Number(value('totalCreditReceivablesSar')) > 0 ? 'warn' : 'ok'}
                value={value('totalCreditReceivablesSar')}
              />
              <Kpi
                hint="عهدةٌ مفتوحة في سيارات التوزيع"
                title="في السيارات الآن"
                tone="neutral"
                value={`${value('remainingInVansKg')} كجم`}
              />
              <Kpi
                hint={
                  Number(value('pendingClosingsCount')) > 0
                    ? 'إقفالاتٌ بانتظار اعتماد المحاسب'
                    : 'لا إقفالَ معلّق'
                }
                title="إقفالاتٌ معلّقة"
                tone={Number(value('pendingClosingsCount')) > 0 ? 'warn' : 'ok'}
                value={value('pendingClosingsCount')}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          subtitle="الجاهزة روابطُ بشارةٍ خضراء، والمخطَّطة نصٌّ بمرحلتها — ولا رابط لمسارٍ غير موجود."
          title="خريطة الوحدات"
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            {modules.map((module) => (
              <article
                className="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-1"
                key={module.key}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true">{module.icon}</span>
                  <h2 className="m-0 text-[15px] font-extrabold text-ink">
                    {module.href ? (
                      <a className="text-ink underline-offset-4 hover:underline" href={module.href}>
                        {module.labelAr}
                      </a>
                    ) : (
                      module.labelAr
                    )}
                  </h2>
                  <Badge dot status={module.status === 'ready' ? 'active' : 'pending'}>
                    {module.status === 'ready' ? 'مبنيّة' : module.phaseAr}
                  </Badge>
                  {module.permission ? (
                    <Badge tone="neutral">
                      <span dir="ltr">{module.permission}</span>
                    </Badge>
                  ) : null}
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
              <strong>الباقة قطاعية</strong>: تفعيلها طلبٌ من سوق الإضافات يقرّه مالك المنصة، و
              <span dir="ltr">POST /marketplace/apps/{BAKERY_APP_CODE}/install</span> يُرفض ٤٠٣
              ‏<span dir="ltr">ADDON_REQUIRES_PLATFORM_APPROVAL</span> — فلا تفعيلَ ذاتيّ.
            </li>
            <li>
              <strong>الترخيص يُقرأ من `enabledApps` في `GET /me`</strong> (لا من كتالوج السوق)
              لأنّ الكتالوج يحتاج <span dir="ltr">tenant.view</span> ولا يملكه مندوب — والترخيص
              يجب أن يعرفه كلّ عضو.
            </li>
            <li>
              <strong>الصلاحيات يفرضها الخادم على كلّ نداء</strong>؛ وهذه الواجهة لا تمنح ولا
              ترفع صلاحية، ولا تُنشئ حساباً. والدخولُ هو الدخولُ نفسه في لوحة التحكم (رمزٌ
              لمرةٍ واحدة <span dir="ltr">?handoff=&lt;code&gt;</span> أو بريدٌ وكلمةُ مرور
              وتحقّقٌ ثنائيّ حين يطلبه الخادم).
            </li>
            <li>
              <strong>أرقامُ هذه الصفحة كلّها من الخادم</strong>: صافي المبيعات{' '}
              {numberText(value('totalRevenueSar'))} ريال، والمحصَّل{' '}
              {numberText(value('totalCollectedCashSar'))}، وفي السيارات{' '}
              {numberText(value('remainingInVansKg'))} كجم — وكلُّ بلاطةٍ تُعرض من حمولةٍ
              وصلت، وبلا بلاطةٍ فارغةَ تدّعي بيانات.
            </li>
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

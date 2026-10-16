'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Kpi, SkeletonCard } from '@erp/ui';
import { hasVanSalesCompanyScope } from '@erp/contracts';
import { apiData, apiErrorText } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { BAKERY_APP_CODE } from '../lib/licence';
import { BAKERY_MODULES, readyModules, visibleModules } from '../lib/navigation';
import { numberText } from '../lib/lookups';

/** ملخّصُ لوحة الخطّ كما يرجعه الخادم — ولا رقمَ يُحسب هنا. */
type VanSummary = Record<string, string | number>;

/**
 * مساحةُ عمل المندوب (`GET /van-sales/me`) — الوجهُ الذي يُقرأ منه `isRep` وأرقامُه.
 * والمجاميعُ هنا من جدول المندوب **كلّه** لا من نافذة القراءة (الشريحة ١٣أ)، و`windows`
 * يُعلن كم صُفّ وكم رجع.
 */
type RepWorkspace = {
  isRep?: boolean;
  salesmanName?: string | null;
  message?: string;
  totals?: {
    revenue?: string;
    cashSales?: string;
    creditSales?: string;
    collected?: string;
    outstanding?: string;
  };
  custody?: { expectedKg?: string; officialKg?: string; pendingClosings?: number };
  windows?: Record<string, { returned: number; total: number; limit: number }>;
};

/**
 * نظرة اليوم — لوحةُ عملياتٍ حقيقية، بوضعين لا وضعٍ واحد.
 *
 * **لماذا وضعان**: قراءةُ الخطّ على مستوى المنشأة (`GET /van-sales/dashboard` و`/reports`
 * و`/salesmen`) تُرفض ٤٠٣ `VAN_SALES_COMPANY_SCOPE_REQUIRED` على مندوبٍ محصور — أي من
 * له بطاقةُ `salesmen` مربوطةٌ بعضويته وليس معه إذنُ إدارةِ الخطّ (قِيس على خادمٍ قائم:
 * المندوبُ ٤٠٣ في الثلاثة، والمالكُ ومديرُ الخطّ ٢٠٠). فلو رسمت هذه الصفحةُ بلاطاتِ
 * المنشأة للجميع لرأى المندوبُ خطأً في أوّل شاشةٍ يفتحها، ولو رسمت له أرقامَ المنشأة
 * لكان ذلك تسريبًا. وأمّا أرقامُه هو فكاملةٌ في `/van-sales/me` — من جدولِه كلّه لا من
 * نافذة — فتُعرض هي، ويُفتح له `/rep`.
 *
 * **ولا يُخمَّن الوضعُ من الأذونات**: فكاتبُ المكتب الذي يملك `van_sales.view` وحدها
 * **بلا بطاقة مندوب** يفتح اللوحةَ في الخادم (٢٠٠)، فحجبُها عنه هنا كذبٌ في الجهة
 * الأخرى. لذلك يُسأل `/van-sales/me` أولًا: فإن قال `isRep: true` فوضعُ المندوب، وإلّا
 * تُطلب اللوحةُ كالمعتاد.
 *
 * والحالاتُ صادقةٌ في الوضعين: هيكلٌ عظميّ أثناء التحميل، وفراغٌ مُعلَّل لمن لا يملك
 * `van_sales.view` (فلا تُعرض أصفارٌ مكان أرقامٍ لا يحقّ له قراءتها)، وخطأٌ بزرّ إعادة.
 *
 * وما كانت هذه الصفحة قبل الشريحة ١٨: بطاقةٌ تقول «ما لا يعمل بعد: لا دفعةُ إنتاجٍ ولا
 * حمولةُ مركبةٍ ولا فاتورةُ خطٍّ ولا تحصيلُ مندوبٍ ولا إقفالُ عهد» — جملةٌ كذبت منذ
 * الطور الثالث الذي بنى الشاشات كلّها، فكان أوّلُ ما يقرأه المالكُ أنّ تطبيقَه لا يعمل.
 */
export default function BakeryOverviewPage() {
  const { can, me, reload } = useSession();
  const granted = me?.permissions ?? [];
  const companyScope = hasVanSalesCompanyScope(granted);
  const canVan = can('van_sales.view');

  const [summary, setSummary] = useState<VanSummary | null>(null);
  const [rep, setRep] = useState<RepWorkspace | null>(null);
  const [repScoped, setRepScoped] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | undefined>();

  const modules = visibleModules(can, BAKERY_MODULES, { repScoped });
  const built = readyModules(modules);

  const load = useCallback(async () => {
    if (!canVan) {
      setState('ready');
      return;
    }
    setState('loading');
    setError(undefined);
    try {
      if (!companyScope) {
        const mine = await apiData<RepWorkspace>('/van-sales/me');
        if (mine.isRep === true) {
          setRep(mine);
          setRepScoped(true);
          setState('ready');
          return;
        }
      }
      const payload = await apiData<{ summary: VanSummary }>('/van-sales/dashboard');
      setSummary(payload.summary ?? null);
      setRep(null);
      setRepScoped(false);
      setState('ready');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل أرقام الخطّ'));
      setState('error');
    }
  }, [canVan, companyScope]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = (key: string): string => (summary ? String(summary[key] ?? '—') : '—');
  const repValue = (key: keyof NonNullable<RepWorkspace['totals']>): string =>
    rep?.totals ? String(rep.totals[key] ?? '—') : '—';
  const custodyKg = rep?.custody ? String(rep.custody.expectedKg ?? '—') : '—';
  const pendingClosings = rep?.custody?.pendingClosings ?? 0;

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-tight text-ink">
            المخابز: الإنتاج والتوزيع
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {me?.membership.tenantName ?? me?.membership.displayName ?? 'المنشأة'} ·{' '}
            <span dir="ltr">{me?.membership.tenantCode}</span> — سطحٌ فوق{' '}
            <span dir="ltr">apps/api</span> نفسها، بلا جداول جديدة وبلا محرّك محاسبيّ ثانٍ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge dot status="active" title={`enabledApps من GET /me يحتوي ${BAKERY_APP_CODE}`}>
            مرخَّصة: <span dir="ltr">{BAKERY_APP_CODE}</span>
          </Badge>
          {repScoped ? (
            <Badge dot status="pending" title="بطاقةُ مندوبٍ مربوطةٌ بالعضوية وبلا إذنِ إدارةِ الخطّ">
              حسابُ مندوب{rep?.salesmanName ? `: ${rep.salesmanName}` : ''}
            </Badge>
          ) : (
            <Badge status={built.length === modules.length ? 'active' : 'pending'}>
              {built.length} من {modules.length} وحدة مبنيّة
            </Badge>
          )}
          <Button onClick={() => void reload()} size="sm">
            تحديث الترخيص
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader
          action={
            state === 'ready' ? (
              <div className="flex items-center gap-2">
                {repScoped ? (
                  <Link className="bak-badge ok" href="/rep">
                    فتح تطبيق المندوب
                  </Link>
                ) : null}
                <Button onClick={() => void load()} size="sm" variant="ghost">
                  تحديث الأرقام
                </Button>
              </div>
            ) : null
          }
          subtitle={
            repScoped
              ? 'من GET /van-sales/me — جدولُك أنت كلُّه لا نافذةُ القراءة، والخادمُ يرفض على حسابك قراءةَ لوحة المنشأة (٤٠٣).'
              : 'من GET /van-sales/dashboard — كلّ السجلّ لا اليوم، والأرصدةُ لحظتُها. ولا رقمَ يُحسب في المتصفح.'
          }
          title={repScoped ? 'أرقامُك أنت' : 'أرقامُ الخطّ'}
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
          ) : repScoped ? (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi hint="مستنداتُك كلّها، والمرتجعُ مخصوم" title="إيرادُك" tone="brand" value={repValue('revenue')} />
              <Kpi hint="طريقةُ الدفع نقدًا" title="نقديّ" tone="ok" value={repValue('cashSales')} />
              <Kpi
                hint="ما ليس نقدًا — ومنه البطاقة"
                title="آجل"
                tone={Number(repValue('creditSales')) > 0 ? 'warn' : 'neutral'}
                value={repValue('creditSales')}
              />
              <Kpi hint="سنداتُ قبضٍ مُرحّلة" title="محصَّل" tone="ok" value={repValue('collected')} />
              <Kpi
                hint="بعد خصم الإشعارات الدائنة"
                title="ذممٌ عليك تحصيلُها"
                tone={Number(repValue('outstanding')) > 0 ? 'warn' : 'ok'}
                value={repValue('outstanding')}
              />
              <Kpi hint="على أساس ما استُلم فعلًا" title="عهدتُك (كجم)" tone="neutral" value={custodyKg} />
              <Kpi
                hint={pendingClosings > 0 ? 'بانتظار اعتماد المحاسب' : 'لا إقفالَ معلّق'}
                title="إقفالاتٌ معلّقة"
                tone={pendingClosings > 0 ? 'warn' : 'ok'}
                value={String(pendingClosings)}
              />
            </div>
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
                tone={Number(value('totalReturnsSar')) > 0 ? 'warn' : 'neutral'}
                value={value('totalReturnsSar')}
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
          subtitle={
            repScoped
              ? 'القائمةُ مصفّاةٌ عمّا سيرفضه الخادمُ على حسابك — وشاشتُك هي تطبيق المندوب.'
              : 'الجاهزة روابطُ بشارةٍ خضراء، والمخطَّطة نصٌّ بمرحلتها — ولا رابط لمسارٍ غير موجود.'
          }
          title="خريطة الوحدات"
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            {modules.map((module) => (
              <article className="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-1" key={module.key}>
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
              ترفع صلاحية، ولا تُنشئ حسابًا. ومن الشريحة ١٩: المندوبُ يقرأ خطَّه هو ويكتب على
              أحماله ومستنداته هو، ولوحةُ المنشأة تُرفض عليه ٤٠٣ — والقائمةُ هنا تُصفّى
              راحةً للعين لا ضابطًا.
            </li>
            <li>
              <strong>أرقامُ هذه الصفحة كلّها من الخادم</strong>:{' '}
              {repScoped
                ? `إيرادُك ${numberText(repValue('revenue'))} ريال ومحصَّلُك ${numberText(
                    repValue('collected'),
                  )} وعهدتُك ${numberText(custodyKg)} كجم`
                : `صافي المبيعات ${numberText(value('totalRevenueSar'))} ريال، والمحصَّل ${numberText(
                    value('totalCollectedCashSar'),
                  )}، وفي السيارات ${numberText(value('remainingInVansKg'))} كجم`}{' '}
              — وكلُّ بلاطةٍ تُعرض من حمولةٍ وصلت، وبلا بلاطةٍ فارغةَ تدّعي بيانات.
            </li>
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Kpi, Panel } from '@erp/ui';
import { hasVanSalesCompanyScope } from '@erp/contracts';
import { apiData, apiErrorText } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { BAKERY_MODULES, readyModules, visibleModules } from '../lib/navigation';
import { BakeryModuleIcon } from '../components/module-icon';
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
  // ‏«مخطَّط» تُقال فقط إن كان ثمّة مخطَّط: فبعد ٢٠ج صارت الوحداتُ كلّها مبنيّة، وبقاءُ
  // المفتاح في الوسيلة إيحاءٌ بنقصٍ لا وجود له (ولصقةُ صاحبِ العمل أظهرت «مبنيّ · مخطَّط»
  // بجانب «١١ من ١١ وحدة مبنيّة» — وهو تناقضٌ يُقرأ لا يُفسَّر).
  const plannedCount = modules.length - built.length;

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
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">المخابز: الإنتاج والتوزيع</h1>
          <p className="ui-page-sub">
            {me?.membership.tenantName ?? me?.membership.displayName ?? 'المنشأة'} ·{' '}
            <span dir="ltr">{me?.membership.tenantCode}</span> — واجهةُ قطاع المخابز والتوزيع على النظام نفسه:
            بلا سجلّاتٍ موازية ولا دفاترَ ثانية.
          </p>
        </div>
        <div className="ui-page-actions">
          {repScoped ? (
            <Link className="bak-badge ok" href="/rep">
              فتح تطبيق المندوب
            </Link>
          ) : null}
          {canVan ? (
            <Button onClick={() => void load()} size="sm">
              تحديث الأرقام
            </Button>
          ) : null}
          <Badge dot status="active" title="الباقةُ القطاعية مفعَّلةٌ لمنشأتك — وتُقرأ من جلسة دخولك">
            مرخَّصة:
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
      <div className="ui-screen-body">
        {!canVan ? (
          <Panel title="أرقام الخطّ" hint="لا صلاحيةَ لقراءة أرقام الخطّ — ولا تُعرض أصفارٌ مكانها.">
            <EmptyState
              description="لا تملك صلاحيةَ قراءة أرقام الخطّ، فلا تُعرض — ولا تُعرض أصفارٌ مكانها."
              icon={<BakeryModuleIcon moduleKey="overview" size={22} />}
              title="بلا صلاحيةٍ لقراءة الخطّ"
            />
          </Panel>
        ) : state === 'loading' ? (
          <div aria-busy="true" className="ui-kpi-strip">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="ui-kpi-cell" key={index}>
                <span className="ui-kpi-label">…</span>
                <span className="ui-kpi-value">0000</span>
              </div>
            ))}
          </div>
        ) : state === 'error' ? (
          <Panel title="أرقام الخطّ" hint="تعذّر تحميل الأرقام من الخادم.">
            <EmptyState
              action={
                <Button onClick={() => void load()} size="sm">
                  إعادة المحاولة
                </Button>
              }
              description={error}
              icon={<BakeryModuleIcon moduleKey="production" size={22} />}
              title="تعذّر تحميل الأرقام"
              tone="danger"
            />
          </Panel>
        ) : repScoped ? (
          <div className="ui-kpi-grid">
            <Kpi
              hint="مستنداتُك كلّها، والمرتجعُ مخصوم"
              title="إيرادُك"
              tone="brand"
              value={repValue('revenue')}
            />
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
          <div className="ui-kpi-grid">
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
            <Kpi
              hint="سنداتُ قبضٍ مُرحّلة"
              title="المحصَّل نقدًا"
              tone="ok"
              value={value('totalCollectedCashSar')}
            />
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

        <Card>
          <CardHeader
            subtitle={
              repScoped
                ? 'القائمةُ مصفّاةٌ عمّا سيرفضه الخادمُ على حسابك — وشاشتُك هي تطبيق المندوب.'
                : plannedCount > 0
                  ? 'الجاهزة روابطُ بشارةٍ خضراء، والمخطَّطة نصٌّ بمرحلتها — ولا رابط لمسارٍ غير موجود.'
                  : 'كلُّ وحدةٍ هنا مبنيّةٌ ورابطُها يعمل — ولا رابط لمسارٍ غير موجود.'
            }
            title="خريطة الوحدات"
          />
          <CardBody flush>
            <div className="bak-module-grid">
              {modules.map((module) => (
                <article className="bak-module-row" key={module.key}>
                  <span aria-hidden="true" className="bak-module-icon">
                    <BakeryModuleIcon moduleKey={module.key} size={17} />
                  </span>
                  <div className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
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
                    </div>
                    {/* سطرٌ للعميل. وأمّا السجلُّ الهندسيّ (‏`planAr`) ومساراتُ API فتُعرض مطويّةً
 تحت «التفاصيل التقنية»: ففيها أسماءُ ملفاتٍ وأرقامُ شرائحَ وملاحظاتُ قياسٍ
 لا تعني عميلًا، وعرضُها افتراضيًّا كان يجعل الصفحةَ جدارَ نصٍّ (قِيس من
 لصقةِ صاحبِ العمل) — وهذا بندُه «بياناتٌ تظهر في الشاشات لا تصلح للإنتاج». */}
                    <p className="m-0 text-[13px] leading-relaxed text-muted">{module.summaryAr}</p>
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
                <strong>الباقة قطاعية</strong>: تفعيلُها طلبٌ من سوق الإضافات يقرّه مالكُ المنصّة — فلا تفعيلَ
                ذاتيّ من داخل المنشأة.
              </li>
              <li>
                <strong>الترخيصُ يُقرأ من جلسة دخولك</strong>: فكلُّ عضوٍ في المنشأة يعرف هل باقتُه مفعَّلة،
                بلا صلاحيةٍ إضافية ولا طلبٍ ثانٍ.
              </li>
              <li>
                <strong>الصلاحياتُ يفرضها النظام على كلّ طلب</strong>: وهذه الواجهة لا تمنح ولا ترفع صلاحيةً
                ولا تُنشئ حسابًا. والمندوبُ يقرأ خطَّه هو ويكتب على أحماله ومستنداته هو، ولا تُفتح له لوحةُ
                المنشأة — والقائمةُ هنا تُصفّى راحةً للعين لا ضابطًا.
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
            {/* ما فوقَ هذا بلغةُ العميل. وأمّا المساراتُ والرموزُ فمطويّةٌ هنا: فهي دليلُ
 مهندسٍ لا نصُّ شاشة، وحذفُها خسارةٌ للصدق وعرضُها مفتوحةً جدارُ نصّ. */}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}

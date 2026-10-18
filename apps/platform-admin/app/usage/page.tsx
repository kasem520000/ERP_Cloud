'use client';

import { useState } from 'react';
import {
  usageMetricRegistry,
  type PlatformUsageGridResponse,
  type PlatformUsageGridRow,
  type UsageMetricKey,
  type UsageMetricState,
  type UsageSnapshot,
} from '@erp/contracts';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Loading, Screen } from '../../components/screen';
import { ApiError, apiData, downloadFile } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * الاستخدام والحصص — شاشة يطلبها P-C5 (`docs/roadmap/PLATFORM_CONSOLE_PLAN.md` §4:
 * «`/usage` (شبكة + رسوم + تصدير)»).
 *
 * ثلاث طبقات، وكلٌّ منها يقرأ من الـAPI لا من الشاشة:
 *
 * 1. **الشبكة** (`GET /platform/usage`) — صفٌّ لكل عميل، أعمدةُه الثمانية هي فهرس المقاييس
 *    نفسه (`usageMetricRegistry` في `@erp/contracts`)، وترتيب الصفوف من الخدمة: الأسوأ أولاً،
 *    فلا يحتاج المشغّل إلى عينٍ تفحص ٣٠ صفاً لتجد من بلغ حدّه.
 * 2. **الرسم** (`GET /platform/usage?tenantId=`) — سلسلة استدعاءات الـAPI لثلاثين يوماً.
 *    اخترنا هذه السلسلة وحدها رسماً لأنها المقياس الوحيد الذي كان له معنى زمني يخصّ العميل
 *    (الفواتير تُعرض في بطاقة العميل)، ولا نرسم رقماً لا مصدر له.
 * 3. **التصدير** (`GET /platform/usage/export.csv`) — بيانٌ تلقائي بترميز BOM وفواصل
 *    RFC 4180 لمن يمسك الفوترة. وهو **بصلاحية المال** `console.billing.manage`، بخلاف
 *    الرؤية التي تكفيها `console.tenants.view`؛ فمن لا يملكها يرى زرّاً يشرح السبب بدل
 *    طلبٍ يعود 403.
 *
 * وقراءتان تُعلَنان في الشاشة ولا تُسكَت: **٨٠٪ ناعم** (راية وإشعار وتدقيق) و**١٠٠٪ صلب**
 * (رفض برمز `USAGE_LIMIT_REACHED`)، وأن الحدّ الذي مصدره `default` مغلّفٌ يُبلَّغ عنه ولا
 * يمنع لأن الفهرس يصف منشأةً جديدة — والعمود «من أين جاء الحدّ» هو ما يفرّق بينهما.
 */

const STATE_LABEL: Record<UsageMetricState, string> = {
  ok: 'طبيعي',
  soft: 'قريب من الحدّ',
  hard: 'بلغ الحدّ',
  unlimited: 'بلا حدّ',
};

const SOURCE_LABEL: Record<'tenant' | 'platform' | 'default', string> = {
  tenant: 'تجاوز العميل',
  platform: 'افتراض المنصة',
  default: 'حد إرشادي غير مفروض',
};

function toneOf(state: UsageMetricState): 'ok' | 'warn' | 'danger' {
  if (state === 'hard') return 'danger';
  if (state === 'soft') return 'warn';
  return 'ok';
}

function ratioOf(used: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.min(1, used / Math.max(limit, 1));
}

function dateText(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('ar-SA') : '—';
}

export default function UsagePage() {
  const grid = useQuery<PlatformUsageGridResponse>(() => apiData<PlatformUsageGridResponse>('/platform/usage'), []);
  const [selected, setSelected] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exports, setExports] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  // A tenant is only fetched once an operator asks for it — the grid already carries the
  // eight numbers, and this call adds the series and the per-metric sentence.
  const detail = useQuery<UsageSnapshot | undefined>(
    () => (selected ? apiData<UsageSnapshot>(`/platform/usage?tenantId=${selected}`) : Promise.resolve(undefined)),
    [selected],
  );

  const data = grid.data;
  const needle = search.trim();
  const rows = (data?.tenants ?? []).filter(
    (row) =>
      needle.length === 0 || row.tenantName.includes(needle) || row.tenantCode.toLowerCase().includes(needle.toLowerCase()),
  );

  async function exportCsv() {
    setExporting(true);
    setExports(undefined);
    try {
      await downloadFile('/platform/usage/export.csv', 'platform-usage.csv');
      setExports({ kind: 'ok', text: 'نُزّل ملف استخدام العملاء للفترة المعروضة. راجع حد كل عميل قبل استخدام البيان.' });
    } catch (error) {
      setExports({
        kind: 'danger',
        text:
          error instanceof ApiError && error.isForbidden
            ? 'التصدير يحتاج صلاحية إدارة فوترة المنصة.'
            : arabicErrorText(error, 'تعذّر تنزيل ملف الاستخدام. أعد المحاولة لاحقاً.'),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen
      title="الاستخدام والحصص"
      subtitle="اعرف من اقترب من حصته ومن بلغها، ثم افتح تفاصيل المنشأة لمعرفة مصدر الحد وما إذا كان يُطبّق."
      crumbs={['المنصة', 'العملاء']}
      actions={
        <>
          <button className="btn" type="button" onClick={grid.reload}>
            تحديث
          </button>
          <button className="btn primary" type="button" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'جارٍ التصدير…' : 'تصدير CSV'}
          </button>
        </>
      }
    >
      <WorkflowGuide title="من قراءة الحصة إلى الإجراء" steps={[
        { title: 'اقرأ التنبيه', detail: '٨٠٪ تنبيه مبكر، و١٠٠٪ حد قد يمنع إذا كان مفروضاً على المنشأة.' },
        { title: 'افتح تفاصيل العميل', detail: 'قارن الاستهلاك بالحد ومصدره قبل تفسير أي رفض.' },
        { title: 'قرر الإجراء', detail: 'راجع إعداد العميل أو فوترة الباقة؛ لا يغيّر هذا العرض أي حصة.' },
      ]} />
      {exports && <p className={`alert ${exports.kind}`}>{exports.text}</p>}

      {grid.status === 'loading' && <Loading rows={5} />}
      {grid.status === 'error' && <ErrorBox message={grid.error} onRetry={grid.reload} />}
      {grid.status === 'forbidden' && <Empty title="لا تملك صلاحية الوصول" detail="اطلب صلاحية الاطلاع على العملاء وحصصهم." />}

      {grid.status === 'success' && data && (
        <>
          <ContentPanel title="ملخص الاستخدام" description="المجموعات من الفترة الحالية؛ التنبيه لا يعني وحده أن العميل ممنوع من الخدمة.">
            <dl className="kv">
              <dt>الفترة</dt>
              <dd dir="ltr">
                {dateText(data.periodStart)} ← {dateText(data.periodEnd)}
              </dd>
              <dt>العملاء</dt>
              <dd>{data.totals.tenants}</dd>
              <dt>عند الحدّ الناعم (٨٠٪ فأكثر)</dt>
              <dd>{data.totals.soft}</dd>
              <dt>بلغوا الحدّ (١٠٠٪)</dt>
              <dd>{data.totals.hard}</dd>
              <dt>استدعاءات اليوم (كل العملاء)</dt>
              <dd>{data.totals.apiCallsToday.toLocaleString('ar-SA')}</dd>
              <dt>فواتير الشهر</dt>
              <dd>{data.totals.invoicesThisMonth.toLocaleString('ar-SA')}</dd>
            </dl>
            <p className="muted small" style={{ marginBottom: 0 }}>
              الحد الذي يُطبَّق يأتي من إعداد العميل أو المنصة. أما القيمة الافتراضية المعروضة للمقارنة فهي
              إرشادية ولا تمنع العميل وحدها؛ افتح التفاصيل لمعرفة مصدر كل حد.
            </p>
          </ContentPanel>

          <ContentPanel title={`المنشآت (${rows.length})`} description="ترتب الخدمة الصفوف حسب شدة الحالة؛ اضغط «التفصيل» لمعرفة مصدر حد المنشأة.">
            <div className="section-title">
              <label className="field">البحث في المنشآت
              <input
                className="input"
                style={{ maxWidth: 240 }}
                placeholder="ابحث باسم العميل أو رمزه"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              /></label>
            </div>
            {rows.length > 0 && <p className="muted small">على الهاتف، اسحب الجدول أفقياً لرؤية المقاييس والتفصيل.</p>}
            {rows.length === 0 ? (
              <Empty title="لا عميل مطابق" detail="جرّب جزءاً من الاسم أو الرمز." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>العميل</th>
                      {usageMetricRegistry.map((metric) => (
                        <th key={metric.key} className="num">
                          {metric.labelAr}
                        </th>
                      ))}
                      <th>الحالة</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.tenantId}>
                        <td>
                          <strong>{row.tenantName}</strong>
                          <div className="muted small" dir="ltr">
                            {row.tenantCode}
                          </div>
                        </td>
                        {usageMetricRegistry.map((metric) => (
                          <td key={metric.key} className="num">
                            <MetricCell row={row} metric={metric.key} />
                          </td>
                        ))}
                        <td>
                          <span className={`badge ${row.worst === 'ok' ? 'ready' : row.worst}`}>
                            {STATE_LABEL[row.worst]}
                          </span>
                          {row.softCount + row.hardCount > 0 && (
                            <div className="muted small">
                              {row.hardCount} بلغ الحد · {row.softCount} تنبيه مبكر
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn sm"
                            type="button"
                            onClick={() => setSelected(selected === row.tenantId ? undefined : row.tenantId)}
                          >
                            {selected === row.tenantId ? 'إخفاء' : 'التفصيل'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ContentPanel>

          {selected && (
            <ContentPanel>
              {detail.status === 'loading' && <Loading rows={3} />}
              {detail.status === 'error' && <ErrorBox message={detail.error} onRetry={detail.reload} />}
              {detail.data && (
                <>
                  <h2>
                    تفصيل الاستهلاك — {detail.data.tenantName}{' '}
                    <span className="muted small" dir="ltr">
                      {detail.data.tenantCode}
                    </span>
                  </h2>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>البند</th>
                          <th className="num">المستهلك</th>
                          <th className="num">الحدّ</th>
                          <th>النسبة</th>
                          <th>الحالة</th>
                          <th>من أين جاء الحدّ؟</th>
                          <th>أين يقع الرفض؟</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.metrics.map((metric) => (
                          <tr key={metric.key}>
                            <td>{metric.labelAr}</td>
                            <td className="num">{metric.used.toLocaleString('ar-SA')}</td>
                            <td className="num">{metric.limit === null ? 'بلا حدّ' : metric.limit.toLocaleString('ar-SA')}</td>
                            <td>
                              <span className="meter">
                                <span
                                  className={`meter-fill ${toneOf(metric.state) === 'ok' ? '' : toneOf(metric.state)}`}
                                  style={{ width: `${Math.round(ratioOf(metric.used, metric.limit) * 100)}%` }}
                                />
                              </span>
                              <span className="muted small" style={{ marginInlineStart: 6 }}>
                                {metric.percentUsed === null ? '—' : `${metric.percentUsed}%`}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${metric.state === 'ok' ? 'ready' : metric.state}`}>
                                {STATE_LABEL[metric.state]}
                              </span>
                            </td>
                            <td>
                              <span className={`tag ${metric.limitSource}`}>{SOURCE_LABEL[metric.limitSource]}</span>
                              <div className="muted small">
                                {metric.enforced ? 'يُطبَّق' : 'يُبلَّغ عنه فقط'}
                              </div>
                            </td>
                            <td className="muted small">{metric.enforcedAtAr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {detail.data.metrics
                    .filter((metric) => metric.noticeAr !== null && metric.state !== 'ok')
                    .map((metric) => (
                      <p key={metric.key} className={`alert ${metric.state === 'hard' ? 'danger' : 'warn'}`} style={{ marginTop: 8 }}>
                        {metric.noticeAr}
                      </p>
                    ))}

                  <h3 style={{ marginTop: 16 }}>طلبات الخدمة — آخر ٣٠ يوماً</h3>
                  <div className="day-bars" dir="ltr">
                    {detail.data.apiCallsPerDay.map((day) => {
                      const max = Math.max(1, ...detail.data!.apiCallsPerDay.map((entry) => entry.count));
                      return (
                        <div
                          key={day.day}
                          className="day-bar"
                          style={{ height: `${Math.max(3, (day.count / max) * 100)}%` }}
                          title={`${day.day}: ${day.count}`}
                        />
                      );
                    })}
                  </div>
                  <p className="muted small">
                    اليوم الحالي: {detail.data.apiCallsPerDay.at(-1)?.count ?? 0} استدعاء · المقياس يُصفَّر كل يوم · أحدث
                    توليد {dateText(detail.data.generatedAt)}
                  </p>
                </>
              )}
            </ContentPanel>
          )}
        </>
      )}
    </Screen>
  );
}

/**
 * خليّة قياسٍ واحدة في الشبكة: الرقم فوق، والمتر تحته. الحالة تأتي من الـAPI (`state`)
 * ولا تُحسب هنا — القاعدة الواحدة (٨٠٪ ناعم) تعيش في العقود.
 */
function MetricCell({ row, metric }: { row: PlatformUsageGridRow; metric: UsageMetricKey }) {
  const entry = row.metrics.find((item) => item.key === metric);
  if (!entry) return <span className="muted">—</span>;
  return (
    <>
      <div>
        {entry.used.toLocaleString('ar-SA')}
        <span className="muted small"> / {entry.limit === null ? '∞' : entry.limit.toLocaleString('ar-SA')}</span>
      </div>
      <span className="meter" style={{ marginTop: 4 }}>
        <span
          className={`meter-fill ${toneOf(entry.state) === 'ok' ? '' : toneOf(entry.state)}`}
          style={{ width: `${Math.round(ratioOf(entry.used, entry.limit) * 100)}%` }}
        />
      </span>
    </>
  );
}

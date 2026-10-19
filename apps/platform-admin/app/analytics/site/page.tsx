'use client';

import { useState } from 'react';
import { type SiteAnalytics } from '@erp/contracts';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Loading, Screen } from '../../../components/screen';
import { Table, type Column } from '../../../components/ui/table';
import { apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';

/**
 * تحليلات الموقع — شاشة P-M10 (`docs/roadmap/MARKETING_SITE_PLAN.md` §5).
 *
 * **نداءٌ واحد** (`GET /platform/analytics/site?days=`) يعطي كل ما في الصفحة: الزوّار، والأهداف
 * والقمع، والمنحنى اليومي، والمصادر، والمسارات، ونتائج أ/ب — لأن الشاشة واحدة، وتقسيمها إلى
 * نداءاتٍ أربعة يعني أربع حالات تحميلٍ وأربع فرصٍ لتخالف الأرقام بعضها.
 *
 * **وثلاثة قرارات تُقرأ هنا صراحةً:**
 *
 *   1. **كل رقمٍ بتعريفه**: التعريفات تُقرأ من الاستجابة (`definitions`) لا من نصٍّ في الشاشة،
 *      فتتغيّر مع العقد ولا تتخلّف عنه. والرقم بلا تعريفه يصير دعاية.
 *   2. **الخصوصية جزءٌ من الشاشة لا حاشيةٌ فيها**: ما يُجمع وما لا يُجمع (‏`never`) ومدةُ
 *      الاحتفاظ تُعرض بجانب الأرقام نفسها — لأن من يقرأ «٢٠٠ زائر» يجب أن يعرف ماذا يعني زائر.
 *   3. **النسبة بلا مقام تُعرض «—» لا «٠٪»** (كقاعدة P-C12): يومٌ لم يزره أحد لا تحويلَ فيه.
 */

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: '7', label: '٧ أيام' },
  { value: '30', label: '٣٠ يوماً' },
  { value: '90', label: '٩٠ يوماً' },
  { value: '180', label: '١٨٠ يوماً' },
];

function count(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString('ar-SA-u-ca-gregory-nu-latn');
}

function dayText(value: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export default function SiteAnalyticsPage() {
  const [windowDays, setWindowDays] = useState('30');
  const query = useQuery<SiteAnalytics>(
    () => apiData<SiteAnalytics>(`/platform/analytics/site?days=${windowDays}`),
    [windowDays],
  );

  const data = query.data;

  const goalColumns: Array<Column<SiteAnalytics['goals'][number]>> = [
    { key: 'goal', header: 'الهدف', grow: true, cell: (goal) => goal.labelAr },
    { key: 'visitors', header: 'زوّار', numeric: true, cell: (goal) => count(goal.visitors) },
    { key: 'events', header: 'أحداث', numeric: true, cell: (goal) => count(goal.events) },
    {
      key: 'rate',
      header: 'النسبة من زوّار النافذة',
      numeric: true,
      cell: (goal) =>
        goal.visitors === 0
          ? '—'
          : `${goal.ratePct.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { maximumFractionDigits: 1 })}٪`,
    },
  ];

  const seriesColumns: Array<Column<SiteAnalytics['series'][number]>> = [
    { key: 'day', header: 'اليوم', cell: (point) => dayText(point.day) },
    { key: 'visitors', header: 'زوّار', numeric: true, cell: (point) => count(point.visitors) },
    { key: 'views', header: 'مشاهدات', numeric: true, cell: (point) => count(point.views) },
  ];

  const sourceColumns: Array<Column<SiteAnalytics['sources'][number]>> = [
    { key: 'host', header: 'المصدر', ltr: true, grow: true, cell: (source) => source.host },
    { key: 'visitors', header: 'زوّار', numeric: true, cell: (source) => count(source.visitors) },
  ];

  const pathColumns: Array<Column<SiteAnalytics['paths'][number]>> = [
    { key: 'path', header: 'المسار', ltr: true, grow: true, cell: (row) => row.path },
    { key: 'visitors', header: 'زوّار', numeric: true, cell: (row) => count(row.visitors) },
    { key: 'views', header: 'مشاهدات', numeric: true, cell: (row) => count(row.views) },
  ];

  const experimentColumns: Array<
    Column<SiteAnalytics['experiments'][number]['variants'][number] & { experiment: string }>
  > = [
    { key: 'experiment', header: 'التجربة', ltr: true, cell: (variant) => variant.experiment },
    { key: 'key', header: 'النسخة', cell: (variant) => variant.key },
    { key: 'exposures', header: 'رأوا', numeric: true, cell: (variant) => count(variant.exposures) },
    {
      key: 'converters',
      header: 'بدأوا اشتراكاً',
      numeric: true,
      cell: (variant) => count(variant.converters),
    },
    {
      key: 'rate',
      header: 'التحويل',
      numeric: true,
      cell: (variant) =>
        variant.exposures === 0
          ? '—'
          : `${((variant.converters / variant.exposures) * 100).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { maximumFractionDigits: 1 })}٪`,
    },
  ];

  const definitionColumns: Array<Column<SiteAnalytics['definitions'][number]>> = [
    { key: 'label', header: 'الرقم', grow: true, cell: (definition) => definition.labelAr },
    { key: 'meaning', header: 'ما يعنيه', cell: (definition) => definition.definitionAr },
  ];

  return (
    <Screen
      title="تحليلات الموقع"
      subtitle="ما يُقرأ في الموقع التسويقي، وما يُطلب منه — أحداثٌ مجهولة الهوية بعد موافقة الزائر."
      kpis={
        data
          ? [
              {
                label: 'الزوّار',
                value: count(data.visitors.all),
                hint: `زائرٌ مميّز · اليوم ${count(data.visitors.today)}`,
              },
              {
                label: 'المشاهدات',
                value: count(data.views.all),
                hint: `صفحةٌ مقروءة · اليوم ${count(data.views.today)}`,
              },
              {
                label: 'أعلى هدف',
                value:
                  data.goals
                    .filter((goal) => goal.visitors > 0)
                    .sort((left, right) => right.visitors - left.visitors)[0]?.labelAr ?? '—',
                hint: 'ترتيب الأهداف بأعداد الزوّار',
              },
            ]
          : undefined
      }
    >
      <Panel>
        <div className="row">
          <label className="field">
            <span>النافذة</span>
            <select
              className="input"
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value)}
            >
              {WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>

      {query.status === 'loading' ? <Loading /> : null}
      {query.status === 'forbidden' ? (
        <Empty title="لا صلاحية" detail="هذه الشاشة تحتاج «قراءة التحليلات» (console.analytics.view)." />
      ) : null}
      {query.status === 'error' ? <ErrorBox message={query.error} onRetry={query.reload} /> : null}

      {data ? (
        <>
          <Panel flush title="القمع — الأهداف الأربعة">
            <Table bare columns={goalColumns} rows={data.goals} rowKey={(goal) => goal.name} />
            <p className="small muted">
              الزوّار مميّزون: زائرٌ ينقر الزرّ ثلاث مرّات يُحسب واحداً — وفرقُ «أحداث − زوّار» هو عدد النقرات
              المتكرّرة.
            </p>
          </Panel>

          <Panel flush title="المنحنى اليومي">
            <Table bare columns={seriesColumns} rows={data.series} rowKey={(point) => point.day} />
          </Panel>

          <section className="grid cols-2">
            <Panel flush title="المصادر">
              {data.sources.length === 0 ? (
                <p className="muted">لا زياراتٍ في النافذة بعد.</p>
              ) : (
                <Table bare columns={sourceColumns} rows={data.sources} rowKey={(source) => source.host} />
              )}
            </Panel>

            <Panel flush title="أكثر الصفحات">
              {data.paths.length === 0 ? (
                <p className="muted">لا صفحاتٍ في النافذة بعد.</p>
              ) : (
                <Table bare columns={pathColumns} rows={data.paths} rowKey={(row) => row.path} />
              )}
            </Panel>
          </section>

          <Panel flush title="تجارب أ/ب">
            {data.experiments.length === 0 ? (
              <p className="muted">
                لا تجربة جارية. تُنشأ من «المحتوى»: صفحةٌ أصلية، ثم صفحةٌ ثانية تُربط بها كنسخة بحرف (a أو b)
                فتُعلَن للزوّار ويقيسها هذا الجدول.
              </p>
            ) : (
              <Table
                bare
                columns={experimentColumns}
                rows={data.experiments.flatMap((experiment) =>
                  experiment.variants.map((variant) => ({ ...variant, experiment: experiment.experiment })),
                )}
                rowKey={(variant) => `${variant.experiment}-${variant.key}`}
              />
            )}
          </Panel>

          <Panel title="ماذا يُقاس وماذا لا يُقاس">
            <p>{data.privacy.noteAr}</p>
            <div className="grid cols">
              <div>
                <h3>يُخزَّن</h3>
                <ul>
                  {data.privacy.collected.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>لا يُخزَّن أبداً</h3>
                <ul>
                  {data.privacy.never.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="small muted">
              مدة الاحتفاظ: {count(data.privacy.retentionDays)} يوماً — الصفوف الأقدم تُحذف آلياً، ولا صفّ
              خامٌ أبديّ.
            </p>
          </Panel>

          <Panel flush title="تعريف كل رقم">
            <Table
              bare
              columns={definitionColumns}
              rows={data.definitions}
              rowKey={(definition) => definition.key}
            />
            <p className="small muted">
              آخر قراءة: {new Date(data.generatedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')} — والشاشة
              تقرأ ما جمعه الخادم لحظة الطلب، بلا تخزينٍ وسيط.
            </p>
          </Panel>
        </>
      ) : null}
    </Screen>
  );
}

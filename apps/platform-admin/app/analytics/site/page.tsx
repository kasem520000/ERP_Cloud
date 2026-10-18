'use client';

import { useState } from 'react';
import { ContentPanel, SummaryStat, WorkflowGuide } from '@erp/ui/page';
import { type SiteAnalytics } from '@erp/contracts';

import { Empty, ErrorBox, Loading, Screen } from '../../../components/screen';
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
  return value === undefined ? '—' : value.toLocaleString('ar-SA');
}

function readableDefinition(text: string): string {
  return text.replaceAll('`page_view`', 'زيارة الصفحة')
    .replaceAll('`referrer`', 'موقع الإحالة')
    .replaceAll('`experiment_exposure`', 'مشاهدة نسخة التجربة')
    .replaceAll(' (UUID)', '')
    .replaceAll('UUID', 'معرّف عشوائي');
}

function dayText(value: string): string {
  return new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

export default function SiteAnalyticsPage() {
  const [windowDays, setWindowDays] = useState('30');
  const query = useQuery<SiteAnalytics>(
    () => apiData<SiteAnalytics>(`/platform/analytics/site?days=${windowDays}`),
    [windowDays],
  );

  const data = query.data;

  return (
    <Screen
      title="تحليلات الموقع"
      subtitle="اقرأ الزيارات والأهداف مع تعريف كل رقم وحدود الخصوصية؛ لا تُحسب الأحداث قبل موافقة الزائر."
      crumbs={['المنصة', 'التحليلات']}
      actions={<button className="btn" type="button" onClick={query.reload}>تحديث القراءة</button>}
    >
      <WorkflowGuide title="قراءة تحليلات الموقع" steps={[
        { title: 'حدّد الفترة', detail: 'قارن العدد في نافذة زمنية واحدة؛ تغيير المدة يطلب قراءة جديدة فقط.' },
        { title: 'افهم المقام', detail: 'الزائر يختلف عن المشاهدة أو النقرة؛ غياب زوار لا يعني تحويلاً صفرياً.' },
        { title: 'راجع حدود البيانات', detail: 'انظر إلى ما يُجمع، وما لا يُجمع، ومدة الاحتفاظ قبل تفسير النتائج.' },
      ]} />
      <ContentPanel title="فترة التحليل" description="تقرأ كل المؤشرات من استجابة واحدة حتى لا تختلف فترات عرضها.">
        <div className="row">
          <label className="field">
            <span>النافذة</span>
            <select value={windowDays} onChange={(event) => setWindowDays(event.target.value)}>
              {WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ContentPanel>

      {query.status === 'loading' ? <Loading /> : null}
      {query.status === 'forbidden' ? (
        <Empty title="لا صلاحية" detail="اطلب صلاحية الاطلاع على تحليلات المنصة." />
      ) : null}
      {query.status === 'error' ? <ErrorBox message={query.error} onRetry={query.reload} /> : null}

      {data ? (
        <>
          <ContentPanel title="الخصوصية وحدود القياس" description="تعريف البيانات المجمّعة يأتي من الاستجابة نفسها، لا من افتراضات الشاشة.">
            <p>{readableDefinition(data.privacy.noteAr)}</p>
            <div className="grid cols">
              <div>
                <h3>يُخزَّن</h3>
                <ul>
                  {data.privacy.collected.map((line) => (
                    <li key={line}>{readableDefinition(line)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>لا يُخزَّن أبداً</h3>
                <ul>
                  {data.privacy.never.map((line) => (
                    <li key={line}>{readableDefinition(line)}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="small muted">
              مدة الاحتفاظ: {count(data.privacy.retentionDays)} يوماً — الصفوف الأقدم تُحذف آلياً،
              ولا صفّ خامٌ أبديّ.
            </p>
          </ContentPanel>

          <ContentPanel title="ماذا تعني الأرقام؟" description="اقرأ تعريف الخدمة قبل مقارنة الزائر بالمشاهدة أو الحدث.">
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>ما يعنيه</th>
                </tr>
              </thead>
              <tbody>
                {data.definitions.map((definition) => (
                  <tr key={definition.key}>
                    <td>{definition.labelAr}</td>
                    <td>{readableDefinition(definition.definitionAr)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="small muted">
              آخر قراءة: {new Date(data.generatedAt).toLocaleString('ar-SA')} — والشاشة تقرأ ما
              جمعه الخادم لحظة الطلب، بلا تخزينٍ وسيط.
            </p>
          </ContentPanel>

          <ContentPanel title="ملخص الفترة" description="زائر واحد قد يقرأ عدة صفحات وينفذ الحدث نفسه أكثر من مرة.">
            <div className="grid cols-2">
              <SummaryStat label="الزوّار" value={count(data.visitors.all)} hint={`اليوم: ${count(data.visitors.today)} · زوّار مميّزون في الفترة`} />
              <SummaryStat label="المشاهدات" value={count(data.views.all)} hint={`اليوم: ${count(data.views.today)} · صفحات مقروءة`} />
              <SummaryStat label="أعلى هدف" value={data.goals
                .filter((goal) => goal.visitors > 0)
                .sort((left, right) => right.visitors - left.visitors)[0]?.labelAr ?? '—'}
                hint="مرتب حسب عدد الزوار، لا عدد النقرات" />
            </div>
          </ContentPanel>

          <ContentPanel title="خطوات التحويل" description="نسبة كل هدف من زوّار الفترة؛ علامة الشرطة تعني غياب مقام صالح.">
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>الهدف</th>
                  <th>زوّار</th>
                  <th>أحداث</th>
                  <th>النسبة من زوّار النافذة</th>
                </tr>
              </thead>
              <tbody>
                {data.goals.map((goal) => (
                  <tr key={goal.name}>
                    <td>{goal.labelAr}</td>
                    <td>{count(goal.visitors)}</td>
                    <td>{count(goal.events)}</td>
                    <td>{goal.visitors === 0 ? '—' : `${goal.ratePct.toLocaleString('ar-SA', { maximumFractionDigits: 1 })}٪`}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="small muted">
              الزوّار مميّزون: زائرٌ ينقر الزرّ ثلاث مرّات يُحسب واحداً — وفرقُ «أحداث − زوّار» هو
              عدد النقرات المتكرّرة.
            </p>
          </ContentPanel>

          <ContentPanel title="التغيّر اليومي" description="تابع اتجاه الزيارات والمشاهدات دون استنتاج تحويل من يوم بلا زوار.">
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>اليوم</th>
                  <th>زوّار</th>
                  <th>مشاهدات</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((point) => (
                  <tr key={point.day}>
                    <td>{dayText(point.day)}</td>
                    <td>{count(point.visitors)}</td>
                    <td>{count(point.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </ContentPanel>

          <section className="grid cols-2">
            <article className="card">
              <h2>المصادر</h2>
              {data.sources.length === 0 ? (
                <p className="muted">لا زياراتٍ في النافذة بعد.</p>
              ) : (
                <div className="table-wrap"><table className="table">
                  <thead>
                    <tr>
                      <th>المصدر</th>
                      <th>زوّار</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sources.map((source) => (
                      <tr key={source.host}>
                        <td>{source.host}</td>
                        <td>{count(source.visitors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </article>

            <article className="card">
              <h2>أكثر الصفحات</h2>
              {data.paths.length === 0 ? (
                <p className="muted">لا صفحاتٍ في النافذة بعد.</p>
              ) : (
                <div className="table-wrap"><table className="table">
                  <thead>
                    <tr>
                      <th>المسار</th>
                      <th>زوّار</th>
                      <th>مشاهدات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paths.map((row) => (
                      <tr key={row.path}>
                        <td dir="ltr">{row.path}</td>
                        <td>{count(row.visitors)}</td>
                        <td>{count(row.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </article>
          </section>

          <ContentPanel title="نتائج تجارب الصفحات" description="لا تُستنتج فعالية نسخة من نسبة بلا تعرض كافٍ.">
            {data.experiments.length === 0 ? (
              <p className="muted">
                لا تجربة جارية في الفترة. تُنشأ من قسم المحتوى بنسخة أصلية وأخرى بديلة؛
                تُقارن مشاهدة كل نسخة ببدء الاشتراك بعدها.
              </p>
            ) : (
              <div className="table-wrap"><table className="table">
                <thead>
                  <tr>
                    <th>التجربة</th>
                    <th>النسخة</th>
                    <th>رأوا</th>
                    <th>بدأوا اشتراكاً</th>
                    <th>التحويل</th>
                  </tr>
                </thead>
                <tbody>
                  {data.experiments.flatMap((experiment) =>
                    experiment.variants.map((variant) => (
                      <tr key={`${experiment.experiment}-${variant.key}`}>
                        <td dir="ltr">{experiment.experiment}</td>
                        <td>{variant.key}</td>
                        <td>{count(variant.exposures)}</td>
                        <td>{count(variant.converters)}</td>
                        <td>{variant.exposures === 0 ? '—' : `${variant.ratePct.toLocaleString('ar-SA', { maximumFractionDigits: 1 })}٪`}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table></div>
            )}
          </ContentPanel>
        </>
      ) : null}
    </Screen>
  );
}

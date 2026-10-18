'use client';

import { useMemo, useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/** A read-only view of the OpenAPI document produced by the running API. */
type Operation = { summary?: string; tags?: string[]; deprecated?: boolean };
type OpenApiDocument = {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, Operation>>;
};
type Focus = 'integration' | 'developer' | 'all';
type Entry = { path: string; method: string; summary: string; group: string; deprecated: boolean };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const METHOD_LABEL: Record<string, string> = {
  GET: 'قراءة', POST: 'إنشاء أو تنفيذ', PUT: 'استبدال', PATCH: 'تعديل', DELETE: 'حذف',
};
const INTEGRATION = 'واجهات مفتاح التكامل';
const DEVELOPER = 'إدارة تكاملات المنشآت';

export default function ApiExplorerPage() {
  const { canConsole } = useSession();
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<Focus>('integration');
  const [expanded, setExpanded] = useState<string[]>([]);
  const allowed = canConsole('console.apikeys.manage');

  const document = useQuery(async () => {
    const response = await fetch('/api/docs/openapi.json', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`تعذّر تحميل دليل الواجهات (${response.status}).`);
    return (await response.json()) as OpenApiDocument;
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const grouped = new Map<string, Entry[]>();
    for (const [path, operations] of Object.entries(document.data?.paths ?? {})) {
      const group = groupOf(path);
      if (focus === 'integration' && group !== INTEGRATION) continue;
      if (focus === 'developer' && group !== DEVELOPER) continue;
      for (const method of METHODS) {
        const operation = operations[method];
        if (!operation) continue;
        const summary = operation.summary ?? '';
        if (needle && !`${method} ${path} ${summary}`.toLowerCase().includes(needle)) continue;
        grouped.set(group, [...(grouped.get(group) ?? []), {
          path, method: method.toUpperCase(), summary, group, deprecated: Boolean(operation.deprecated),
        }]);
      }
    }
    return [...grouped.entries()].sort((left, right) => right[1].length - left[1].length);
  }, [document.data, query, focus]);
  const visibleCount = groups.reduce((sum, [, entries]) => sum + entries.length, 0);

  if (!allowed) return <Screen title="دليل الواجهات البرمجية"><Forbidden /></Screen>;

  return (
    <Screen title="دليل الواجهات البرمجية"
      subtitle="ابدأ بواجهات مفتاح التكامل، ثم انتقل إلى إدارة التكاملات أو ابحث في بقية عقد الخدمة؛ الدليل للقراءة فقط."
      crumbs={['المنصة', 'التكاملات']}
      actions={<button className="btn" type="button" onClick={document.reload}>تحديث الدليل</button>}
    >
      <WorkflowGuide title="كيف تستخدم دليل الواجهات؟" steps={[
        { title: 'حدّد السطح', detail: 'مفتاح التكامل يخص منشأة واحدة؛ إدارة المفاتيح والوجهات تخص مشغّل المنصة.' },
        { title: 'ابحث عن المهمة', detail: 'صفّ النتائج بحسب الجزء الذي تريد قراءته أو اسم المسار والعملية.' },
        { title: 'تحقّق قبل التجربة', detail: 'قراءة الوثيقة لا تنفذ طلباً. الواجهة التفاعلية منفصلة وقد ترسل طلبات فعلية.' },
      ]} />
      <ContentPanel title="نطاق الدليل" description="يمكن البحث بالوصف أو الرمز الفني؛ لم تُنسخ المسارات إلى الواجهة بل تُقرأ من الخادم.">
        <div className="erp-page-actions" role="group" aria-label="نطاق الواجهات">
          {([['integration', 'مفتاح التكامل'], ['developer', 'إدارة التكاملات'], ['all', 'جميع الواجهات']] as const).map(([value, label]) => (
            <button className={`btn sm ${focus === value ? 'primary' : ''}`} type="button" key={value}
              aria-pressed={focus === value} onClick={() => setFocus(value)}>{label}</button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>ابحث عن مسار أو وصف</span>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="مثال: الفواتير أو invoices" />
        </label>
        {document.status === 'success' && (
          <p className="muted small">{visibleCount} عملية مطابقة من {Object.keys(document.data?.paths ?? {}).length} مسار في دليل الخادم.
            {document.data?.info?.version && <> إصدار الدليل: <code dir="ltr">{document.data.info.version}</code>.</>}
          </p>
        )}
        <details className="muted small">
          <summary>فتح وثيقة الخدمة التفاعلية</summary>
          <p>الواجهة التفاعلية منفصلة؛ قد تُرسل طلبات حقيقية وتغيّر بيانات. لا تُجرّب إجراءات مالية على بيانات فعلية.</p>
          <a className="btn sm" href="/api/docs" target="_blank" rel="noopener noreferrer">افتح الواجهة التفاعلية في تبويب جديد</a>
        </details>
      </ContentPanel>

      {document.status === 'loading' && <Loading rows={5} />}
      {document.status === 'error' && <ErrorBox message={document.error} onRetry={document.reload} />}
      {document.status === 'forbidden' && <Forbidden />}
      {document.status === 'success' && groups.length === 0 && (
        <Empty title="لا عمليات مطابقة" detail="جرّب كلمةً أعمّ، أو انتقل إلى «جميع الواجهات» إذا كانت خارج النطاق المختار." />
      )}
      {document.status === 'success' && groups.map(([group, entries]) => (
        <ContentPanel key={group} title={`${group} (${entries.length})`}
          description="الطريقة والمسار الفنيان ضروريان للتكامل؛ الوصف العربي يسبق النص التقني عند توفره.">
          <p className="muted small">على الهاتف اسحب الجدول أفقياً لعرض بقية الأعمدة.</p>
          <div className="table-wrap"><table><thead><tr>
            <th>العملية</th><th>المسار</th><th>ما الذي تفعله؟</th>
          </tr></thead><tbody>
            {entries.slice(0, expanded.includes(group) ? undefined : 60).map((entry) => (
              <tr key={`${entry.method} ${entry.path}`}>
                <td><strong>{METHOD_LABEL[entry.method]}</strong><div className="muted small" dir="ltr">{entry.method}</div></td>
                <td><code dir="ltr">{entry.path}</code></td>
                <td>{/[\u0600-\u06ff]/.test(entry.summary) ? entry.summary : `عملية ${METHOD_LABEL[entry.method]} على هذا المسار`}
                  {entry.deprecated && <span className="badge">قديمة</span>}
                  {entry.summary && !/[\u0600-\u06ff]/.test(entry.summary) && (
                    <details className="muted small"><summary>الوصف الفني الأصلي</summary><span dir="ltr" lang="en">{entry.summary}</span></details>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table></div>
          {entries.length > 60 && <button className="btn sm" type="button"
            onClick={() => setExpanded((current) => current.includes(group) ? current.filter((name) => name !== group) : [...current, group])}>
            {expanded.includes(group) ? 'عرض أول ٦٠ عملية' : `عرض بقية العمليات (${entries.length - 60})`}
          </button>}
        </ContentPanel>
      ))}
    </Screen>
  );
}

function groupOf(path: string): string {
  if (path.includes('/integration/')) return INTEGRATION;
  if (path.startsWith('/api/v1/platform/tenants/{id}/api-keys') || path.includes('/platform/webhooks')) return DEVELOPER;
  if (path.includes('/api-keys') || path.includes('/webhooks')) return DEVELOPER;
  if (path.startsWith('/api/v1/platform')) return 'واجهات مشغّل المنصة';
  return 'واجهات المنشأة والموظفين';
}

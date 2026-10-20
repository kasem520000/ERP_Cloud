'use client';

import { useState } from 'react';
import { Panel } from '@erp/ui';

import { DataTable, Notice, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { apiData, apiErrorText, apiPost } from '../../../lib/api';
import { dateTime } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

type Run = {
  id: string;
  source_label: string;
  mode: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  summary: Record<string, unknown>;
};
type Issue = {
  id: string;
  entity: string;
  legacy_pk: string | null;
  severity: string;
  code: string;
  message: string;
  created_at: string;
};

const MODES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'analyze', label: 'تحليل', hint: 'يفحص المصدر ويصدر تقرير جاهزية بدون كتابة أي بيانات.' },
  { id: 'dry_run', label: 'تشغيل تجريبي', hint: 'ينفّذ الاستيراد كاملاً ثم يتراجع — لاختبار التحويل.' },
  { id: 'import', label: 'استيراد فعلي', hint: 'يكتب البيانات المحوّلة في قاعدة النظام.' },
  { id: 'reconcile', label: 'مطابقة', hint: 'يقارن الأرصدة والمجاميع بين المصدر والنظام.' },
  { id: 'rollback', label: 'تراجع', hint: 'يتراجع عن آخر استيراد.' },
];

const SEVERITY_LABELS: Record<string, string> = { info: 'معلومة', warning: 'تحذير', error: 'خطأ' };

/**
 * Data migration runs (import/export).
 *
 * A run is always recorded — including its issues and the reconciliation checks — so an
 * import can be judged after the fact instead of being trusted blindly.
 */
export default function MigrationRunsPage() {
  const runs = useQuery<Run[]>(() => apiData<Run[]>('/migration/runs'), []);
  const [mode, setMode] = useState('analyze');
  const [label, setLabel] = useState('');
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();
  const issues = useQuery<Issue[]>(
    async () => (openRun ? apiData<Issue[]>(`/migration/runs/${openRun}/issues`) : []),
    [openRun],
  );

  async function start() {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiPost('/migration/runs', { mode, source: label ? { label } : undefined });
      setNotice({ kind: 'ok', text: 'تم تنفيذ العملية وتسجيلها.' });
      runs.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="إستيراد وتصدير البيانات"
      subtitle="ترحيل بيانات النظام القديم: تحليل تشغيل تجريبي استيراد مطابقة، وكل عملية تُسجَّل بمشاكلها."
      crumbs={['الإعدادات', 'البيانات']}
    >
      <div className="ui-filter-bar no-print">
        <div className="ui-filter-fields">
          <label className="field">
            <span>نوع العملية</span>
            <select className="input" value={mode} onChange={(event) => setMode(event.target.value)}>
              {MODES.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>وصف المصدر</span>
            <input
              className="input"
              dir="ltr"
              value={label}
              placeholder="sqlserver:Data16"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button type="button" className="btn primary" disabled={busy} onClick={start}>
            {busy ? 'جارٍ التنفيذ…' : 'تشغيل'}
          </button>
        </div>
        <p className="ui-filter-hint">{MODES.find((row) => row.id === mode)?.hint}</p>
      </div>
      <Notice notice={notice} />

      <QueryView
        wrapEmpty={(node) => (
          <Panel title="عمليات الترحيل" flush>
            {node}
          </Panel>
        )}
        query={runs}
        empty="لا توجد عمليات ترحيل"
        emptyDetail="ابدأ بـ«تحليل» لمعرفة جاهزية المصدر قبل أي استيراد."
      >
        {(rows) => (
          <Panel title="عمليات الترحيل" hint="كل تشغيل يُسجَّل — بما فيه التحليل والتشغيل التجريبي." flush>
            <DataTable
              columns={[
                { key: 'source', header: 'المصدر', align: 'ltr', cell: (row: Run) => row.source_label },
                {
                  key: 'mode',
                  header: 'النوع',
                  cell: (row: Run) => MODES.find((entry) => entry.id === row.mode)?.label ?? row.mode,
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  cell: (row: Run) =>
                    row.status === 'succeeded' ? 'نجحت' : row.status === 'failed' ? 'فشلت' : row.status,
                },
                { key: 'started', header: 'البدء', cell: (row: Run) => dateTime(row.started_at) },
                { key: 'finished', header: 'الانتهاء', cell: (row: Run) => dateTime(row.finished_at) },
                {
                  key: 'actions',
                  header: '',
                  cell: (row: Run) => (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setOpenRun(openRun === row.id ? null : row.id)}
                    >
                      {openRun === row.id ? 'إخفاء المشاكل' : 'عرض المشاكل'}
                    </button>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
            />
          </Panel>
        )}
      </QueryView>

      {openRun ? (
        <Panel
          title="مشاكل العملية"
          hint="مشاكل مسجّلة لهذه العملية وحدها — الدرجة والرمز يحددان ما يحتاج إصلاحاً."
          flush
        >
          <QueryView query={issues} empty="لا توجد مشاكل مسجّلة لهذه العملية">
            {(rows) => (
              <DataTable
                columns={[
                  {
                    key: 'severity',
                    header: 'الدرجة',
                    cell: (row: Issue) => SEVERITY_LABELS[row.severity] ?? row.severity,
                  },
                  { key: 'entity', header: 'الكيان', cell: (row: Issue) => row.entity },
                  { key: 'code', header: 'الرمز', align: 'ltr', cell: (row: Issue) => row.code },
                  { key: 'message', header: 'الرسالة', cell: (row: Issue) => row.message },
                  {
                    key: 'legacy',
                    header: 'المفتاح القديم',
                    align: 'ltr',
                    cell: (row: Issue) => row.legacy_pk ?? '—',
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
              />
            )}
          </QueryView>
        </Panel>
      ) : null}
    </Screen>
  );
}

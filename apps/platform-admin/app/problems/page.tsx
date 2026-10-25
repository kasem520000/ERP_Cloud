'use client';

import {
  platformProblemSourceLabels,
  platformProblemSources,
  type PlatformProblemRow,
  type PlatformProblemSource,
  type PlatformProblemsResponse,
} from '@erp/contracts';
import { Panel } from '@erp/ui';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  DatabaseBackup,
  ExternalLink,
  FlaskConical,
  Mail,
  ReceiptText,
  RefreshCw,
  ServerCrash,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import { ErrorBox, Forbidden, Screen } from '../../components/screen';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/input';
import { Table, type Column } from '../../components/ui/table';
import { apiData } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

const SOURCE_ICON: Record<PlatformProblemSource, React.ReactNode> = {
  email: <Mail size={14} />,
  einvoice: <ReceiptText size={14} />,
  webhook: <Webhook size={14} />,
  outbox: <FlaskConical size={14} />,
  backup: <DatabaseBackup size={14} />,
  server: <ServerCrash size={14} />,
};

const SERVER_SOURCE_LABELS: Record<string, string> = {
  api: 'الخادم الرئيسي (API)',
  staff: 'لوحة الموظفين',
  'platform-admin': 'لوحة المنصّة',
  marketing: 'الموقع التسويقي',
  'customer-portal': 'بوابة العملاء',
  bakery: 'تطبيق المخبز والمناديب',
  worker: 'عامل المهام الخلفية',
};

const REPAIR_ACTION_LABELS: Record<PlatformProblemSource, string> = {
  email: 'فتح إعدادات وسجل البريد',
  einvoice: 'فتح ملف المستأجر',
  webhook: 'فتح نقاط الـWebhook',
  outbox: 'فتح المهام والطوابير',
  backup: 'فتح النسخ الاحتياطية',
  server: 'تفاصيل العطل',
};

interface ServerProblemDetail {
  id: string;
  source: string;
  severity: 'error' | 'warning';
  code: string | null;
  message: string;
  path: string | null;
  method: string | null;
  status: number | null;
  traceId: string | null;
  tenantId: string | null;
  tenantCode: string | null;
  tenantName: string | null;
  actorUserId: string | null;
  meta: Record<string, unknown>;
  occurredAt: string;
}

function extractServerEventId(row: PlatformProblemRow): string | null {
  if (row.source !== 'server') return null;
  const prefix = 'server:';
  return row.key.startsWith(prefix) ? row.key.slice(prefix.length) : null;
}

function ProblemsContent() {
  const searchParams = useSearchParams();
  const initialSourceParam = searchParams.get('filter[source]');
  const openParam = searchParams.get('open');

  const [source, setSource] = useState<'' | PlatformProblemSource>(() =>
    initialSourceParam &&
    (platformProblemSources as readonly string[]).includes(initialSourceParam)
      ? (initialSourceParam as PlatformProblemSource)
      : '',
  );
  const [severity, setSeverity] = useState<'' | 'error' | 'warning'>('');
  const [selectedRow, setSelectedRow] = useState<PlatformProblemRow | null>(null);
  const [serverDetail, setServerDetail] = useState<ServerProblemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const query = new URLSearchParams({ limit: '100' });
  if (source) query.set('filter[source]', source);
  if (severity) query.set('filter[severity]', severity);

  const problems = useQuery<PlatformProblemsResponse>(
    () => apiData<PlatformProblemsResponse>(`/platform/problems?${query.toString()}`),
    [source, severity],
  );

  const rows = problems.data?.rows ?? [];
  const counts = problems.data?.counts;
  const problemCount = counts?.total ?? 0;
  const serverCount = counts?.bySource?.server ?? 0;

  const openProblemModal = useCallback(async (row: PlatformProblemRow) => {
    setSelectedRow(row);
    setServerDetail(null);
    setCopied(false);
    setActionError(null);
    const serverId = extractServerEventId(row);
    if (!serverId) return;
    setDetailLoading(true);
    try {
      const detail = await apiData<ServerProblemDetail>(`/platform/problems/server/${serverId}`);
      setServerDetail(detail);
    } catch {
      setServerDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!openParam || !problems.data || selectedRow) return;
    const match = problems.data.rows.find(
      (row) => row.key === `server:${openParam}` || row.key.endsWith(`:${openParam}`),
    );
    if (match) {
      void openProblemModal(match);
    }
  }, [openParam, problems.data, selectedRow, openProblemModal]);

  const handleDismissServerRow = async (row: PlatformProblemRow) => {
    const serverId = extractServerEventId(row);
    if (!serverId) return;
    setBusyDelete(true);
    setActionError(null);
    try {
      await apiData<{ deleted: number }>(`/platform/problems/server/${serverId}`, {
        method: 'DELETE',
      });
      setSelectedRow(null);
      setServerDetail(null);
      setActionNotice('تم حذف سجل خطأ السيرفر بعد معالجته.');
      problems.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذّر حذف سجل الخطأ');
    } finally {
      setBusyDelete(false);
    }
  };

  const handleClearAllServerProblems = async () => {
    setBusyDelete(true);
    setActionError(null);
    try {
      const res = await apiData<{ deleted: number }>('/platform/problems/server', {
        method: 'DELETE',
      });
      setSelectedRow(null);
      setServerDetail(null);
      setActionNotice(`تم مسح ${res.deleted} من سجلات أخطاء السيرفر السابقة.`);
      problems.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تعذّر مسح سجلات السيرفر');
    } finally {
      setBusyDelete(false);
    }
  };

  const copyDiagnosticReport = async (row: PlatformProblemRow) => {
    const payload = serverDetail
      ? JSON.stringify(serverDetail, null, 2)
      : JSON.stringify(row, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const columns: Array<Column<PlatformProblemRow>> = [
    {
      key: 'occurredAt',
      header: 'الوقت',
      ltr: true,
      width: 150,
      cell: (row) => (
        <span className="whitespace-nowrap text-[11.5px] text-muted" dir="ltr">
          {new Date(row.occurredAt).toLocaleString('en-GB-u-ca-gregory-nu-latn', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'المصدر',
      width: 130,
      cell: (row) => (
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className="text-muted" aria-hidden>
            {SOURCE_ICON[row.source]}
          </span>
          {platformProblemSourceLabels[row.source]}
        </span>
      ),
    },
    {
      key: 'tenant',
      header: 'العميل',
      width: 150,
      cell: (row) =>
        row.tenantId ? (
          <Link href={`/tenants/${row.tenantId}`} className="hover:underline">
            <span className="block text-[12.5px]">{row.tenantName ?? row.tenantCode ?? '—'}</span>
            <span className="block font-mono text-[11px] text-muted" dir="ltr">
              {row.tenantCode ?? row.tenantId.slice(0, 8)}
            </span>
          </Link>
        ) : (
          <span className="text-muted">المنصّة</span>
        ),
    },
    {
      key: 'title',
      header: 'المشكلة',
      grow: true,
      cell: (row) => (
        <>
          <span className="flex items-center gap-2">
            <Badge tone={row.severity === 'error' ? 'red' : 'amber'} dot>
              {row.severity === 'error' ? 'خطأ' : 'تحذير'}
            </Badge>
            <strong className="text-[12.5px]">{row.title}</strong>
          </span>
          {row.hint ? <span className="mt-1 block text-[11.5px] text-muted">{row.hint}</span> : null}
        </>
      ),
    },
    {
      key: 'detail',
      header: 'ردّ النظام',
      grow: true,
      ltr: true,
      cell: (row) =>
        row.detail ? (
          <span
            className="block max-w-[420px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-danger-ink"
            title={row.detail}
          >
            {row.detail}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'attempts',
      header: 'المحاولات',
      numeric: true,
      width: 90,
      cell: (row) => (row.attempts === null ? <span className="text-muted">—</span> : row.attempts),
    },
    {
      key: 'href',
      header: '',
      width: 120,
      hideOnPrint: true,
      cell: (row) => (
        <button
          type="button"
          className="btn small ghost"
          onClick={() => void openProblemModal(row)}
          aria-label={`افتح تفاصيل المشكلة: ${row.title}`}
        >
          <ArrowLeft size={12} /> افتح
        </button>
      ),
    },
  ];

  return (
    <Screen
      title="سجل المشاكل"
      subtitle="كل ما يفشل الآن في مكان واحد: بريدٌ لم يخرج، فاتورةٌ إلكترونية رُفضت، ويب هوك لم يُسلَّم، مهمةٌ نفدت محاولاتها، نسخةٌ فشلت، وأخطاء السيرفرات — بمصدره وبعميله وبموضع إصلاحه."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {serverCount > 0 ? (
            <Button
              variant="secondary"
              icon={<Trash2 size={14} />}
              disabled={busyDelete}
              onClick={() => void handleClearAllServerProblems()}
            >
              مسح أخطاء السيرفر ({serverCount})
            </Button>
          ) : null}
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={problems.reload}>
            تحديث
          </Button>
        </div>
      }
      kpis={[
        {
          label: 'إجمالي المشاكل',
          value: problemCount,
          icon: <AlertTriangle size={14} />,
          tone: problemCount > 0 ? 'warn' : 'neutral',
          hint: counts?.oldestAt
            ? `أقدمها: ${new Date(counts.oldestAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}`
            : 'لا شيء يفشل الآن',
        },
        ...(Object.keys(platformProblemSourceLabels) as PlatformProblemSource[]).map((key) => ({
          label: platformProblemSourceLabels[key],
          value: counts?.bySource?.[key] ?? 0,
          icon: SOURCE_ICON[key],
          hint: 'مصدر مراقَب',
        })),
      ]}
      filters={
        <div className="flex flex-wrap items-end gap-3 no-print">
          <Select
            label="المصدر"
            value={source}
            onChange={(event) => setSource(event.target.value as '' | PlatformProblemSource)}
          >
            <option value="">كل المصادر</option>
            {(Object.keys(platformProblemSourceLabels) as PlatformProblemSource[]).map((key) => (
              <option key={key} value={key}>
                {platformProblemSourceLabels[key]}
              </option>
            ))}
          </Select>
          <Select
            label="الخطورة"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as '' | 'error' | 'warning')}
          >
            <option value="">الكل</option>
            <option value="error">خطأ</option>
            <option value="warning">تحذير</option>
          </Select>
          <span className="pb-2 text-[12px] text-muted">
            يُقرأ من ستة مصادر: البريد، الفاتورة الإلكترونية، الويب هوك، الطابور، النسخ، وأخطاء السيرفرات — اضغط «افتح» لعرض التفاصيل التشخيصية الكاملة وموضع الإصلاح.
          </span>
        </div>
      }
    >
      {actionNotice ? (
        <div className="mb-3 rounded-[10px] border border-ok/30 bg-ok-soft px-4 py-2.5 text-[12.5px] font-semibold text-ok-ink">
          {actionNotice}
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-3 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[12.5px] font-semibold text-danger-ink">
          {actionError}
        </div>
      ) : null}

      {problems.status === 'loading' && (
        <Panel>
          <Table columns={columns} rows={[]} rowKey={(row) => row.key} loading skeletonRows={6} />
        </Panel>
      )}
      {problems.status === 'forbidden' && <Forbidden />}
      {problems.status === 'error' && (
        <ErrorBox message={problems.error} onRetry={problems.reload} />
      )}
      {problems.status === 'success' && (
        <Panel className="tight">
          <Table
            bare
            dense
            columns={columns}
            rows={rows}
            rowKey={(row) => row.key}
            pageSize={50}
            empty={
              <div className="grid place-items-center gap-2 py-10 text-center">
                <Badge tone="green" dot>
                  لا مشاكل
                </Badge>
                <p className="m-0 text-[13px] font-semibold">لا صفَّ فاشلاً في المصادر الستة.</p>
                <p className="m-0 max-w-[52ch] text-[12px] text-muted">
                  هذه قراءةٌ فعلية لصفوف البريد والفاتورة الإلكترونية والويب هوك والطابور والنسخ وأخطاء السيرفرات لحظة الضغط على تحديث.
                </p>
              </div>
            }
          />
        </Panel>
      )}

      {selectedRow ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تفاصيل المشكلة"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setSelectedRow(null);
            setServerDetail(null);
          }}
        >
          <div
            className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[12px] border border-line bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={selectedRow.severity === 'error' ? 'red' : 'amber'} dot>
                    {selectedRow.severity === 'error' ? 'خطأ' : 'تحذير'}
                  </Badge>
                  <Badge tone="neutral">{platformProblemSourceLabels[selectedRow.source]}</Badge>
                  <span className="text-[11.5px] text-muted" dir="ltr">
                    {new Date(selectedRow.occurredAt).toLocaleString('en-GB-u-ca-gregory-nu-latn', {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    })}
                  </span>
                </div>
                <h2 className="m-0 mt-2 text-[15px] font-extrabold text-ink">
                  {selectedRow.title}
                </h2>
              </div>
              <Button
                variant="secondary"
                icon={<X size={14} />}
                onClick={() => {
                  setSelectedRow(null);
                  setServerDetail(null);
                }}
              >
                إغلاق
              </Button>
            </div>

            <div className="mt-4 space-y-3 text-[12.5px]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[8px] border border-line bg-surface-2 p-3">
                  <div className="text-[11px] font-bold text-muted">النطاق / العميل</div>
                  <div className="mt-1 font-semibold text-ink">
                    {selectedRow.tenantId ? (
                      <Link href={`/tenants/${selectedRow.tenantId}`} className="text-brand-600 underline">
                        {selectedRow.tenantName ?? selectedRow.tenantCode ?? selectedRow.tenantId}
                      </Link>
                    ) : (
                      'المنصّة العامّة'
                    )}
                  </div>
                </div>
                <div className="rounded-[8px] border border-line bg-surface-2 p-3">
                  <div className="text-[11px] font-bold text-muted">
                    {selectedRow.source === 'server' ? 'الخادم المُبلِّغ' : 'المحاولات المسجّلة'}
                  </div>
                  <div className="mt-1 font-semibold text-ink">
                    {selectedRow.source === 'server'
                      ? serverDetail
                        ? (SERVER_SOURCE_LABELS[serverDetail.source] ?? serverDetail.source)
                        : detailLoading
                          ? 'جارٍ التحميل…'
                          : 'الخادم الرئيسي'
                      : selectedRow.attempts !== null
                        ? `${selectedRow.attempts} محاولة`
                        : '—'}
                  </div>
                </div>
              </div>

              {serverDetail ? (
                <div className="grid gap-2 rounded-[8px] border border-line bg-surface-2 p-3 text-[12px] sm:grid-cols-2">
                  <div>
                    <span className="text-muted">المسار والطريقة: </span>
                    <span className="font-mono font-bold text-ink" dir="ltr">
                      {[serverDetail.method, serverDetail.path].filter(Boolean).join(' ') || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted">رمز الاستجابة HTTP: </span>
                    <span className="font-mono font-bold text-ink">{serverDetail.status ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted">رمز الخطأ: </span>
                    <span className="font-mono text-ink">{serverDetail.code ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-muted">بصمة التتبّع (Trace): </span>
                    <span className="font-mono text-ink" dir="ltr">
                      {serverDetail.traceId ?? '—'}
                    </span>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-1 text-[11.5px] font-bold text-muted">ردّ النظام الكامل</div>
                <pre
                  dir="ltr"
                  className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-line bg-slate-950 p-3 font-mono text-[11.5px] text-red-200"
                >
                  {serverDetail?.message ?? selectedRow.detail ?? selectedRow.title}
                </pre>
              </div>

              {serverDetail && Object.keys(serverDetail.meta ?? {}).length > 0 ? (
                <div>
                  <div className="mb-1 text-[11.5px] font-bold text-muted">
                    التفاصيل التقنية والمكدّس (Stack / Meta)
                  </div>
                  <pre
                    dir="ltr"
                    className="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-line bg-slate-900 p-3 font-mono text-[11px] text-slate-200"
                  >
                    {typeof serverDetail.meta.stack === 'string'
                      ? serverDetail.meta.stack
                      : JSON.stringify(serverDetail.meta, null, 2)}
                  </pre>
                </div>
              ) : null}

              {selectedRow.hint ? (
                <div className="rounded-[8px] border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
                  <strong className="text-ink">الإجراء المقترح: </strong>
                  {selectedRow.hint}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    icon={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={() => void copyDiagnosticReport(selectedRow)}
                  >
                    {copied ? 'تم النسخ' : 'نسخ التقرير'}
                  </Button>
                  {selectedRow.source === 'server' ? (
                    <Button
                      variant="secondary"
                      icon={<Trash2 size={14} />}
                      disabled={busyDelete}
                      onClick={() => void handleDismissServerRow(selectedRow)}
                    >
                      {busyDelete ? 'جارٍ الحذف…' : 'حذف السجل بعد المعالجة'}
                    </Button>
                  ) : null}
                </div>

                {selectedRow.source !== 'server' ? (
                  <Link
                    href={selectedRow.href}
                    className="btn primary small"
                    onClick={() => {
                      setSelectedRow(null);
                      setServerDetail(null);
                    }}
                  >
                    <ExternalLink size={13} /> {REPAIR_ACTION_LABELS[selectedRow.source]}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Screen>
  );
}

export default function ProblemsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">جارٍ التحميل…</div>}>
      <ProblemsContent />
    </Suspense>
  );
}

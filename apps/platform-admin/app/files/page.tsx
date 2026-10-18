'use client';

import { FileSearch, RefreshCw, ScanLine, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Forbidden, Screen } from '../../components/screen';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input, Select } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import { Table } from '../../components/ui/table';
import { apiData } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/**
 * الملفات — the cross-tenant file manager (P-C9).
 *
 * السؤال الذي تجيب عنه هذه الشاشة ليس «كم ملفاً عندنا» بل **«أيُّ ملفٍّ لم يُفحص؟»**.
 * وحكم الفحص لا يُخترع هنا: هو `meta.scan` الذي يكتبه مسار الرفع في مسار التدقيق
 * (`FilesService.finalize` عبر منفذ `VirusScanner`)، وهذه الشاشة تقرؤه وتعرضه كما هو.
 *
 * ولهذا يقول العمود **«لم يُفحص»** للملفّ الذي `scan = null`، ولا يقول «نظيف»: الماسح
 * المربوط في هذا المستودع لا يفعل شيئاً فيُعيد `skipped`، وترجمةُ `skipped` إلى «سليم»
 * هي بالضبط الكذبة التي تمنع ظهور الحاجة إلى ماسحٍ حقيقي.
 */

type FileRow = {
  id: string;
  tenantId: string;
  tenantCode: string | null;
  name: string;
  mime: string;
  sizeBytes: number;
  status: 'pending' | 'ready' | 'deleted';
  entity: string | null;
  entityId: string | null;
  uploadedByLabel: string | null;
  createdAt: string;
  deletedAt: string | null;
  scan: {
    verdict: 'clean' | 'infected' | 'skipped';
    scanner: string;
    detail: string | null;
    recordedAt: string;
  } | null;
};

type FilePage = { data: FileRow[]; meta: { total: number; limit: number; offset: number } };

type ScanResult = {
  fileId: string;
  verdict: string;
  scanner: string;
  detail: string | null;
  scannedAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'بانتظار الرفع',
  ready: 'جاهز',
  deleted: 'محجور',
};

const STATUS_TONE: Record<string, 'amber' | 'green' | 'red' | 'neutral'> = {
  pending: 'amber',
  ready: 'green',
  deleted: 'red',
};

const SCAN_LABEL: Record<string, string> = {
  clean: 'نظيف',
  infected: 'مُصاب',
  skipped: 'لم يُفحص فعلياً',
};

const SCAN_TONE: Record<string, 'green' | 'red' | 'amber' | 'neutral'> = {
  clean: 'green',
  infected: 'red',
  skipped: 'amber',
};

export default function FilesPage() {
  const { canConsole } = useSession();
  const [status, setStatus] = useState('');
  const [scan, setScan] = useState('');
  const [term, setTerm] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);

  const files = useQuery<FilePage>(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('filter[status]', status);
    if (scan) params.set('filter[scan]', scan);
    if (term.trim()) params.set('q', term.trim());
    return apiData<FilePage>(`/platform/files?${params.toString()}`);
  }, [status, scan, term]);

  const rows = files.data?.data ?? [];
  const canManage = canConsole('console.jobs.manage');
  const reasonReady = reason.trim().length >= 5;

  async function scanNow(row: FileRow) {
    if (busyId || !window.confirm(`إعادة فحص «${row.name}» الآن؟ سيُسجَّل حكم فحص جديد؛ إذا كان الماسح غير مهيّأ فلن يصبح الملف نظيفاً بمجرد تشغيل الفحص.`)) return;
    setBusyId(row.id);
    setNotice(undefined);
    try {
      const result = await apiData<ScanResult>(`/platform/files/${row.id}/scan`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice({
        kind: result.verdict === 'infected' ? 'danger' : result.verdict === 'clean' ? 'ok' : 'warn',
        text: `نتيجة إعادة الفحص: ${SCAN_LABEL[result.verdict] ?? 'حكم غير معروف'}. راجع تفاصيل الحكم في صف الملف.`,
      });
      files.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function quarantine(row: FileRow) {
    if (busyId || !reasonReady || !window.confirm(`حجر الملف «${row.name}»؟ يمنع تنزيله وتبقى ميتاداته دليلاً.`)) return;
    setBusyId(row.id);
    setNotice(undefined);
    try {
      await apiData<FileRow>(`/platform/files/${row.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setNotice({ kind: 'ok', text: `حُجر «${row.name}» — الميتاداتا باقية والسبب مسجَّل.` });
      files.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen
      title="الملفات"
      subtitle="اعرف أي الملفات لم تُفحص أو تعذّر فحصها؛ تحقق من حكم الفحص قبل قرار الحجر أو إعادة المحاولة."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={files.reload}>
          تحديث
        </Button>
      }
    >
      <WorkflowGuide title="مراجعة أمان الملفات" steps={[
        { title: 'حدّد ما يحتاج مراجعة', detail: 'افصل بين الملف الذي لم يُفحص وبين نتيجة «لم يُفحص فعلياً».' },
        { title: 'راجع الارتباط والنتيجة', detail: 'اقرأ صاحب الملف وحالة الفحص؛ عدم العثور على تهديد ليس حكماً بالنظافة إذا لم يعمل الماسح.' },
        { title: 'وثّق القرار', detail: 'إعادة الفحص والحجر عمليتان فعليتان؛ راجع الملف واكتب سبب الحجر قبل التأكيد.' },
      ]} />
      <ContentPanel title="الملفات التي تريد مراجعتها" description="البحث والمرشحات لا تغيّر الملفات؛ النتائج تُجلب من سجل المنصة." className="no-print">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input label="بحث في الاسم" placeholder="كشف" value={term} onChange={(e) => setTerm(e.target.value)} />
          <Select label="حالة الملف" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            <option value="pending">بانتظار الرفع</option>
            <option value="ready">جاهز</option>
            <option value="deleted">محجور</option>
          </Select>
          <Select label="حكم الفحص" value={scan} onChange={(e) => setScan(e.target.value)}>
            <option value="">الكل</option>
            <option value="clean">نظيف</option>
            <option value="infected">مُصاب</option>
            <option value="skipped">لم يُفحص فعلياً</option>
            <option value="none">لم يُفحص بعد</option>
          </Select>
        </div>
        <p className="muted small">
          «لم يُفحص بعد» يعني غياب حكم فحص؛ «لم يُفحص فعلياً» يعني أن الفحص أُجري لكنه لم يختبر المحتوى.
          لا تُعامل أياً منهما على أنه ملف نظيف.
        </p>
      </ContentPanel>
      {canManage && <ContentPanel title="قرار الفحص أو الحجر" description="لا يُطبَّق سبب الحجر إلا على الملف الذي تختار حجزه؛ أعد فحص صف محدد بعد التأكد من جاهزية الماسح." className="no-print">
        <Input label="سبب الحجر (خمسة محارف على الأقل، يُسجَّل في التدقيق)"
          placeholder="مثال: محتوى مشتبه به أبلغ عنه العميل" value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reason.length > 0 && !reasonReady ? 'اكتب خمسة محارف على الأقل' : undefined} />
        <p className="muted small">لن يُمكَّن زر الحجر قبل كتابة السبب. إعادة الفحص لا تجعل الملف آمناً إذا كان الماسح غير مهيّأ.</p>
      </ContentPanel>}

      {notice && <p className={`alert ${notice.kind}`} role={notice.kind === 'danger' ? 'alert' : 'status'}>{notice.text}</p>}

      {files.status === 'loading' ? (
        <ContentPanel title="تحميل الملفات"><SkeletonRows rows={6} /></ContentPanel>
      ) : files.status === 'forbidden' ? (
        <Forbidden />
      ) : files.status === 'error' ? (
        <ErrorBox message={files.error} onRetry={files.reload} />
      ) : rows.length === 0 ? (
        <ContentPanel title="نتيجة البحث"><Empty title="لا ملفات بهذا المرشّح" detail="جرّب مرشّح «لم يُفحص بعد» لمراجعة الملفات التي لا حكم لها." /></ContentPanel>
      ) : (
        <ContentPanel title={`ملفات تحتاج مراجعة (${files.data?.meta.total ?? rows.length})`}
          description={`تظهر ${rows.length} ملفات من النتائج المتاحة. على الهاتف اسحب الجدول أفقياً لمراجعة بقية الأعمدة.`}>
            <Table
              rows={rows}
              rowKey={(row) => row.id}
              dense
              columns={[
                {
                  key: 'name',
                  header: 'الملف',
                  grow: true,
                  cell: (row) => (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="grid size-8 flex-none place-items-center rounded-lg bg-surface-3 text-muted">
                        <FileSearch size={14} />
                      </span>
                      <span className="block min-w-0">
                        <span className="block truncate font-mono text-[12px] font-semibold text-ink" dir="ltr">{row.name}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {fileKind(row.mime)} · {row.uploadedByLabel ?? 'رافع غير معروف'}
                        </span>
                        <details className="text-muted small"><summary>نوع الملف الفني</summary><code dir="ltr">{row.mime}</code></details>
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'tenant',
                  header: 'العميل',
                  cell: (row) => <span className="font-mono text-[12px] text-ink-2" dir="ltr">{row.tenantCode ?? row.tenantId.slice(0, 8)}</span>,
                },
                {
                  key: 'size',
                  header: 'الحجم',
                  numeric: true,
                  ltr: true,
                  cell: (row) => <span className="font-mono text-[12px] text-ink-2">{formatBytes(row.sizeBytes)}</span>,
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} dot>{STATUS_LABEL[row.status] ?? 'حالة أخرى'}</Badge>,
                },
                {
                  key: 'entity',
                  header: 'مربوط بـ',
                  cell: (row) =>
                    row.entity ? (
                      <span className="text-muted">سجل مرتبط
                        <details className="small"><summary>المرجع الفني</summary><code dir="ltr">{row.entity}/{row.entityId ?? ''}</code></details>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: 'scan',
                  header: 'حكم الفحص',
                  cell: (row) =>
                    row.scan ? (
                      <span className="block">
                        <Badge tone={SCAN_TONE[row.scan.verdict] ?? 'neutral'} dot>
                          <ScanLine size={11} /> {SCAN_LABEL[row.scan.verdict] ?? 'حكم غير معروف'}
                        </Badge>
                        <span className="mt-0.5 block text-[11px] text-muted">{dateText(row.scan.recordedAt)}</span>
                        <details className="muted small"><summary>الماسح ونوع الملف</summary><code dir="ltr">{row.scan.scanner} · {row.mime}</code></details>
                      </span>
                    ) : (
                      <Badge tone="neutral">لم يُفحص</Badge>
                    ),
                },
                {
                  key: 'created',
                  header: 'رُفع في',
                  ltr: true,
                  cell: (row) => <span className="text-muted small">{dateText(row.createdAt)}</span>,
                },
                ...(canManage
                  ? [
                      {
                        key: 'actions',
                        header: 'إجراء',
                        numeric: true as const,
                        cell: (row: FileRow) => (
                          <span className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              icon={<ScanLine size={12} />}
                              loading={busyId === row.id}
                              disabled={busyId !== null}
                              onClick={() => void scanNow(row)}
                            >
                              افحص الآن
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              icon={<ShieldAlert size={12} />}
                              disabled={row.status === 'deleted' || !reasonReady || busyId !== null}
                              title={reasonReady ? 'حجر الملف' : 'اكتب السبب أولاً'}
                              onClick={() => void quarantine(row)}
                            >
                              حجر
                            </Button>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
        </ContentPanel>
      )}
    </Screen>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function fileKind(mime: string): string {
  if (mime === 'application/pdf') return 'مستند PDF';
  if (mime.startsWith('image/')) return 'صورة';
  if (mime.startsWith('video/')) return 'فيديو';
  if (mime.startsWith('text/')) return 'ملف نصي';
  return 'ملف من نوع آخر';
}

function dateText(value: string): string {
  return `${new Date(value).toLocaleString('ar-EG', { timeZone: 'UTC' })} (بتوقيت عالمي)`;
}

function apiMessage(error: unknown): string {
  return arabicErrorText(error, 'تعذّر تحديث حالة الملف. أعد المحاولة بعد مراجعة السبب.');
}

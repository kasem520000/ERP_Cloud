'use client';

import { useState } from 'react';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { apiData } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

import { ReadinessPanel, RestoreHistory, RestorePanel } from './restore-panel';

/**
 * البيانات والاسترجاع — النسخ وسياسة الاحتفاظ (P-C10).
 *
 * السؤال الذي تجيب عنه الشاشة: **«أين النسخة، وكيف أعرف أنها سليمة؟»** — لا «هل شغّلنا
 * نسخةً اليوم؟». ولذلك كلُّ صفٍّ يحمل حجمَه وبصمته ومخزنه، والتحقّق يعيد قراءة الملف من
 * مكانه ويقارن؛ فإن تغيّر بايتٌ واحد ظهر ذلك في هذه الشاشة كما هو.
 *
 * وثلاث حقائق تُقال هنا صراحةً بدل أن تُخفى في هامش:
 *   * **الوجهة**: `object-storage` (S3/MinIO) أو `filesystem` — والصفّ يقول أيّهما لكل ملف.
 *   * **الاستعادة التجريبية** تُخطّط ولا تكتب: تقارن جداول النسخة بكتالوج القاعدة الحيّ،
 *     فنسخةٌ فيها جدولٌ أُعيدت تسميته تظهر «منحرفة» لا «جاهزة».
 *   * **سجلّ التدقيق لا يُمحى**: نافذته تُؤرشِف ولا تحذف، والعدّاد ظاهر في بطاقة الاحتفاظ.
 */

type BackupRow = {
  id: string;
  scope: 'platform' | 'tenant';
  tenantId: string | null;
  tenantCode: string | null;
  status: 'running' | 'succeeded' | 'failed';
  store: 'object-storage' | 'filesystem' | null;
  note: string | null;
  failureReason: string | null;
  tables: number;
  rows: number;
  tenants: number;
  bytes: number | null;
  checksum: string | null;
  encryption: string | null;
  objectKey: string | null;
  artifactId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  verifiedAt: string | null;
  prunedAt: string | null;
  requestedByLabel: string | null;
};

type BackupPage = { data: BackupRow[]; meta: { total: number } };

type RetentionPolicy = {
  auditArchiveDays: number;
  idempotencyPurgeDays: number;
  outboxPurgeDays: number;
  fileOrphanPurgeDays: number;
  artifactRetentionDays: number;
};

type Retention = {
  policy: RetentionPolicy;
  defaults: RetentionPolicy;
  updatedAt: string | null;
  purges: {
    idempotencyExpired: number;
    outboxPurgeable: number;
    fileOrphans: number;
    artifactsExpired: number;
    auditArchivable: number;
  };
  auditHardDeleteAllowed: false;
  computedAt: string;
};

type VerifyResult = {
  jobId: string;
  verified: boolean;
  checksum: { expected: string | null; actual: string | null; matches: boolean };
  bytes: number | null;
  format: string | null;
  lines: number;
  tables: Array<{ table: string; rows: number }>;
  tenants: string[];
  totalRows: number;
  truncated: boolean;
  restore: { mode: string; tables: number; rows: number; missingTables: string[]; verdict: string };
  detail: string | null;
};

type DownloadLink = {
  url: string;
  name: string;
  expiresAt: string;
  bytes: number | null;
  checksum: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  running: 'قيد التشغيل',
  succeeded: 'ناجحة',
  failed: 'فاشلة',
};

const STATUS_CLASS: Record<string, string> = { running: 'pending', succeeded: 'active', failed: 'failed' };

const STORE_LABEL: Record<string, string> = {
  'object-storage': 'تخزين الكائنات (S3)',
  filesystem: 'نظام ملفات الخادم',
};

const VERDICT_LABEL: Record<string, string> = {
  ready: 'جاهزة للاستعادة',
  drifted: 'منحرفة (جدول مفقود)',
  unreadable: 'غير قابلة للقراءة',
};

const WINDOWS: Array<{ key: keyof RetentionPolicy; label: string; hint: string }> = [
  { key: 'auditArchiveDays', label: 'أرشفة التدقيق (يوم)', hint: 'يُؤرشَف ولا يُمحى — 90..3650' },
  { key: 'artifactRetentionDays', label: 'ملفات النسخ (يوم)', hint: 'ثم تُحذف البايتات ويبقى الصفّ' },
  { key: 'idempotencyPurgeDays', label: 'مفاتيح idempotency (يوم)', hint: '7..365' },
  { key: 'outboxPurgeDays', label: 'مهامّ الطابور المنتهية (يوم)', hint: '7..365' },
  { key: 'fileOrphanPurgeDays', label: 'الملفات اليتيمة (يوم)', hint: '1..90' },
];

export default function BackupsPage() {
  const { canConsole } = useSession();
  const canManage = canConsole('console.backups.manage');

  const [scope, setScope] = useState<'platform' | 'tenant'>('platform');
  const [tenant, setTenant] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [policy, setPolicy] = useState<Partial<RetentionPolicy>>({});
  const [verify, setVerify] = useState<VerifyResult | undefined>(undefined);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreJob, setRestoreJob] = useState<BackupRow | undefined>(undefined);
  const [historyKey, setHistoryKey] = useState(0);

  const runs = useQuery<BackupPage>(() => apiData<BackupPage>('/platform/backups?limit=50'), []);
  const retention = useQuery<Retention>(() => apiData<Retention>('/platform/retention'), []);
  const rows = runs.data?.data ?? [];
  const effective = { ...(retention.data?.policy ?? ({} as RetentionPolicy)), ...policy } as RetentionPolicy;
  const reasonReady = reason.trim().length >= 5;

  async function runBackup() {
    setBusy('run');
    setNotice(undefined);
    try {
      const created = await apiData<BackupRow>('/platform/backups/run', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          ...(scope === 'tenant' ? { tenantId: tenant.trim() } : {}),
          ...(note.trim().length >= 3 ? { note: note.trim() } : {}),
        }),
      });
      setNotice(
        created.status === 'succeeded'
          ? {
              kind: 'ok',
              text: `نسخةٌ ناجحة: ${formatBytes(created.bytes ?? 0)} في ${created.durationMs ?? 0} م.ث — البصمة ${created.checksum?.slice(0, 12)}…`,
            }
          : { kind: 'danger', text: `فشلت النسخة: ${created.failureReason ?? 'بلا سبب مسجَّل'}` },
      );
      runs.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function verifyRun(row: BackupRow) {
    setBusy(row.id);
    setNotice(undefined);
    try {
      const result = await apiData<VerifyResult>(`/platform/backups/${row.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setVerify(result);
      setNotice({
        kind: result.verified ? 'ok' : 'danger',
        text: result.verified
          ? `الملف سليم: البصمة تُطابق، و${result.tables.length} جدولاً و${result.totalRows} صفاً قُرئت من الملف.`
          : `التحقّق فشل: ${result.detail ?? 'الملف لا يطابق بصمته'}`,
      });
      runs.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function download(row: BackupRow) {
    setBusy(row.id);
    setNotice(undefined);
    try {
      const link = await apiData<DownloadLink>(`/platform/backups/${row.id}/download`);
      window.open(link.url, '_blank', 'noopener');
      setNotice({
        kind: 'ok',
        text: `رابطٌ موقّع صالح حتى ${new Date(link.expiresAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function savePolicy() {
    setBusy('policy');
    setNotice(undefined);
    try {
      const updated = await apiData<Retention>('/platform/retention', {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
      setPolicy({});
      setNotice({
        kind: 'ok',
        text: `حُفظت السياسة: أرشفة التدقيق ${updated.policy.auditArchiveDays} يوماً.`,
      });
      retention.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function apply(mode: 'dry_run' | 'apply') {
    if (
      mode === 'apply' &&
      !window.confirm('تطبيق سياسة الاحتفاظ يحذف بايتات النسخ المنتهية وصفوفاً منتهية. المتابعة؟')
    ) {
      return;
    }
    setBusy(mode);
    setNotice(undefined);
    try {
      const result = await apiData<{
        mode: string;
        results: Array<{ target: string; rows: number; objectsRemoved: number }>;
      }>('/platform/retention/apply', {
        method: 'POST',
        body: JSON.stringify({ mode, reason: reason.trim() }),
      });
      const touched = result.results.reduce((count, entry) => count + entry.rows, 0);
      setNotice({
        kind: 'ok',
        text:
          mode === 'dry_run'
            ? `قياسٌ تجريبي: ${touched} عنصراً سيطالها التنفيذ — ولم يُمسّ شيء.`
            : `نُفِّذت السياسة: ${touched} عنصراً، وحُذف ${result.results.reduce((count, entry) => count + entry.objectsRemoved, 0)} ملفاً.`,
      });
      runs.reload();
      retention.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  const columns: Array<Column<BackupRow>> = [
    {
      key: 'started',
      header: 'بدأت',
      ltr: true,
      cell: (row) => new Date(row.startedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
    {
      key: 'scope',
      header: 'النطاق',
      cell: (row) => (
        <>
          {row.scope === 'platform' ? 'المنصّة' : `مستأجر: ${row.tenantCode ?? row.tenantId?.slice(0, 8)}`}
          <div className="muted small">{row.tenants} مستأجراً في النسخة</div>
        </>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => (
        <>
          <span className={`badge ${STATUS_CLASS[row.status] ?? 'pending'}`}>
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
          {row.prunedAt && <div className="muted small">حُذفت بايتاتها بالاحتفاظ</div>}
        </>
      ),
    },
    {
      key: 'bytes',
      header: 'الحجم',
      numeric: true,
      cell: (row) => (row.bytes === null ? '—' : formatBytes(row.bytes)),
    },
    {
      key: 'content',
      header: 'المحتوى',
      numeric: true,
      cell: (row) => (
        <>
          {row.tables} جدولاً · {row.rows} صفاً
          <div className="muted small">{row.durationMs ?? 0} م.ث</div>
        </>
      ),
    },
    { key: 'store', header: 'الوجهة', cell: (row) => (row.store ? STORE_LABEL[row.store] : '—') },
    {
      key: 'checksum',
      header: 'البصمة',
      ltr: true,
      cell: (row) => <span className="small">{row.checksum ? `${row.checksum.slice(0, 12)}…` : '—'}</span>,
    },
    {
      key: 'verify',
      header: 'تحقّق',
      cell: (row) =>
        row.verifiedAt ? (
          <span className="badge active">فُحصت</span>
        ) : (
          <span className="badge pending">لم تُفحص</span>
        ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      hideOnPrint: true,
      cell: (row) => (
        <div className="row" style={{ gap: 6 }}>
          <button
            className="btn small"
            type="button"
            disabled={busy === row.id || !row.artifactId || Boolean(row.prunedAt)}
            onClick={() => void verifyRun(row)}
          >
            تحقّق
          </button>
          <button
            className="btn small"
            type="button"
            disabled={busy === row.id || !row.artifactId || Boolean(row.prunedAt)}
            onClick={() => void download(row)}
          >
            تنزيل
          </button>
          <button
            className="btn small primary"
            type="button"
            disabled={!row.artifactId || Boolean(row.prunedAt) || row.status !== 'succeeded'}
            title={'استعادة إضافية: تُدرج الصفوف الغائبة ولا تدهس موجوداً'}
            onClick={() => setRestoreJob(row)}
          >
            استعادة
          </button>
        </div>
      ),
    },
  ];

  return (
    <Screen
      title="البيانات والاسترجاع"
      subtitle="نسخةٌ تُغادر القاعدة إلى ملفٍّ مشفّر باسمه وحجمه وبصمته، وسياسة احتفاظٍ تُنفَّذ فعلاً، وتحلٍّ يعيد قراءة الملف لا يقرأ الاستجابة."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <button className="btn" type="button" onClick={runs.reload}>
          تحديث
        </button>
      }
    >
      {!canManage ? (
        <Forbidden />
      ) : (
        <>
          <Panel className="tight no-print">
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field" style={{ minWidth: 180 }}>
                <span>نطاق النسخة</span>
                <select
                  className="input"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'platform' | 'tenant')}
                >
                  <option value="platform">المنصّة كاملة (كل مستأجر في سياقه)</option>
                  <option value="tenant">مستأجرٌ واحد</option>
                </select>
              </label>
              {scope === 'tenant' && (
                <label className="field" style={{ minWidth: 320, flex: 1 }}>
                  <span>معرّف المستأجر (uuid)</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={tenant}
                    onChange={(event) => setTenant(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </label>
              )}
              <label className="field" style={{ minWidth: 240, flex: 1 }}>
                <span>ملاحظة (اختياري)</span>
                <input
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="مثال: نسخة قبل ترقية 0075"
                />
              </label>
              <button
                className="btn primary"
                type="button"
                disabled={busy === 'run'}
                onClick={() => void runBackup()}
              >
                {busy === 'run' ? 'تقرأ الجداول…' : 'شغّل نسخة الآن'}
              </button>
            </div>
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              الجداول تُقرأ من كتالوج القاعدة لا من قائمةٍ في الكود: جداول المستأجرين داخل سياق كل مستأجر
              (`app.tenant_id`)، وجداول المنصّة في سياق المنصّة. والملف NDJSON مشفّر بـAES-256-GCM ومكتوبٌ مع
              ترويسته، والصفّ يسجّل حجمه وبصمته بعد قراءتهما من المخزن.
            </p>
          </Panel>

          {notice && <div className={`alert ${notice.kind === 'ok' ? '' : 'danger'}`}>{notice.text}</div>}

          <ReadinessPanel key={historyKey} />

          {restoreJob && (
            <RestorePanel
              job={restoreJob}
              onClose={() => setRestoreJob(undefined)}
              onRestored={() => {
                setHistoryKey((value) => value + 1);
                runs.reload();
              }}
            />
          )}

          {runs.status === 'loading' && <Loading />}
          {runs.status === 'forbidden' && <Forbidden />}
          {runs.status === 'error' && <ErrorBox message={runs.error} onRetry={runs.reload} />}
          {runs.status === 'success' &&
            (rows.length === 0 ? (
              <Empty title="لا نسخ بعد" detail="شغّل نسخةً الآن — ستظهر هنا بحجمها وبصمتها ومكانها." />
            ) : (
              <>
                <p className="muted small">
                  {rows.length} من {runs.data?.meta.total ?? rows.length} نسخة
                </p>
                <Panel flush title="النسخ الاحتياطية">
                  <Table bare columns={columns} rows={rows} rowKey={(row) => row.id} />
                </Panel>
              </>
            ))}

          <RestoreHistory reloadKey={historyKey} />

          {verify && (
            <Panel title="نتيجة التحقّق — استعادة تجريبية">
              <p className={verify.verified ? '' : 'danger'}>
                {verify.verified ? 'الملف مطابقٌ لبصمته، وعدّاداته مقروءة.' : verify.detail}
              </p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 18 }}>
                <span className="small">
                  الصيغة: <span dir="ltr">{verify.format ?? '—'}</span>
                </span>
                <span className="small">
                  الأسطر: <span className="num">{verify.lines}</span>
                </span>
                <span className="small">
                  الجداول: <span className="num">{verify.restore.tables}</span>
                </span>
                <span className="small">
                  الصفوف: <span className="num">{verify.restore.rows}</span>
                </span>
                <span className="small">
                  الحكم: <strong>{VERDICT_LABEL[verify.restore.verdict] ?? verify.restore.verdict}</strong>
                </span>
                <span className="small">
                  مستأجرون في النسخة: <span className="num">{verify.tenants.length}</span>
                </span>
              </div>
              {verify.restore.missingTables.length > 0 && (
                <p className="danger small">
                  جداول في النسخة لم تعد في القاعدة (انحراف مخطّط):{' '}
                  <span dir="ltr">{verify.restore.missingTables.join(', ')}</span>
                </p>
              )}
              <p className="muted small" style={{ marginBottom: 0 }}>
                هذا تحقّقٌ لا كتابة. أمّا الاستعادة الفعلية فمن زرّ «استعادة» في صفّ النسخة أعلاه: تُدرج الصفوف
                الغائبة داخل سياق كل مستأجر، وتتخطّى الموجود، وتُسجَّل محاولةً لها بصمتها وسببها.
              </p>
            </Panel>
          )}

          {retention.status === 'success' && retention.data && (
            <Panel title="سياسة الاحتفاظ">
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {WINDOWS.map((window) => (
                  <label className="field" key={window.key} style={{ minWidth: 200 }}>
                    <span>{window.label}</span>
                    <input
                      className="input num"
                      type="number"
                      value={effective[window.key] ?? ''}
                      onChange={(event) =>
                        setPolicy((current) => ({ ...current, [window.key]: Number(event.target.value) }))
                      }
                    />
                    <span className="muted small">{window.hint}</span>
                  </label>
                ))}
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy === 'policy' || Object.keys(policy).length === 0}
                  onClick={() => void savePolicy()}
                >
                  احفظ النوافذ
                </button>
              </div>

              <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
                <span className="small">
                  ملفات نسخٍ منتهية: <span className="num">{retention.data.purges.artifactsExpired}</span>
                </span>
                <span className="small">
                  مفاتيح idempotency منتهية:{' '}
                  <span className="num">{retention.data.purges.idempotencyExpired}</span>
                </span>
                <span className="small">
                  مهامّ طابورٍ منتهية: <span className="num">{retention.data.purges.outboxPurgeable}</span>
                </span>
                <span className="small">
                  ملفات يتيمة: <span className="num">{retention.data.purges.fileOrphans}</span>
                </span>
                <span className="small">
                  صفوف تدقيق قابلة للأرشفة:{' '}
                  <span className="num">{retention.data.purges.auditArchivable}</span>
                </span>
              </div>

              <p className="muted small">
                سجلّ التدقيق <strong>لا يُمحى</strong> بقرارٍ من اللوحة: القاعدة تمنع UPDATE/DELETE عليه،
                ونافذته تُستخدم للأرشفة وللعدّ فقط. النوافذ تُكتب في إعدادات المنصّة تحت المفتاح
                `retention.policy` ولكل تعديلٍ صفُّ تدقيق.
              </p>

              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label className="field" style={{ minWidth: 340, flex: 1 }}>
                  <span>سبب التنفيذ (5 محارف على الأقل — يُسجَّل في التدقيق)</span>
                  <input
                    className="input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="مثال: تنظيف ربع سنوي بعد أخذ نسخة"
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={!reasonReady || busy !== null}
                  onClick={() => void apply('dry_run')}
                >
                  قِس بلا تنفيذ
                </button>
                <button
                  className="btn danger"
                  type="button"
                  disabled={!reasonReady || busy !== null}
                  title={reasonReady ? 'ينفّذ فعلاً' : 'اكتب السبب أولاً'}
                  onClick={() => void apply('apply')}
                >
                  طبّق الآن
                </button>
              </div>
            </Panel>
          )}
        </>
      )}
      <GoogleDriveSection />
    </Screen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// جوجل درايف — النسخ المرتفع إلى الدرايف
//
// قسمٌ مستقلٌ في صفحة نسخ المنصة: حالة الاتصال، زر الربط/قطع الربط، زر الرفع،
// قائمة الملفات المرفوعة، وزر الاستعادة من الدرايف. كل العمليات عبر `/platform/google-drive/*`.
// ─────────────────────────────────────────────────────────────────────────────

type GoogleDriveConnection = {
  connected: boolean;
  email: string;
  connectedAt: string | null;
  files: number;
  totalBytes: number;
  status: string;
};

type GoogleDriveFile = {
  id: string;
  name: string;
  sizeBytes: number;
  checksum: string;
  uploadedAt: string;
  scope: string;
  tenantId: string | null;
  backupJobId: string | null;
};

function GoogleDriveSection() {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<GoogleDriveConnection | null>(null);
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);

  const fmtDate = (value: string): string => {
    return value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '—';
  };

  async function refresh() {
    try {
      const status = await apiData<GoogleDriveConnection>('/platform/google-drive/status');
      setConn(status);
      const list = await apiData<GoogleDriveFile[]>('/platform/google-drive/files');
      setFiles(list);
    } catch {
      setConn(null);
      setFiles([]);
    }
  }

  async function connect() {
    setBusy(true);
    setNotice(undefined);
    try {
      const status = await apiData<GoogleDriveConnection>('/platform/google-drive/connect', { method: 'POST' });
      setConn(status);
      setNotice({ kind: 'ok', text: `تم ربط حساب جوجل درايف: ${status.email}` });
      refresh();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiData('/platform/google-drive/disconnect', { method: 'POST' });
      setNotice({ kind: 'info', text: 'تم قطع اتصال جوجل درايف ومسح الملفات المرفوعة.' });
      setConn(null);
      setFiles([]);
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function restore(fileId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiData(`/platform/google-drive/files/${fileId}/restore`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'dry_run' }),
      });
      setNotice({ kind: 'ok', text: 'تمت الاستعادة التجريبية من جوجل درايف.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(fileId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiData(`/platform/google-drive/files/${fileId}`, { method: 'DELETE' });
      setNotice({ kind: 'info', text: 'تم حذف الملف من جوجل درايف.' });
      refresh();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="جوجل درايف">
      <p className="alert info">
        يُمكن رفع النسخ المحفوظة إلى جوجل درايف كنسخة احتياطية خارجية. الاستعادة من الدرايف تستخدم
        نفس آلية الاستعادة من المخزن المحلي.
      </p>
      <div className="toolbar">
        {conn?.connected ? (
          <>
            <span className="badge ok">متصل</span>
            <span className="muted">{conn.email}</span>
            {conn.files > 0 && <span className="muted">{conn.files} ملف، {formatBytes(conn.totalBytes)}</span>}
            <button type="button" className="btn sm danger" onClick={disconnect} disabled={busy}>
              قطع الاتصال
            </button>
          </>
        ) : (
          <>
            <span className="badge warn">غير متصل</span>
            <button type="button" className="btn sm primary" onClick={connect} disabled={busy}>
              ربط حساب جوجل درايف
            </button>
          </>
        )}
        <button type="button" className="btn sm" onClick={refresh} disabled={busy}>
          تحديث
        </button>
      </div>
      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}
      {files.length > 0 && (
        <Table
          columns={[
            { key: 'uploadedAt', header: 'التاريخ', cell: (f: GoogleDriveFile) => fmtDate(f.uploadedAt) },
            { key: 'name', header: 'الاسم', cell: (f: GoogleDriveFile) => f.name },
            { key: 'scope', header: 'النطاق', cell: (f: GoogleDriveFile) => f.scope },
            { key: 'size', header: 'الحجم', cell: (f: GoogleDriveFile) => formatBytes(f.sizeBytes) },
            { key: 'checksum', header: 'البصمة', ltr: true, cell: (f: GoogleDriveFile) => f.checksum.slice(0, 12) },
            {
              key: 'actions',
              header: '',
              cell: (f: GoogleDriveFile) => (
                <div className="toolbar">
                  <button type="button" className="btn sm" onClick={() => restore(f.id)} disabled={busy}>
                    استعادة
                  </button>
                  <button type="button" className="btn sm danger" onClick={() => removeFile(f.id)} disabled={busy}>
                    حذف
                  </button>
                </div>
              ),
            },
          ]}
          rows={files}
          rowKey={(f) => f.id}
        />
      )}
    </Panel>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function apiMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'تعذّر تنفيذ الفعل.';
}

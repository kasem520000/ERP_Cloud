'use client';

import { useState } from 'react';
import { ContentPanel, TableViewport, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { apiData } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

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
  'object-storage': 'التخزين الخارجي الآمن',
  filesystem: 'نظام ملفات الخادم',
};

const VERDICT_LABEL: Record<string, string> = {
  ready: 'جاهزة للاستعادة',
  drifted: 'منحرفة (جدول مفقود)',
  unreadable: 'غير قابلة للقراءة',
};

const WINDOWS: Array<{ key: keyof RetentionPolicy; label: string; hint: string; min: number; max: number }> = [
  { key: 'auditArchiveDays', label: 'أرشفة التدقيق (يوم)', hint: 'يُؤرشَف ولا يُمحى — من ٩٠ إلى ٣٦٥٠ يوماً', min: 90, max: 3650 },
  { key: 'artifactRetentionDays', label: 'ملفات النسخ (يوم)', hint: 'ثم تُحذف الملفات ويبقى سجل النسخة — من يوم إلى ٣٦٥ يوماً', min: 1, max: 365 },
  { key: 'idempotencyPurgeDays', label: 'مفاتيح منع تكرار الطلبات (يوم)', hint: 'من ٧ إلى ٣٦٥ يوماً', min: 7, max: 365 },
  { key: 'outboxPurgeDays', label: 'مهامّ الطابور المنتهية (يوم)', hint: 'من ٧ إلى ٣٦٥ يوماً', min: 7, max: 365 },
  { key: 'fileOrphanPurgeDays', label: 'الملفات اليتيمة (يوم)', hint: 'من يوم إلى ٩٠ يوماً', min: 1, max: 90 },
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
  const [preview, setPreview] = useState<{ reason: string; policyUpdatedAt: string | null; touched: number } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const runs = useQuery<BackupPage>(() => apiData<BackupPage>('/platform/backups?limit=50'), []);
  const retention = useQuery<Retention>(() => apiData<Retention>('/platform/retention'), []);
  const tenants = useQuery<Array<{ id: string; code: string; name: string }>>(
    () => apiData<Array<{ id: string; code: string; name: string }>>('/platform/tenants?limit=100'),
    [],
  );
  const rows = runs.data?.data ?? [];
  const effective = { ...(retention.data?.policy ?? ({} as RetentionPolicy)), ...policy } as RetentionPolicy;
  const reasonReady = reason.trim().length >= 5;
  const policyChanged = Object.keys(policy).length > 0;
  const policyValid = WINDOWS.every((field) =>
    policy[field.key] === undefined || (Number.isInteger(policy[field.key]) &&
      policy[field.key]! >= field.min && policy[field.key]! <= field.max));
  const previewReady = Boolean(preview && preview.reason === reason.trim() && preview.policyUpdatedAt === retention.data?.updatedAt);
  const selectedTenant = tenants.data?.find((item) => item.id === tenant);

  async function runBackup() {
    if (busy || (scope === 'tenant' && !selectedTenant)) return;
    const target = scope === 'platform' ? 'للمنصة كاملة' : `للمنشأة «${selectedTenant?.name}»`;
    if (!window.confirm(`إنشاء نسخة ${target} الآن؟ ستُقرأ البيانات ويُنشأ ملف جديد في المخزن.`)) return;
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
    if (busy || !window.confirm('فحص سلامة النسخة يعيد قراءة الملف ويُسجّل وقت التحقق؛ لا يستعيد البيانات. متابعة؟')) return;
    setVerify(undefined);
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
    if (busy || !window.confirm('سيُفتح رابط تنزيل نسخة تحتوي على بيانات حساسة في نافذة جديدة. تأكد من بيئة حفظ آمنة. متابعة؟')) return;
    setBusy(row.id);
    setNotice(undefined);
    try {
      const link = await apiData<DownloadLink>(`/platform/backups/${row.id}/download`);
      window.open(link.url, '_blank', 'noopener');
      setNotice({
        kind: 'ok',
        text: `رابطٌ موقّع صالح حتى ${new Date(link.expiresAt).toLocaleString('ar-SA')}.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function savePolicy() {
    if (busy || !policyChanged || !policyValid) return;
    const changes = WINDOWS.filter((field) => field.key in policy)
      .map((field) => `${field.label}: ${policy[field.key]} يوم`).join('، ');
    if (!window.confirm(`حفظ نوافذ الاحتفاظ المعدّلة (${changes})؟ يؤثر هذا في عمليات التنظيف اللاحقة، لكنه لا ينفّذ التنظيف الآن.`)) return;
    setBusy('policy');
    setNotice(undefined);
    try {
      const updated = await apiData<Retention>('/platform/retention', {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
      setPolicy({});
      setPreview(null);
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
    if (busy || !reasonReady || policyChanged) return;
    if (mode === 'apply' && (!previewReady ||
      !window.confirm(`نتيجة القياس السابق: ${preview?.touched ?? 0} عنصر. التنفيذ الفعلي قد يختلف إن تغيّرت البيانات؛ سيحذف ملفات النسخ المنتهية وصفوفاً منتهية. السبب: ${reason.trim()}. متابعة؟`))) return;
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
      if (mode === 'dry_run') setPreview({ reason: reason.trim(), policyUpdatedAt: retention.data?.updatedAt ?? null, touched });
      else setPreview(null);
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

  return (
    <Screen
      title="البيانات والاسترجاع"
      subtitle="أنشئ نسخة عند الحاجة، راجع سلامتها ومكان حفظها، ثم قِس أثر سياسة الاحتفاظ قبل تنفيذها. لا تعني قراءة الملف استعادة البيانات."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <button className="btn" type="button" onClick={() => {
          setVerify(undefined);
          setPreview(null);
          runs.reload();
          retention.reload();
          tenants.reload();
        }}>
          تحديث
        </button>
      }
    >
      {!canManage ? (
        <Forbidden />
      ) : (
        <>
          <WorkflowGuide title="مسار حماية البيانات" steps={[
            { title: 'حدّد النطاق', detail: 'اختر المنصة كاملة أو منشأة بعينها قبل إنشاء ملف جديد.' },
            { title: 'راجع سلامة النسخة', detail: 'اقرأ البصمة ونتيجة الفحص؛ الفحص لا يستعيد البيانات.' },
            { title: 'قِس قبل التنظيف', detail: 'احفظ نوافذ الاحتفاظ، ثم اطّلع على القياس قبل التنفيذ الفعلي.' },
          ]} />
          <ContentPanel title="إنشاء نسخة" description="هذه العملية تنشئ ملفاً جديداً؛ اختيار النطاق وحده لا يبدأ النسخ." className="no-print">
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field" style={{ minWidth: 180 }}>
                <span>نطاق النسخة</span>
                <select
                  className="input"
                  value={scope}
                  onChange={(event) => {
                    setScope(event.target.value as 'platform' | 'tenant');
                    setTenant('');
                  }}
                >
                  <option value="platform">المنصّة كاملة (كل مستأجر في سياقه)</option>
                  <option value="tenant">مستأجرٌ واحد</option>
                </select>
              </label>
              {scope === 'tenant' && (
                <label className="field" style={{ minWidth: 260, flex: 1 }}>
                  <span>المنشأة المطلوب نسخها</span>
                  <select
                    className="input"
                    value={tenant}
                    onChange={(event) => setTenant(event.target.value)}
                    disabled={tenants.status !== 'success'}
                  >
                    <option value="">{tenants.status === 'loading' ? 'تُحمَّل المنشآت…' : 'اختر المنشأة'}</option>
                    {(tenants.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.code})</option>
                    ))}
                  </select>
                  {tenants.status === 'error' && <span className="danger small">تعذّر تحميل المنشآت. حاول تحديث الصفحة.</span>}
                  {tenants.status === 'forbidden' && <span className="danger small">ليست لديك صلاحية عرض المنشآت.</span>}
                </label>
              )}
              <label className="field" style={{ minWidth: 240, flex: 1 }}>
                <span>ملاحظة (اختياري)</span>
                <input
                  className="input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="مثال: نسخة قبل تحديث النظام"
                />
              </label>
              <button
                className="btn primary"
                type="button"
                disabled={busy !== null || (scope === 'tenant' && !selectedTenant)}
                onClick={() => void runBackup()}
              >
                {busy === 'run' ? 'تقرأ الجداول…' : 'شغّل نسخة الآن'}
              </button>
            </div>
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              النسخة ملف مشفّر؛ يُسجّل النظام حجمه وبصمته ومكانه. تأكّد من النطاق قبل البدء، ولا تعتبر إنشاء الملف دليلاً على إمكان استعادته.
            </p>
          </ContentPanel>

          {notice && <div role="status" className={`alert ${notice.kind}`}>{notice.text}</div>}

          <ContentPanel title="النسخ المسجّلة" description="تحقّق من البصمة ونتيجة الفحص قبل أي اعتماد على نسخة محفوظة.">
          {runs.status === 'loading' && <Loading />}
          {runs.status === 'forbidden' && <Forbidden />}
          {runs.status === 'error' && <ErrorBox message={runs.error} onRetry={runs.reload} />}
          {runs.status === 'success' &&
            (rows.length === 0 ? (
              <Empty title="لا نسخ بعد" detail="بعد إنشاء نسخة بإذن مناسب ستظهر هنا مع الحجم والبصمة ومكان الحفظ." />
            ) : (
              <>
                <p className="muted small">
                  {rows.length} من {runs.data?.meta.total ?? rows.length} نسخة
                </p>
                <TableViewport label="النسخ المسجّلة — مرّر أفقياً لعرض التفاصيل والإجراءات">
                  <table style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th>بدأت</th>
                        <th>النطاق</th>
                        <th>الحالة</th>
                        <th>الحجم</th>
                        <th>المحتوى</th>
                        <th>الوجهة</th>
                        <th>البصمة</th>
                        <th>تحقّق</th>
                        <th className="no-print">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td dir="ltr">{new Date(row.startedAt).toLocaleString('ar-SA')}</td>
                          <td>
                            {row.scope === 'platform'
                              ? 'المنصّة'
                              : `مستأجر: ${row.tenantCode ?? row.tenantId?.slice(0, 8)}`}
                            <div className="muted small">{row.tenants} مستأجراً في النسخة</div>
                          </td>
                          <td>
                            <span className={`badge ${STATUS_CLASS[row.status] ?? 'pending'}`}>
                              {STATUS_LABEL[row.status] ?? row.status}
                            </span>
                            {row.prunedAt && <div className="muted small">حُذفت بايتاتها بالاحتفاظ</div>}
                          </td>
                          <td className="num">{row.bytes === null ? '—' : formatBytes(row.bytes)}</td>
                          <td className="num small">
                            {row.tables} جدولاً · {row.rows} صفاً
                            <div className="muted small">{row.durationMs ?? 0} م.ث</div>
                          </td>
                          <td>{row.store ? STORE_LABEL[row.store] : '—'}</td>
                          <td dir="ltr" className="small">
                            {row.checksum ? `${row.checksum.slice(0, 12)}…` : '—'}
                          </td>
                          <td className="small">
                            {row.verifiedAt ? (
                              <span className="badge active">فُحصت</span>
                            ) : (
                              <span className="badge pending">لم تُفحص</span>
                            )}
                          </td>
                          <td className="no-print">
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                className="btn small"
                                type="button"
                                disabled={busy !== null || !row.artifactId || Boolean(row.prunedAt)}
                                onClick={() => void verifyRun(row)}
                              >
                                تحقّق
                              </button>
                              <button
                                className="btn small"
                                type="button"
                                disabled={busy !== null || !row.artifactId || Boolean(row.prunedAt)}
                                onClick={() => void download(row)}
                              >
                                تنزيل
                              </button>
                            </div>
                            {row.failureReason && (
                              <div className="muted small" dir="ltr">
                                {row.failureReason}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableViewport>
              </>
            ))}
          </ContentPanel>

          {verify && (
            <ContentPanel title="نتيجة فحص سلامة النسخة" description="قراءة الملف ومقارنته بمعلوماته؛ لا تنشئ استعادة فعلية.">
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
                الاستعادة التجريبية تقرأ وتطابق ولا تكتب: الكتابة فوق بياناتٍ حيّة تحتاج نافذة صيانة، وهي خارج
                نطاق هذا الجزء. الظاهر هنا أقوى ما يمكن إثباته بلا كتابة.
              </p>
            </ContentPanel>
          )}

          {retention.status === 'loading' && <Loading />}
          {retention.status === 'forbidden' && <Forbidden />}
          {retention.status === 'error' && <ErrorBox message={retention.error} onRetry={retention.reload} />}
          {retention.status === 'success' && retention.data && (
            <ContentPanel title="سياسة الاحتفاظ" description="تحرير النوافذ، حفظ السياسة، قياس أثرها، ثم قرار التنفيذ: مراحل منفصلة.">
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {WINDOWS.map((window) => (
                  <label className="field" key={window.key} style={{ minWidth: 200 }}>
                    <span>{window.label}</span>
                    <input
                      className="input num"
                      type="number"
                      min={window.min}
                      max={window.max}
                      step="1"
                      value={effective[window.key] ?? ''}
                      onChange={(event) => {
                        setPolicy((current) => {
                          const next = { ...current, [window.key]: Number(event.target.value) };
                          if (next[window.key] === retention.data?.policy[window.key]) delete next[window.key];
                          return next;
                        });
                        setPreview(null);
                      }}
                    />
                    <span className="muted small">{window.hint}</span>
                  </label>
                ))}
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy !== null || !policyChanged || !policyValid}
                  onClick={() => void savePolicy()}
                >
                  احفظ النوافذ
                </button>
              </div>

              {policyChanged && <p className="alert warn" role="status">توجد تغييرات غير محفوظة. احفظ السياسة قبل القياس أو التنفيذ؛ النوافذ المعروضة ليست هي النوافذ النشطة بعد. {policyValid ? '' : 'صحّح القيم وفق الحدود المبيّنة قبل الحفظ.'}</p>}
              <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginTop: 12 }}>
                <span className="small">
                  ملفات نسخٍ منتهية: <span className="num">{retention.data.purges.artifactsExpired}</span>
                </span>
                <span className="small">
                  مفاتيح منع تكرار الطلبات منتهية:{' '}
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
                سجلّ التدقيق <strong>لا يُمحى</strong> من هذه الشاشة؛ تُستخدم نافذته للأرشفة والعدّ فقط. تحفظ تغييرات السياسة في إعدادات المنصة ويُسجَّل تعديلها في التدقيق.
              </p>

              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label className="field" style={{ minWidth: 340, flex: 1 }}>
                  <span>سبب التنفيذ (5 محارف على الأقل — يُسجَّل في التدقيق)</span>
                  <input
                    className="input"
                    value={reason}
                    onChange={(event) => { setReason(event.target.value); setPreview(null); }}
                    placeholder="مثال: تنظيف ربع سنوي بعد أخذ نسخة"
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={!reasonReady || busy !== null || policyChanged}
                  onClick={() => void apply('dry_run')}
                >
                  قِس بلا تنفيذ
                </button>
                <button
                  className="btn danger"
                  type="button"
                  disabled={!reasonReady || busy !== null || policyChanged || !previewReady}
                  title={reasonReady ? 'ينفّذ فعلاً' : 'اكتب السبب أولاً'}
                  onClick={() => void apply('apply')}
                >
                  طبّق الآن
                </button>
              </div>
              {previewReady ? <p className="alert warn" role="status">آخر قياس بهذا السبب: {preview?.touched} عنصر. العدد تقديري حتى لحظة التنفيذ؛ افحصه قبل المتابعة.</p> : <p className="muted small">يتاح التنفيذ بعد قياس السياسة النشطة بهذا السبب؛ القياس لا يحذف شيئاً.</p>}
            </ContentPanel>
          )}
        </>
      )}
    </Screen>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

function apiMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return arabicErrorText(error.message);
  return 'تعذّر تنفيذ الفعل.';
}

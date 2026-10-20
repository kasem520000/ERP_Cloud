'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Panel } from '@erp/ui';

import { apiData } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * الفحص المسبق والاستعادة — البندان 1 و2 من قائمة 20 أكتوبر.
 *
 * الشاشتان تجيبان سؤالين لم تكن الشاشة تجيبهما:
 *   * **«لماذا تفشل النسخة؟»** — قبل التشغيل، لا بعده: مفتاح، ومجلد، ومخزن، وحجم.
 *   * **«أعِد لي البيانات»** — استعادةٌ حقيقية تُدرج الصفوف الغائبة، لا «تحقّق» آخر.
 */

type PreflightCheck = {
  id: 'store' | 'key' | 'artifact-dir' | 'size' | 'db';
  ok: boolean;
  label: string;
  detail: string;
};

type Preflight = {
  ready: boolean;
  store: 'object-storage' | 'filesystem';
  storeRequested: 'auto' | 's3' | 'filesystem';
  keySource: 'DATA_ENC_KEY' | 'FILE_URL_SIGNING_SECRET' | 'BACKUP_KEY_FILE' | 'missing';
  artifactDir: string;
  artifactDirWritable: boolean;
  s3Configured: boolean;
  liveTables: number;
  estimatedRows: number;
  maxRows: number;
  maxBytes: number;
  checks: PreflightCheck[];
  computedAt: string;
};

type RestoreTable = {
  table: string;
  rows: number;
  inserted: number;
  skipped: number;
  failed: number;
  wouldInsert: number;
  error: string | null;
};

type RestoreRow = {
  id: string;
  jobId: string;
  mode: 'dry_run' | 'apply';
  status: 'dry_run' | 'succeeded' | 'partial' | 'failed';
  verdict: 'ready' | 'applied' | 'partial' | 'failed' | 'drifted' | 'unreadable';
  scope: 'platform' | 'tenant';
  checksum: string;
  verified: boolean;
  tables: RestoreTable[];
  totals: { rows: number; inserted: number; skipped: number; failed: number; wouldInsert: number };
  missingTables: string[];
  detail: string | null;
  reason: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  requestedByLabel: string | null;
};

const VERDICT: Record<RestoreRow['verdict'], { label: string; className: string }> = {
  ready: { label: 'جاهزة للاستعادة', className: 'active' },
  applied: { label: 'استُعيدت', className: 'active' },
  partial: { label: 'استعادة جزئية', className: 'pending' },
  failed: { label: 'فشلت', className: 'failed' },
  drifted: { label: 'انحراف مخطّط', className: 'failed' },
  unreadable: { label: 'ملف غير مقروء', className: 'failed' },
};

const MODE: Record<RestoreRow['mode'], string> = { dry_run: 'تجريبية', apply: 'فعلية' };

function num(value: number): string {
  return value.toLocaleString('en-US');
}

/** لوحة الجاهزية — تُقرأ عند فتح الشاشة، ولا تكتب شيئاً. */
export function ReadinessPanel() {
  const preflight = useQuery<Preflight>(() => apiData<Preflight>('/platform/backups/preflight'), []);

  if (preflight.status === 'loading') {
    return (
      <Panel title="جاهزية النسخ">
        <p className="muted small">تفحص المفتاح والمجلد والمخزن…</p>
      </Panel>
    );
  }
  if (preflight.status !== 'success' || !preflight.data) {
    return (
      <Panel title="جاهزية النسخ">
        <p className="danger small">تعذّر الفحص المسبق: {preflight.error ?? 'استجابة غير متوقعة'}</p>
      </Panel>
    );
  }

  const data = preflight.data;
  return (
    <Panel
      title="جاهزية النسخ"
      actions={
        <span className={`badge ${data.ready ? 'active' : 'failed'}`}>
          {data.ready ? 'جاهزة للتشغيل' : 'تحتاج ضبطاً'}
        </span>
      }
    >
      <ul className="backup-checks">
        {data.checks.map((check) => (
          <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
            {check.ok ? <CheckCircle2 size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
            <div>
              <strong>{check.label}</strong>
              <span className="muted small">{check.detail}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        المخزن الفعلي: {data.store === 'object-storage' ? 'تخزين الكائنات (S3)' : 'نظام ملفات الخادم'} · المفتاح:{' '}
        {data.keySource === 'missing' ? 'غائب' : data.keySource} · المجلد: <span dir="ltr">{data.artifactDir}</span> ·{' '}
        السقف: {num(data.maxRows)} صفاً / {Math.round(data.maxBytes / 1024 / 1024)} م.ب
      </p>
    </Panel>
  );
}

/**
 * لوحة الاستعادة — تُفتح لنسخةٍ بعينها.
 *
 * `dry_run` افتراضية وتُظهر ما سيدخل دون كتابة. و`apply` تحتاج أول 12 محرفاً من بصمة
 * الملف وسبباً من خمسة محارف؛ والنتيجة تُعرض جدولاً بجدولٍ: كم أُدرج، وكم تُخطّي، وكم
 * فشل ولماذا. والوعد المكتوب في اللوحة صريح: **إضافية فقط — لا تدهس صفاً موجوداً**.
 */
export function RestorePanel({
  job,
  onClose,
  onRestored,
}: {
  job: { id: string; checksum: string | null; rows: number; scope: string };
  onClose: () => void;
  onRestored: () => void;
}) {
  const [mode, setMode] = useState<'dry_run' | 'apply'>('dry_run');
  const [confirmChecksum, setConfirmChecksum] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreRow | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const expected = job.checksum?.slice(0, 12) ?? '';
  const ready =
    mode === 'dry_run' || (confirmChecksum.trim() === expected && reason.trim().length >= 5);

  async function run() {
    setBusy(true);
    setError(undefined);
    try {
      const restored = await apiData<RestoreRow>(`/platform/backups/${job.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          ...(mode === 'apply' ? { confirmChecksum: confirmChecksum.trim(), reason: reason.trim() } : {}),
        }),
      });
      setResult(restored);
      if (mode === 'apply') onRestored();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذّرت الاستعادة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={`استعادة نسخة ${job.id.slice(0, 8)}…`}
      actions={
        <button className="btn small" type="button" onClick={onClose}>
          إغلاق
        </button>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        الاستعادة <strong>إضافية</strong>: تُدرج الصفوف الغائبة وتتخطّى الموجودة (`ON CONFLICT DO NOTHING`)، ولا
        تحذف شيئاً ولا تستبدل صفاً. البصمة: <span dir="ltr">{expected || '—'}</span> · صفوف الملف:{' '}
        {num(job.rows)}
      </p>

      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label className="field" style={{ minWidth: 190 }}>
          <span>الوضع</span>
          <select
            className="input"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as 'dry_run' | 'apply');
              setResult(undefined);
            }}
          >
            <option value="dry_run">تجريبية — تعدّ ولا تكتب</option>
            <option value="apply">فعلية — تُدرج الآن</option>
          </select>
        </label>
        {mode === 'apply' && (
          <>
            <label className="field" style={{ minWidth: 210 }}>
              <span>اكتب أول 12 من البصمة</span>
              <input
                className="input"
                dir="ltr"
                value={confirmChecksum}
                onChange={(event) => setConfirmChecksum(event.target.value)}
                placeholder={expected}
              />
            </label>
            <label className="field" style={{ minWidth: 300, flex: 1 }}>
              <span>السبب (يُسجَّل في التدقيق)</span>
              <input
                className="input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="مثال: استعادة صفوفٍ حُذفت بعد حادث الخادم"
              />
            </label>
          </>
        )}
        <button className="btn primary" type="button" disabled={busy || !ready} onClick={() => void run()}>
          {busy ? 'تنفّذ…' : mode === 'apply' ? 'استعِد الآن' : 'شغّل الاستعادة التجريبية'}
        </button>
      </div>

      {error && <div className="alert danger" style={{ marginTop: 10 }}>{error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <span className={`badge ${VERDICT[result.verdict].className}`}>{VERDICT[result.verdict].label}</span>
            <span className="small">
              {MODE[result.mode]} · {num(result.totals.rows)} صفاً في الملف ·{' '}
              <strong>{num(result.totals.inserted)}</strong> أُدرج ·{' '}
              <strong>{num(result.totals.skipped)}</strong> تُخطّي ·{' '}
              <strong className={result.totals.failed > 0 ? 'danger' : ''}>{num(result.totals.failed)}</strong> فشل
            </span>
            {result.durationMs !== null && <span className="muted small">{num(result.durationMs)} م.ث</span>}
          </div>
          {result.detail && <p className="small" style={{ margin: '8px 0' }}>{result.detail}</p>}
          {result.missingTables.length > 0 && (
            <p className="danger small">
              جداول في الملف لم تعد في القاعدة: <span dir="ltr">{result.missingTables.join(', ')}</span>
            </p>
          )}

          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الجدول</th>
                  <th className="num">صفوف</th>
                  <th className="num">أُدرج</th>
                  <th className="num">تُخطّي</th>
                  <th className="num">فشل</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {result.tables
                  .filter((table) => table.rows > 0)
                  .sort((a, b) => b.inserted + b.failed - (a.inserted + a.failed) || b.rows - a.rows)
                  .map((table) => (
                    <tr key={table.table}>
                      <td dir="ltr">{table.table}</td>
                      <td className="num">{num(table.rows)}</td>
                      <td className="num">{num(table.inserted)}</td>
                      <td className="num">{num(table.skipped)}</td>
                      <td className={`num ${table.failed > 0 ? 'danger' : ''}`}>{num(table.failed)}</td>
                      <td className="muted small" title={table.error ?? undefined}>
                        {table.error ? table.error.slice(0, 70) : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** سجلّ محاولات الاستعادة — يُقرأ من القاعدة لا من الذاكرة. */
export function RestoreHistory({ reloadKey }: { reloadKey: number }) {
  const history = useQuery<RestoreRow[]>(
    () => apiData<RestoreRow[]>('/platform/backups/restores?limit=10'),
    [reloadKey],
  );
  const rows = Array.isArray(history.data) ? history.data : [];

  if (history.status === 'loading' && rows.length === 0) return null;
  if (rows.length === 0) {
    return (
      <Panel title="سجلّ الاستعادة">
        <p className="muted small" style={{ margin: 0 }}>
          لم تُجرَّب استعادة بعد. جرّب واحدةً تجريبية — تقرأ الملف وتعدّ ولا تكتب.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="سجلّ الاستعادة" actions={<span className="muted small">{rows.length} محاولة</span>}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>الوقت</th>
              <th>الوضع</th>
              <th>الحكم</th>
              <th className="num">صفوف</th>
              <th className="num">أُدرج</th>
              <th className="num">تُخطّي</th>
              <th className="num">فشل</th>
              <th>نفّذها</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td dir="ltr" className="small">
                  {new Date(row.startedAt).toLocaleString('en-GB-u-ca-gregory-nu-latn', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
                <td className="small">{MODE[row.mode]}</td>
                <td>
                  <span className={`badge ${VERDICT[row.verdict].className}`}>{VERDICT[row.verdict].label}</span>
                </td>
                <td className="num">{num(row.totals.rows)}</td>
                <td className="num">{num(row.totals.inserted)}</td>
                <td className="num">{num(row.totals.skipped)}</td>
                <td className={`num ${row.totals.failed > 0 ? 'danger' : ''}`}>{num(row.totals.failed)}</td>
                <td className="small">{row.requestedByLabel ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        كل محاولة — تجريبية أو فعلية — صفٌّ في `backup_restores` وفعلٌ في سجلّ التدقيق. الحذف غير وارد: السجلّ
        يشهد بما جرى.
      </p>
    </Panel>
  );
}

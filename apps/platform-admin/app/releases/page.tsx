'use client';

import type { PlatformRelease, PlatformReleaseList } from '@erp/contracts';
import { Panel } from '@erp/ui';
import { Archive, CheckCircle2, RotateCcw, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { useState } from 'react';

import { ErrorBox, Forbidden, Screen } from '../../components/screen';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Table, type Column } from '../../components/ui/table';
import { apiData } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * 🗜️ تحديثات المنصة — البند «ZIP update».
 *
 * الشاشة تعرض ما يفعله الخادم فعلاً، لا أكثر: الحزمة تُرفع، تُقاس (بصمة/حجم/عدد ملفّات)،
 * ثم إمّا تُقبل فتُسجَّل، أو تُرفض فيُسجَّل الرفض بسببه. **ولا شيء يُنفَّذ**: الخادم لا
 * يفكّ الأرشيف على القرص ولا يستورد منه شيفرة — ولهذا تقول الشاشة ذلك في موضع الرفع نفسه،
 * لا في هامش.
 *
 * والإعلان فعلٌ منفصل: الحزمة المقبولة **لا تصير ما يراه المستأجرون** إلا بضغطة «اعلن»،
 * لأن رفع حزمةِ الليل للتجربة ليس قراراً بأن يراها كل عميل. والسحب يُعيد آخر إصدارٍ
 * مقبولٍ على القناة نفسها، فلا تبقى المنصة تشير إلى إصدارٍ سُحب.
 */

const STATUS_LABELS: Record<PlatformRelease['status'], string> = {
  accepted: 'مقبولة',
  rejected: 'مرفوضة',
  revoked: 'مسحوبة',
};

const STATUS_TONES: Record<PlatformRelease['status'], BadgeTone> = {
  accepted: 'green',
  rejected: 'red',
  revoked: 'amber',
};

const CHANNEL_LABELS: Record<PlatformRelease['channel'], string> = {
  stable: 'مستقرّة',
  beta: 'تجريبية',
};

function bytes(value: number): string {
  if (value < 1024) return `${value} بايت`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ك.ب`;
  return `${(value / (1024 * 1024)).toFixed(2)} م.ب`;
}

function when(value: string): string {
  return new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export default function ReleasesPage() {
  const releases = useQuery<PlatformReleaseList>(() => apiData<PlatformReleaseList>('/platform/releases'), []);

  const [filename, setFilename] = useState('');
  const [contentBase64, setContentBase64] = useState('');
  const [checksum, setChecksum] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const rows = releases.data?.releases ?? [];
  const current = releases.data?.current ?? null;

  const upload = async (): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiData<PlatformRelease>('/platform/releases', {
        method: 'POST',
        body: JSON.stringify({
          filename,
          contentBase64,
          ...(checksum ? { checksum } : {}),
          reason,
        }),
      });
      setNotice({
        kind: 'ok',
        text: `قُبلت الحزمة ${created.version ?? ''} — ${bytes(created.bytes)} و${created.files.length} ملفّاً، وبصمتها ${created.checksum.slice(0, 12)}…`,
      });
      setFilename('');
      setContentBase64('');
      setChecksum('');
      setReason('');
      releases.reload();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const act = async (release: PlatformRelease, action: 'promote' | 'revoke', why: string): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiData<PlatformRelease>(`/platform/releases/${release.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: why }),
      });
      setNotice({
        kind: 'ok',
        text:
          action === 'promote'
            ? `أُعلن الإصدار ${release.version ?? ''} — يراه الآن كل مستأجر.`
            : `سُحب الإصدار ${release.version ?? ''} — أُعيد آخر إصدارٍ مقبول على قناته.`,
      });
      releases.reload();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<Column<PlatformRelease>> = [
    {
      key: 'version',
      header: 'الإصدار',
      width: 150,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-mono text-[12.5px]" dir="ltr">
            {row.version ?? '—'}
          </span>
          <span className="text-[11px] text-muted">{CHANNEL_LABELS[row.channel]}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      width: 110,
      cell: (row) => (
        <Badge tone={STATUS_TONES[row.status]} dot>
          {STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'current',
      header: 'المعروض',
      width: 90,
      cell: (row) =>
        row.isCurrent ? (
          <Badge tone="green">حالي</Badge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'measure',
      header: 'القياس',
      width: 190,
      cell: (row) => (
        <span className="flex flex-col text-[11.5px] text-muted">
          <span dir="ltr" className="font-mono text-[11px]">
            {row.checksum.slice(0, 12)}…
          </span>
          <span>
            {bytes(row.bytes)} · {row.entries} مدخل
          </span>
          <span>
            {row.checksumVerified ? 'بصمة معلنة ومطابقة' : 'بلا بصمة معلنة'} ·{' '}
            {row.rejectionCode ? 'مرفوضة' : 'لم يُنفَّذ منها شيء'}
          </span>
        </span>
      ),
    },
    {
      key: 'notes',
      header: 'ما الجديد',
      grow: true,
      cell: (row) =>
        row.status === 'rejected' ? (
          <span className="text-[12px] text-danger-ink">{row.rejectedReason ?? 'مرفوضة'}</span>
        ) : (
          <span className="flex flex-col">
            <span className="text-[12.5px]">{row.notes || '—'}</span>
            {row.highlights.length > 0 ? (
              <span className="text-[11px] text-muted">{row.highlights.join(' · ')}</span>
            ) : null}
          </span>
        ),
    },
    {
      key: 'when',
      header: 'رُفعت',
      width: 150,
      cell: (row) => (
        <span className="whitespace-nowrap text-[11.5px] text-muted">{when(row.uploadedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 160,
      hideOnPrint: true,
      cell: (row) => (
        <span className="flex gap-1.5">
          {row.status === 'accepted' && !row.isCurrent ? (
            <Button
              variant="secondary"
              disabled={busy}
              icon={<CheckCircle2 size={13} />}
              onClick={() => void act(row, 'promote', 'إعلان الإصدار للمستأجرين من لوحة المنصة')}
            >
              اعلن
            </Button>
          ) : null}
          {row.status === 'accepted' && row.isCurrent ? (
            <Button
              variant="secondary"
              disabled={busy}
              icon={<RotateCcw size={13} />}
              onClick={() => void act(row, 'revoke', 'سحب الإصدار المعروض من لوحة المنصة')}
            >
              اسحب
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Screen
      title="تحديثات المنصة"
      subtitle="حزمة إصدارٍ (ZIP) تُرفع وتُقاس ثم تُعلن: الخادم يفحص بنية الأرشيف وبيانه وبصمته — ولا يفكّ ضغطه إلى القرص ولا ينفّذ منه سطراً."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <Button variant="secondary" icon={<Archive size={14} />} onClick={releases.reload}>
          تحديث
        </Button>
      }
      kpis={[
        {
          label: 'الإصدار المعروض',
          value: current?.version ?? '—',
          icon: <CheckCircle2 size={14} />,
          hint: current ? `قناة ${CHANNEL_LABELS[current.channel]} · ${when(current.uploadedAt)}` : 'لا إصدار معلَن',
        },
        {
          label: 'حزم مقبولة',
          value: rows.filter((row) => row.status === 'accepted').length,
          icon: <Archive size={14} />,
          hint: 'في السجلّ',
        },
        {
          label: 'حزم مرفوضة',
          value: rows.filter((row) => row.status === 'rejected').length,
          icon: <ShieldAlert size={14} />,
          tone: rows.some((row) => row.status === 'rejected') ? 'warn' : 'neutral',
          hint: 'كل محاولةٍ محفوظة بسببها',
        },
      ]}
    >
      {notice ? (
        <div className={notice.kind === 'ok' ? 'ui-notice ok' : 'ui-notice danger'} role="status">
          {notice.text}
        </div>
      ) : null}

      <Panel title="رفع حزمة إصدار" hint="يفحص الخادم الأرشيف قبل قبوله: مسارٌ هارب أو ملفٌّ تنفيذي أو أرشيفٌ مشفّر = رفضٌ مسجَّل.">
        <div className="form-grid">
          <label className="field">
            <span>اسم الملف</span>
            <input
              className="input"
              dir="ltr"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="erp-release-2026.10.2.zip"
            />
          </label>
          <label className="field">
            <span>بصمة sha256 (اختياري)</span>
            <input
              className="input"
              dir="ltr"
              value={checksum}
              onChange={(event) => setChecksum(event.target.value)}
              placeholder="64 حرفاً سادس عشرياً"
            />
          </label>
          <label className="field wide">
            <span>سبب الرفع</span>
            <input
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="نشر إصلاح الضريبة على المرتجعات بعد مراجعته"
            />
          </label>
          <label className="field wide">
            <span>محتوى الحزمة (base64)</span>
            <textarea
              className="input"
              dir="ltr"
              rows={4}
              value={contentBase64}
              onChange={(event) => setContentBase64(event.target.value)}
              placeholder="UEsDBBQABgAIAAAAIQ…"
            />
            <span className="small muted">
              الحافة تقبل أجساماً حتى ميغابايت واحد، فالحزمة العملية هنا ≈750 ك.ب. والأرشيف لا
              يُحفظ عندنا: تُحفظ بصمته وحجمه وأسماء ملفاته وقراره.
            </span>
          </label>
        </div>
        <div className="ui-form-actions">
          <span className="ui-form-actions-note">
            لا شيفرة من الحزمة تُنفَّذ ولا تُستورد — الفحص بلا فكّ ضغطٍ إلا لملفّ البيان.
          </span>
          <div className="ui-form-actions-buttons">
            <Button
              icon={<Upload size={14} />}
              disabled={busy || !filename || !contentBase64 || reason.trim().length < 5}
              onClick={() => void upload()}
            >
              ارفع
            </Button>
          </div>
        </div>
      </Panel>

      {releases.status === 'loading' && (
        <Panel>
          <Table columns={columns} rows={[]} rowKey={(row) => row.id} loading skeletonRows={5} />
        </Panel>
      )}
      {releases.status === 'forbidden' && <Forbidden />}
      {releases.status === 'error' && <ErrorBox message={releases.error} onRetry={releases.reload} />}
      {releases.status === 'success' && (
        <Panel
          title="سجلّ الإصدارات"
          hint="المرفوضة تبقى كما المقبولة: «هل حاوَل أحدٌ نشر ملفٍّ تنفيذي؟» سؤالٌ يُجاب بالسجلّ لا بالحذف."
          className="tight"
        >
          <Table
            bare
            dense
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            pageSize={20}
            empty={
              <span className="flex items-center gap-2 text-muted">
                <XCircle size={14} /> لم تُرفع حزمة تحديثٍ بعد — والمنصة تعمل بلا إصدارٍ معلَن حتى أول حزمة.
              </span>
            }
          />
        </Panel>
      )}
    </Screen>
  );
}

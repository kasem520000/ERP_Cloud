'use client';

import { useState } from 'react';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { ApiError, apiData, apiPost } from '../../lib/api';
import { useQuery } from '../../lib/use-query';
import { dateText } from '../../lib/format';

/**
 * المتابعة والتحصيل — شاشة يطلبها P-C4 («dunning screen: attempts · schedule · messages»).
 *
 * ثلاث طبقات في صفحة واحدة، وكلٌّ منها تقرأ حقيقةً لا وعداً:
 *
 * 1. **الجدول** (`schedule`) — كل فاتورة متأخّرة، ودورها في السلّم، وتاريخ محاولتها القادمة.
 *    الأيام تأتي من إعداد المنصة (`billing.dunning_days`: 0 · 3 · 7)، والسقف من العقود
 *    (`PLATFORM_DUNNING_MAX_ATTEMPTS` = 3) — فما يعرضه الزرّ هو ما سيفعله.
 * 2. **المحاولات** (`attempts`) — ما جرى فعلاً: الرقم والقناة والحالة والوقت.
 * 3. **الرسائل** (`messages`) — نصّ كل محاولة كما سيُرسل.
 *
 * وحدودٌ مقصودة تُعلَن في الشاشة لا تُسكَت: لا خدمة بريد بعد (P-C6)، فالمحاولة تُسجَّل
 * `مجدولة` وتظهر في الجدول بتاريخها؛ والقناة اليدوية وحدها تُسجَّل `أُرسلت` لأن مشغّلاً
 * أجرى الاتّصال بنفسه. أمّا استحقاق الفواتير فيقرأه زرّ التشغيل من `due_date` لا من تخمين.
 */

type Channel = 'email' | 'sms' | 'manual';
type AttemptStatus = 'scheduled' | 'sent' | 'failed' | 'skipped';

type Attempt = {
  id: string;
  subscriptionId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  attemptNo: number;
  channel: Channel;
  status: AttemptStatus;
  scheduledAt: string;
  sentAt: string | null;
  message: string;
  outcome: string | null;
};

type ScheduleRow = {
  invoiceId: string;
  invoiceNumber: string | null;
  subscriptionId: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  dueDate: string | null;
  daysOverdue: number;
  remaining: string;
  currency: string;
  attemptsMade: number;
  nextAttemptNo: number;
  nextAttemptAt: string | null;
  exhausted: boolean;
};

type Board = {
  attempts: Attempt[];
  schedule: ScheduleRow[];
  ladderDays: number[];
  maxAttempts: number;
  currency: string;
};

type RunResult = {
  subscriptionId: string;
  subscriptionStatus: string;
  created: Attempt[];
  skipped: Array<{ invoiceId: string; reason: string }>;
};

const CHANNEL_LABEL: Record<Channel, string> = { email: 'بريد', sms: 'رسالة نصية', manual: 'اتصال يدوي' };
const STATUS_LABEL: Record<AttemptStatus, string> = {
  scheduled: 'مجدولة',
  sent: 'أُرسلت',
  failed: 'فشلت',
  skipped: 'متجاوَزة',
};

export default function DunningPage() {
  const board = useQuery<Board>(() => apiData<Board>('/platform/dunning'), []);
  const [channel, setChannel] = useState<Channel>('email');
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busyFor, setBusyFor] = useState<string>();

  async function run(row: ScheduleRow) {
    setBusyFor(row.subscriptionId);
    setMessage(undefined);
    try {
      const result = await apiPost<RunResult>(`/platform/dunning/${row.subscriptionId}/run`, {
        channel,
        invoiceId: row.invoiceId,
        reason: `متابعة الفاتورة ${row.invoiceNumber ?? ''}`.trim(),
      });
      setMessage({
        kind: 'ok',
        text:
          result.created.length === 0
            ? 'لم تُنشأ محاولة: لا فاتورة متأخّرة في هذه اللحظة.'
            : `أُجريت ${result.created.length} محاولة (${STATUS_LABEL[result.created[0]!.status]})، وحالة الترخيص الآن «${result.subscriptionStatus}».`,
      });
      board.reload();
    } catch (error) {
      setMessage({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusyFor(undefined);
    }
  }

  const data = board.data;
  const schedule = data?.schedule ?? [];
  const attempts = data?.attempts ?? [];

  const scheduleColumns: Array<Column<ScheduleRow>> = [
    { key: 'invoice', header: 'الفاتورة', ltr: true, cell: (row) => row.invoiceNumber ?? '—' },
    {
      key: 'tenant',
      header: 'العميل',
      grow: true,
      cell: (row) => (
        <>
          <strong>{row.tenantName}</strong>
          <div className="muted small" dir="ltr">
            {row.tenantCode}
          </div>
        </>
      ),
    },
    { key: 'due', header: 'الاستحقاق', ltr: true, cell: (row) => dateText(row.dueDate) },
    { key: 'overdue', header: 'التأخير', numeric: true, cell: (row) => `${row.daysOverdue} يوماً` },
    {
      key: 'remaining',
      header: 'المتبقّي',
      numeric: true,
      cell: (row) =>
        `${Number(row.remaining).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { minimumFractionDigits: 2 })} ${row.currency}`,
    },
    {
      key: 'attempts',
      header: 'المحاولات',
      numeric: true,
      cell: (row) => `${row.attemptsMade} / ${data?.maxAttempts ?? '—'}`,
    },
    {
      key: 'next',
      header: 'القادمة',
      cell: (row) =>
        row.exhausted ? (
          <span className="badge failed">استُنفدت المحاولات</span>
        ) : (
          <>
            <span className="badge pending">المحاولة {row.nextAttemptNo}</span>
            <div className="muted small" dir="ltr">
              {dateText(row.nextAttemptAt)}
            </div>
          </>
        ),
    },
    {
      key: 'action',
      header: '',
      cell: (row) => (
        <button
          className="btn sm"
          type="button"
          disabled={busyFor === row.subscriptionId}
          onClick={() => void run(row)}
        >
          {busyFor === row.subscriptionId ? 'جارٍ…' : 'متابعة'}
        </button>
      ),
    },
  ];

  const attemptColumns: Array<Column<Attempt>> = [
    { key: 'no', header: '#', numeric: true, cell: (attempt) => attempt.attemptNo },
    { key: 'invoice', header: 'الفاتورة', ltr: true, cell: (attempt) => attempt.invoiceNumber ?? '—' },
    { key: 'tenant', header: 'العميل', cell: (attempt) => attempt.tenantName },
    { key: 'channel', header: 'القناة', cell: (attempt) => CHANNEL_LABEL[attempt.channel] },
    {
      key: 'status',
      header: 'الحالة',
      cell: (attempt) => (
        <>
          <span className={`badge ${attempt.status}`}>{STATUS_LABEL[attempt.status]}</span>
          {attempt.outcome && <div className="muted small">{attempt.outcome}</div>}
        </>
      ),
    },
    {
      key: 'when',
      header: 'التاريخ',
      ltr: true,
      cell: (attempt) => dateText(attempt.sentAt ?? attempt.scheduledAt),
    },
    {
      key: 'message',
      header: 'الرسالة',
      cell: (attempt) => <span className="small">{attempt.message}</span>,
    },
  ];

  return (
    <Screen
      title="المتابعة والتحصيل"
      subtitle="من تأخّر عن السداد، وما أُرسل له، وما سيُرسل غداً — الفواتير المتأخّرة لا تُترك للذاكرة."
      crumbs={['المنصة', 'العملاء والتراخيص']}
      actions={
        <>
          <select
            className="input"
            style={{ maxWidth: 150 }}
            value={channel}
            onChange={(event) => setChannel(event.target.value as Channel)}
          >
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((key) => (
              <option key={key} value={key}>
                {CHANNEL_LABEL[key]}
              </option>
            ))}
          </select>
          <button className="btn" type="button" onClick={board.reload}>
            تحديث
          </button>
        </>
      }
    >
      {message && <p className={`alert ${message.kind}`}>{message.text}</p>}
      {board.status === 'loading' && <Loading />}
      {board.status === 'error' && <ErrorBox message={board.error} onRetry={board.reload} />}

      {board.status === 'success' && data && (
        <>
          <Panel>
            <dl className="kv">
              <dt>السلّم</dt>
              <dd dir="ltr">{data.ladderDays.join(' · ')} يوم بعد الاستحقاق</dd>
              <dt>سقف المحاولات</dt>
              <dd>{data.maxAttempts}</dd>
              <dt>فواتير متأخّرة</dt>
              <dd>{schedule.length}</dd>
              <dt>محاولات مسجَّلة</dt>
              <dd>{attempts.length}</dd>
            </dl>
            <p className="muted small" style={{ marginBottom: 0 }}>
              المحاولة تُسجَّل «مجدولة» عند إنشائها — لا خدمة بريد بعد (P-C6)، ولا ندّعي إرسالاً لم يقع.
              واختيار «اتصال يدوي» يسجّلها «أُرسلت» لأن من أجراها مشغّل.
            </p>
          </Panel>

          <Panel title="الجدول — ما سيُنفَّذ" flush>
            {schedule.length === 0 ? (
              <Empty title="لا فاتورة متأخّرة" detail="كل فاتورة صادرة إمّا مدفوعة أو لم يحن استحقاقها." />
            ) : (
              <Table bare columns={scheduleColumns} rows={schedule} rowKey={(row) => row.invoiceId} />
            )}
          </Panel>

          <Panel title="المحاولات والرسائل" flush>
            {attempts.length === 0 ? (
              <Empty title="لا محاولات بعد" detail="شغّل المتابعة من الجدول أعلاه." />
            ) : (
              <Table bare columns={attemptColumns} rows={attempts} rowKey={(attempt) => attempt.id} />
            )}
          </Panel>
        </>
      )}
    </Screen>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ticketPriorities,
  ticketStatuses,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
} from '@erp/contracts';

import { ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { ApiError, apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';

/**
 * تذكرةٌ واحدة — «ماذا قال العميل، وماذا قيل له» (P-C8).
 *
 * شاشةٌ واحدة تعرض الرسائل بترتيبها الزمني، والملاحظة الداخلية عليها وسمٌ ظاهر (فلا
 * يقرأها المشغّل على أنها رسالةٌ وصلت العميل)، والردّ إمّا عامٌّ يوقف عدّاد الاستجابة أو
 * ملاحظةٌ لا توقفه. والانتقالات محدودة بما يسمح به الـAPI: المغلقة لا تُفتح، والمغلقة لا
 * تُردّ عليها.
 */

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'مفتوحة',
  pending: 'بانتظار العميل',
  resolved: 'محلولة',
  closed: 'مغلقة',
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
};

/**
 * «ردود جاهزة» (الخطة §4): نصوصٌ قصيرة يبدأ منها المشغّل ثم يخصّصها. محتوى واجهةٍ بحت —
 * لا يُملي على العميل شيئاً، وكلٌّ منها يبقى قابلاً للتعديل قبل الإرسال.
 */
const CANNED_REPLIES: ReadonlyArray<{ id: string; label: string; body: string }> = [
  {
    id: 'received',
    label: 'استلمنا الطلب',
    body: 'وصلنا طلبك وفتحنا له تذكرة. سنوافيك بالنتيجة بعد المراجعة، ونعتذر عن أي إزعاج.',
  },
  {
    id: 'need_info',
    label: 'نحتاج تفصيلاً',
    body: 'لإتمام المراجعة نحتاج: رقم المستند، ووقت المحاولة، ونصّ الخطأ كما ظهر. يمكنك الردّ على هذه الرسالة مباشرةً.',
  },
  {
    id: 'fixed',
    label: 'تحقق من الحل',
    body: 'بعد التحقق من السبب والإجراء الذي اتخذناه، جرّب إعادة المحاولة وأخبرنا بالنتيجة. عدّل هذه الرسالة لتذكر ما تم فعلاً قبل إرسالها.',
  },
  {
    id: 'closing',
    label: 'متابعة قبل الإغلاق',
    body: 'لم نتلقّ رداً خلال المتابعة. إذا استمرت المشكلة فأخبرنا بالتفاصيل قبل إغلاق هذه التذكرة؛ ويمكنك فتح طلب جديد لاحقاً.',
  },
];

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError && error.isForbidden) return 'تحتاج صلاحية إدارة الدعم لهذا الإجراء.';
  return arabicErrorText(error, 'تعذّر تحديث التذكرة. راجع البيانات ثم أعد المحاولة.');
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const ticket = useQuery<TicketDetail>(() => apiData<TicketDetail>(`/platform/tickets/${id}`), [id]);

  return (
    <Screen
      title={ticket.data?.subject ?? 'تذكرة'}
      subtitle="راجع محادثة العميل وملاحظات الفريق قبل إعداد رد أو تغيير حالة البلاغ."
      crumbs={['الدعم', 'التذاكر']}
      actions={
        <Link className="btn" href="/tickets">
          عودة إلى الصندوق
        </Link>
      }
    >
      {ticket.status === 'loading' && <Loading rows={3} />}
      {ticket.status === 'forbidden' && <Forbidden />}
      {ticket.status === 'error' && <ErrorBox message={ticket.error} onRetry={ticket.reload} />}
      {ticket.status === 'success' && ticket.data && (
        <TicketBody ticket={ticket.data} onChanged={ticket.reload} />
      )}
    </Screen>
  );
}

function TicketBody({ ticket, onChanged }: { ticket: TicketDetail; onChanged: () => void }) {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [reason, setReason] = useState('');
  const [nextStatus, setNextStatus] = useState<TicketStatus | ''>('');
  const [nextPriority, setNextPriority] = useState<TicketPriority | ''>('');

  const call = useCallback(
    async (path: string, method: 'POST' | 'PATCH', payload: unknown, okText: string) => {
      setBusy(true);
      setNotice(undefined);
      try {
        await apiData<TicketDetail>(path, { method, body: JSON.stringify(payload) });
        setNotice({ kind: 'ok', text: okText });
        onChanged();
        return true;
      } catch (error) {
        setNotice({ kind: 'danger', text: apiMessage(error) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  async function sendReply() {
    if (busy || body.trim().length < 2 || !window.confirm(internal
      ? 'تقييد ملاحظة داخلية للفريق فقط؟ لا تُرسل للعميل ولا توقف عدّاد الاستجابة.'
      : `إرسال رد عام إلى العميل على التذكرة «${ticket.subject}»؟ تأكد من نص الرسالة قبل الإرسال.`)) return;
    const sent = await call(
      `/platform/tickets/${ticket.id}/reply`,
      'POST',
      { body, isInternal: internal, ...(reason.trim() ? { reason } : {}) },
      internal ? 'قُيّدت الملاحظة الداخلية — لا تُرسل إلى العميل.' : 'أُرسل الردّ — توقف عدّاد الاستجابة.',
    );
    if (sent) {
      setBody('');
      setReason('');
    }
  }

  async function changeStatus() {
    if (!nextStatus || busy || ticket.status === 'closed' || !window.confirm(`تغيير حالة «${ticket.subject}» من ${STATUS_LABEL[ticket.status]} إلى ${STATUS_LABEL[nextStatus]}؟ راجع أثر الإغلاق أو الحل قبل التأكيد.`)) return;
    if (await call(`/platform/tickets/${ticket.id}`, 'PATCH', { status: nextStatus, reason: 'تحديث حالة من مكتب الدعم' }, 'حُدّثت الحالة.')) setNextStatus('');
  }

  async function changePriority() {
    if (!nextPriority || busy || ticket.status === 'closed' || !window.confirm(`تغيير أولوية «${ticket.subject}» إلى ${PRIORITY_LABEL[nextPriority]}؟ قد يُعاد حساب مهلة الاستجابة.`)) return;
    if (await call(`/platform/tickets/${ticket.id}`, 'PATCH', { priority: nextPriority, reason: 'تغيير أولوية من مكتب الدعم' }, 'حُدّثت الأولوية وأُعيد حساب المهلة من الآن.')) setNextPriority('');
  }

  async function removeAssignment() {
    if (busy || !window.confirm(`سحب إسناد «${ticket.subject}» من ${ticket.assignedToLabel ?? 'المشغّل الحالي'}؟ ستعود إلى الصندوق دون مكلّف.`)) return;
    await call(`/platform/tickets/${ticket.id}`, 'PATCH', { assignedTo: null, reason: 'سحب الإسناد ليعود إلى الصندوق' }, 'سُحب الإسناد.');
  }

  return (
    <div className="grid">
      <WorkflowGuide title="من قراءة البلاغ إلى تحديثه" steps={[
        { title: 'راجع السياق', detail: 'تحقق من حالة البلاغ والمهلة والملاحظات الداخلية قبل الرد.' },
        { title: 'اختر نوع الرسالة', detail: 'الرد العام يصل للعميل ويوقف مهلة الاستجابة؛ الملاحظة الداخلية تبقى للفريق.' },
        { title: 'أكّد التغيير', detail: 'راجع الأثر قبل إرسال الرسالة أو تغيير الحالة أو الأولوية أو الإسناد.' },
      ]} />
      <ContentPanel title="ملخص التذكرة" description="البيانات والمهلة تأتيان من سجل الخدمة، وليستا توقعاً من الشاشة.">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0 }}>
              <span className={`chip${ticket.status === 'open' ? ' on' : ''}`}>
                {STATUS_LABEL[ticket.status]}
              </span>{' '}
              <span className={`chip${ticket.priority === 'urgent' ? ' on' : ''}`}>
                {PRIORITY_LABEL[ticket.priority]}
              </span>{' '}
              {ticket.category ? <span className="chip">{ticket.category}</span> : null}
            </p>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {ticket.tenantName ?? '—'} ({ticket.tenantCode ?? '—'}) · المكلَّف:{' '}
              {ticket.assignedToLabel ?? 'بلا إسناد'}
            </p>
          </div>
          <div className="muted" style={{ textAlign: 'left' }}>
            <p style={{ margin: 0 }}>فُتحت: {dateTime(ticket.createdAt)}</p>
            <p style={{ margin: 0 }}>المهلة: {dateTime(ticket.slaDueAt)}</p>
            <p style={{ margin: 0 }}>
              أول ردّ: {ticket.firstResponseAt ? dateTime(ticket.firstResponseAt) : 'لم يحدث بعد'}
            </p>
            <p style={{ margin: 0 }}>أُغلقت: {ticket.closedAt ? dateTime(ticket.closedAt) : '—'}</p>
          </div>
        </div>
      </ContentPanel>

      <ContentPanel title="تسلسل المحادثة" description="الملاحظات الداخلية موسومة ولا تُرسل إلى العميل. راجع الترتيب الزمني قبل إعداد الرد.">
        {ticket.messages.length === 0 && <p className="muted">لا رسائل مسجلة لهذه التذكرة بعد.</p>}
        <ul className="thread">
          {ticket.messages.map((message) => (
            <li key={message.id} className={message.isInternal ? 'note' : message.authorKind}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {message.authorKind === 'operator'
                    ? `مشغّل · ${message.authorLabel ?? '—'}`
                    : message.authorKind === 'customer'
                      ? `العميل · ${message.authorLabel ?? '—'}`
                      : 'النظام'}
                  {message.isInternal && <span className="chip on"> ملاحظة داخلية</span>}
                </strong>
                <span className="muted">{dateTime(message.createdAt)}</span>
              </div>
              <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{message.body}</p>
            </li>
          ))}
        </ul>
      </ContentPanel>

      {ticket.status !== 'closed' && (
        <ContentPanel title="إعداد الرسالة" description="استخدم نصاً جاهزاً كنقطة بداية ثم خصّصه. تغيير النوع لا يرسل شيئاً حتى تؤكد.">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {CANNED_REPLIES.map((reply) => (
              <button key={reply.id} className="btn" type="button" onClick={() => setBody(reply.body)}>
                {reply.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>نص الرسالة</span>
            <textarea className="input" rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <p className={`alert ${internal ? 'warn' : 'ok'}`} role="status">
            {internal ? 'مسودة ملاحظة للفريق فقط؛ لا تصل إلى العميل ولا توقف مهلة الاستجابة.' : 'مسودة رد عام؛ قد يصل إلى العميل بعد التأكيد ويوقف مهلة الاستجابة.'}
          </p>
          <div className="row">
            <label className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />
              <span>ملاحظة داخلية (لا تُرسل إلى العميل ولا توقف عدّاد الاستجابة)</span>
            </label>
            <label className="field">
              <span>سبب الإجراء (اختياري)</span>
              <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || body.trim().length < 2}
              onClick={() => void sendReply()}
            >
              {internal ? 'قيّد الملاحظة' : 'أرسل الردّ'}
            </button>
          </div>
        </ContentPanel>
      )}
      {ticket.status === 'closed' && <ContentPanel title="التذكرة مغلقة" description="لا تُرسل ردوداً على تذكرة مغلقة؛ ارجع إلى صندوق الدعم لمراجعة بلاغ جديد." />}

      <ContentPanel title="تحديث حالة التذكرة" description="اختيار حالة أو أولوية لا يغيّرها وحده؛ راجع الخيار ثم أكد تطبيقه.">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field">
            <span>الحالة الجديدة</span>
            <select className="input"
              value={nextStatus}
              disabled={busy || ticket.status === 'closed'}
              onChange={(event) => setNextStatus(event.target.value as TicketStatus | '')}
            >
              <option value="">اختر…</option>
              {ticketStatuses
                .filter(
                  (value) => value !== ticket.status && !(ticket.status === 'closed' && value !== 'closed'),
                )
                .map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABEL[value]}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn" type="button" disabled={!nextStatus || busy || ticket.status === 'closed'} onClick={() => void changeStatus()}>طبّق الحالة</button>
          <label className="field">
            <span>الأولوية الجديدة</span>
            <select className="input"
              value={nextPriority}
              disabled={busy || ticket.status === 'closed'}
              onChange={(event) => setNextPriority(event.target.value as TicketPriority | '')}
            >
              <option value="">اختر…</option>
              {ticketPriorities
                .filter((value) => value !== ticket.priority)
                .map((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABEL[value]}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn" type="button" disabled={!nextPriority || busy || ticket.status === 'closed'} onClick={() => void changePriority()}>طبّق الأولوية</button>
          {ticket.assignedTo && ticket.status !== 'closed' && (
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void removeAssignment()}
            >
              اسحب الإسناد
            </button>
          )}
        </div>
        {notice && (
          <p className={`alert ${notice.kind === 'ok' ? 'ok' : 'danger'}`} role={notice.kind === 'danger' ? 'alert' : 'status'} style={{ margin: 0 }}>
            {notice.text}
          </p>
        )}
      </ContentPanel>
    </div>
  );
}

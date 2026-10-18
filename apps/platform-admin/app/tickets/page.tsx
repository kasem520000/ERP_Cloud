'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ticketOpenStatuses,
  ticketPriorities,
  ticketStatuses,
  type SupportTicket,
  type TicketCreate,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
} from '@erp/contracts';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { Tabs } from '../../components/ui';
import { ApiError, apiData, apiPost } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * التذاكر — مكتب الدعم (P-C8، `docs/roadmap/PLATFORM_CONSOLE_PLAN.md` §4).
 *
 * الصندوق الوارد يجيب عن ثلاثة أسئلة بالترتيب الذي يسألها الدعم فعلاً:
 *
 *   1. **ما الأهمّ الآن؟** — الترتيب في الـAPI أولويةٌ ثم الأحدث، والعمود يعرض المهلة
 *      المتبقية من `slaDueAt` (محسوبة في الخادم لحظة الفتح، لا في الواجهة).
 *   2. **ما لم يُلتقط بعد؟** — مرشّح «بلا إسناد» (`filter[assignedTo]=none`).
 *   3. **ما انتهى وقته؟** — المهلة السالبة تُعلَن بلونٍ ووسم، ولا تُخفى.
 *
 * وتذكرةٌ جديدة تُفتح على المنشأة نفسها: العميل قد يتّصل أو يراسل، والمشغّل هو من يكتب.
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

const SLA_HOURS: Record<TicketPriority, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

/** المتبقّي من المهلة بالدقائق — سالبٌ يعني تجاوزاً. */
function slaMinutesRemaining(ticket: SupportTicket): number | null {
  if (!ticket.slaDueAt || ticket.status === 'resolved' || ticket.status === 'closed') return null;
  return Math.round((new Date(ticket.slaDueAt).getTime() - Date.now()) / 60_000);
}

function slaText(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes <= 0) return `تجاوزت بـ${Math.abs(minutes)} دقيقة`;
  if (minutes < 60) return `باقٍ ${minutes} دقيقة`;
  return `باقٍ ${Math.round(minutes / 60)} ساعة`;
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isForbidden) return 'تحتاج صلاحية إدارة مكتب الدعم لهذا الإجراء.';
    return error.message;
  }
  return arabicErrorText(error, 'تعذّر إتمام الإجراء. تحقق من البيانات وأعد المحاولة.');
}

type TabId = 'inbox' | 'new';

export default function TicketsPage() {
  const [tab, setTab] = useState<TabId>('inbox');

  return (
    <Screen
      title="مكتب الدعم"
      subtitle="ابدأ بما تجاوز مهلة الاستجابة، ثم راجع غير المسند وافتح البلاغات الجديدة دون خلط الردود العامة بالملاحظات الداخلية."
      crumbs={['الدعم']}
      actions={
        <button className="btn" type="button" onClick={() => setTab('new')}>
          تذكرة جديدة
        </button>
      }
    >
      <WorkflowGuide title="من البلاغ إلى الرد" steps={[
        { title: 'حدد الأولوية', detail: 'راجع المهلة وما لم يُسند لمشغّل قبل فتح التفاصيل.' },
        { title: 'سجّل البلاغ', detail: 'اكتب كلام العميل في الرسالة الأولى وسبب الفتح في الحقل الداخلي.' },
        { title: 'تابع المحادثة', detail: 'الرد العام يصل للعميل؛ الملاحظات الداخلية تبقى للفريق.' },
      ]} />
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'inbox', label: 'الصندوق الوارد' },
          { id: 'new', label: 'تذكرة جديدة' },
        ]}
      />
      {tab === 'inbox' && <InboxTab />}
      {tab === 'new' && <NewTicketTab onCreated={() => setTab('inbox')} />}
    </Screen>
  );
}

// ───────────────────────────────────────────────────── الصندوق

function InboxTab() {
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const tickets = useQuery<SupportTicket[]>(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (status) params.set('filter[status]', status);
    if (priority) params.set('filter[priority]', priority);
    if (onlyUnassigned) params.set('filter[assignedTo]', 'none');
    return apiData<SupportTicket[]>(`/platform/tickets?${params.toString()}`);
  }, [status, priority, onlyUnassigned]);

  useEffect(() => {
    const timer = setInterval(() => tickets.reload(), 20_000);
    const onFocus = () => tickets.reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [tickets.reload]);

  return (
    <>
      <ContentPanel title="تصفية الصندوق" description="المرشحات تغير عرض التذاكر فقط؛ لا تُعدّل حالتها أو إسنادها.">
      <div className="toolbar">
        <label>
          الحالة
          <select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus | '')}>
            <option value="">الكل</option>
            {ticketStatuses.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          الأولوية
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TicketPriority | '')}
          >
            <option value="">الكل</option>
            {ticketPriorities.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={(event) => setOnlyUnassigned(event.target.checked)}
          />
          <span>بلا إسناد</span>
        </label>
        <button className="btn" type="button" onClick={tickets.reload}>تحديث القائمة</button>
      </div>
      </ContentPanel>

      <ContentPanel title={`قائمة التذاكر (${tickets.status === 'success' ? tickets.data?.length ?? 0 : '—'})`} description="تُحسب المهلة وقت العرض؛ افتح التذكرة لمراجعة الرسائل والإسناد.">
        {tickets.status === 'loading' && <Loading rows={3} />}
        {tickets.status === 'forbidden' && <Forbidden />}
        {tickets.status === 'error' && <ErrorBox message={tickets.error} onRetry={tickets.reload} />}
        {tickets.status === 'success' && (tickets.data?.length ?? 0) === 0 && (
          <Empty
            title="لا تذاكر مطابقة"
            detail={
              ticketOpenStatuses.includes(status as TicketStatus)
                ? 'لا تذكرة مفتوحة بهذا المرشّح الآن.'
                : 'جرّب توسيع المرشّح، أو افتح تذكرة جديدة.'
            }
          />
        )}
        {tickets.status === 'success' && (tickets.data?.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الموضوع</th>
                  <th>العميل</th>
                  <th>الحالة</th>
                  <th>الأولوية</th>
                  <th>المهلة</th>
                  <th>المكلَّف</th>
                  <th>الرسائل</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(tickets.data ?? []).map((ticket) => {
                  const remaining = slaMinutesRemaining(ticket);
                  return (
                    <tr key={ticket.id}>
                      <td>
                        <strong>{ticket.subject}</strong>
                        <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                          {ticket.category ?? 'بلا بابٍ محدّد'}
                        </p>
                      </td>
                      <td>
                        {ticket.tenantName ?? '—'}
                        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                          {ticket.tenantCode ?? ''}
                        </p>
                      </td>
                      <td>
                        <span className={`chip${ticket.status === 'open' ? ' on' : ''}`}>
                          {STATUS_LABEL[ticket.status]}
                        </span>
                      </td>
                      <td>
                        <span className={`chip${ticket.priority === 'urgent' ? ' on' : ''}`}>
                          {PRIORITY_LABEL[ticket.priority]}
                        </span>
                        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                          مهلة {SLA_HOURS[ticket.priority]} ساعة
                        </p>
                      </td>
                      <td className={remaining !== null && remaining <= 0 ? 'danger-text' : undefined}>
                        {slaText(remaining)}
                        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                          {ticket.firstResponseAt
                            ? `أول ردّ: ${dateTime(ticket.firstResponseAt)}`
                            : 'بلا ردٍّ بعد'}
                        </p>
                      </td>
                      <td>{ticket.assignedToLabel ?? 'بلا إسناد'}</td>
                      <td>{ticket.messageCount}</td>
                      <td>
                        <Link className="btn" href={`/tickets/${ticket.id}`}>
                          فتح
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ContentPanel>
    </>
  );
}

// ───────────────────────────────────────────────────── فتح تذكرة

function NewTicketTab({ onCreated }: { onCreated: () => void }) {
  const tenants = useQuery<Array<{ id: string; code: string; name: string }>>(
    () => apiData<Array<{ id: string; code: string; name: string }>>('/platform/tenants?limit=100'),
    [],
  );

  const [tenantId, setTenantId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<TicketDetail | null>(null);

  async function submit() {
    setBusy(true);
    setNotice(undefined);
    setCreated(null);
    try {
      const payload: TicketCreate = {
        tenantId,
        subject,
        body,
        priority,
        reason,
        ...(category.trim() ? { category: category.trim() } : {}),
      };
      const ticket = await apiPost<TicketDetail>('/platform/tickets', payload);
      setCreated(ticket);
      setNotice({
        kind: 'ok',
        text: `فُتحت التذكرة «${ticket.subject}» — مهلتها ${SLA_HOURS[ticket.priority]} ساعة.`,
      });
      setSubject('');
      setBody('');
      setCategory('');
      setReason('');
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const ready =
    tenants.status === 'success' && tenantId.length > 0 && subject.trim().length >= 3 && body.trim().length >= 5 && reason.trim().length >= 3;

  return (
    <ContentPanel title="فتح بلاغ للعميل" description="تتبع التذكرة منشأة واحدة؛ اكتب كلام العميل كما ورد، وافصل عنه سبب فتح البلاغ للتدقيق." className="grid">
      {tenants.status === 'loading' && <Loading rows={1} />}
      {tenants.status === 'forbidden' && <Forbidden />}
      {tenants.status === 'error' && <ErrorBox message={tenants.error} onRetry={tenants.reload} />}
      <div className="row">
        <label>
          العميل
          <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">اختر منشأة…</option>
            {(tenants.data ?? []).map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name} ({tenant.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          الأولوية
          <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
            {ticketPriorities.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABEL[value]} · مهلة {SLA_HOURS[value]} ساعة
              </option>
            ))}
          </select>
        </label>
        <label>
          الباب (اختياري)
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="طباعة · فواتير · صلاحيات"
          />
        </label>
      </div>
      <label>
        الموضوع
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label>
        الرسالة الأولى (ما قاله العميل)
        <textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <p className="muted small">الرسالة الأولى جزء من محادثة العميل؛ الحقل التالي ملاحظة تشغيلية داخلية لا تُرسل إليه.</p>
      <label>
        السبب الداخلي
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="مكالمة هاتفية · بريد · زيارة"
        />
      </label>
      <div className="row">
        <button className="btn" type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'جارٍ الفتح…' : 'افتح التذكرة'}
        </button>
        {created && (
          <>
            <Link className="btn" href={`/tickets/${created.id}`}>
              اذهب إلى التذكرة
            </Link>
            <button className="btn" type="button" onClick={onCreated}>
              الصندوق الوارد
            </button>
          </>
        )}
      </div>
      {notice && (
        <p className={`alert ${notice.kind === 'ok' ? 'ok' : 'danger'}`} style={{ margin: 0 }}>
          {notice.text}
        </p>
      )}
    </ContentPanel>
  );
}

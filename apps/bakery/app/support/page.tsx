'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Modal,
  SegmentedTabs,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type TicketRow = Record<string, unknown> & {
  id: string;
  ticketNo?: string;
  subject: string;
  category?: string;
  priority?: string;
  status?: string;
  createdAt?: string;
  messages?: Array<{ id?: string; body: string; authorRole?: string; createdAt?: string }>;
};

type HelpRow = { id?: string; title?: string; summary?: string; body?: string };
type FaqRow = { id?: string; question?: string; answer?: string };

export default function BakerySupportPage() {
  const [tab, setTab] = useState<'tickets' | 'faq' | 'help'>('tickets');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [articles, setArticles] = useState<HelpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('نقاط البيع والمخبز');
  const [priority, setPriority] = useState('normal');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const [activeTicket, setActiveTicket] = useState<TicketRow | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tk, fq, hl] = await Promise.all([
        apiList<TicketRow>('/support/tickets'),
        apiList<FaqRow>('/public/faq').catch(() => []),
        apiList<HelpRow>('/public/help').catch(() => []),
      ]);
      setTickets(tk);
      setFaqs(fq);
      setArticles(hl);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة مركز الدعم الفني'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitTicket = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/support/tickets', {
        subject: subject.trim(),
        category,
        priority,
        body: body.trim(),
      });
      setCreateOpen(false);
      setSubject('');
      setBody('');
      setNotice({ tone: 'ok', text: 'تم إرسال تذكرة الدعم الفني بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إرسال التذكرة') });
    } finally {
      setSaving(false);
    }
  };

  const openTicket = async (id: string) => {
    try {
      const detail = await apiData<TicketRow>(`/support/tickets/${encodeURIComponent(id)}`);
      setActiveTicket(detail);
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر قراءة تفاصيل التذكرة') });
    }
  };

  const sendReply = async () => {
    if (!activeTicket || !replyBody.trim()) return;
    setSaving(true);
    try {
      const updated = await apiPost<TicketRow>(
        `/support/tickets/${encodeURIComponent(activeTicket.id)}/reply`,
        { body: replyBody.trim() },
      );
      setReplyBody('');
      setActiveTicket(updated);
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إرسال الرد') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<TicketRow>[] = [
    { key: 'subject', header: 'الموضوع', cell: (r) => r.subject },
    { key: 'category', header: 'التصنيف', cell: (r) => String(r.category ?? '—') },
    { key: 'priority', header: 'الأولوية', cell: (r) => String(r.priority ?? 'normal') },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'closed' || r.status === 'resolved' ? 'active' : 'pending'}>
          {String(r.status ?? 'open')}
        </Badge>
      ),
    },
    {
      key: 'view',
      header: 'المحادثة',
      cell: (r) => (
        <Button onClick={() => void openTicket(r.id)} size="sm">
          فتح ومتابعة
        </Button>
      ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">مركز المساعدة والدعم الفني</h1>
          <p className="ui-page-sub">تذاكر الدعم الفني المباشرة والأسئلة الشائعة وأدلة تشغيل المخبز والتوزيع.</p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => setCreateOpen(true)} variant="primary">
            + فتح تذكرة دعم
          </Button>
          <Button onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <Badge status={notice.tone === 'ok' ? 'active' : 'rejected'}>{notice.text}</Badge>
            </CardBody>
          </Card>
        ) : null}

        <SegmentedTabs
          onChange={(next) => setTab(next as typeof tab)}
          items={[
            { key: 'tickets', label: `تذاكر المنشأة (${tickets.length})` },
            { key: 'faq', label: `الأسئلة الشائعة (${faqs.length})` },
            { key: 'help', label: `أدلة الاستخدام (${articles.length})` },
          ]}
          value={tab}
        />

        {tab === 'tickets' ? (
          <Card>
            <CardHeader subtitle="تواصل مباشر مع فريق الدعم الفني للمنصة." title="تذاكر الدعم الفني" />
            <CardBody>
              <DataTable
                columns={columns}
                empty="لا تذاكر دعم مفتوحة"
                rows={tickets}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            </CardBody>
          </Card>
        ) : tab === 'faq' ? (
          <div className="grid gap-3">
            {faqs.map((f, i) => (
              <Card key={f.id ?? i}>
                <CardHeader title={f.question ?? 'سؤال شائع'} />
                <CardBody>
                  <p className="m-0 text-[13px] leading-relaxed text-muted">{f.answer ?? ''}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            {articles.map((a, i) => (
              <Card key={a.id ?? i}>
                <CardHeader subtitle={a.summary} title={a.title ?? 'دليل تشغيلي'} />
                <CardBody>
                  <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{a.body ?? ''}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal onClose={() => setCreateOpen(false)} open={createOpen} title="فتح تذكرة دعم فني جديدة">
        <div className="grid gap-3">
          <Input label="موضوع الطلب" onChange={(e) => setSubject(e.target.value)} value={subject} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="التصنيف"
              onChange={(e) => setCategory(e.target.value)}
              options={[
                { value: 'نقاط البيع والمخبز', label: 'نقاط البيع والمخبز' },
                { value: 'توزيع المندوبين والعهد', label: 'توزيع المندوبين والعهد' },
                { value: 'محاسبة وقيود', label: 'محاسبة وقيود' },
                { value: 'الفوترة والطباعة', label: 'الفوترة والطباعة' },
              ]}
              value={category}
            />
            <Select
              label="الأولوية"
              onChange={(e) => setPriority(e.target.value)}
              options={[
                { value: 'normal', label: 'عادية' },
                { value: 'high', label: 'مرتفعة' },
                { value: 'urgent', label: 'عاجلة' },
              ]}
              value={priority}
            />
          </div>
          <Input label="شرح المشكلة أو الاستفسار" onChange={(e) => setBody(e.target.value)} value={body} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !subject.trim() || !body.trim()} onClick={() => void submitTicket()} variant="primary">
              {saving ? 'جارٍ الإرسال…' : 'إرسال التذكرة'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setActiveTicket(null)} open={Boolean(activeTicket)} title={activeTicket?.subject ?? 'محادثة التذكرة'}>
        {activeTicket ? (
          <div className="grid gap-3">
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-line bg-surface-2 p-2.5">
              {(activeTicket.messages ?? []).map((m, idx) => (
                <div className="rounded-lg border border-line bg-surface p-2 text-[12.5px]" key={m.id ?? idx}>
                  <div className="font-bold text-muted">{m.authorRole ?? 'رسالة'}</div>
                  <div className="mt-1 whitespace-pre-wrap">{m.body}</div>
                </div>
              ))}
            </div>
            <Input label="إضافة رد" onChange={(e) => setReplyBody(e.target.value)} value={replyBody} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setActiveTicket(null)} size="sm">
                إغلاق
              </Button>
              <Button disabled={saving || !replyBody.trim()} onClick={() => void sendReply()} variant="primary">
                إرسال الرد
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

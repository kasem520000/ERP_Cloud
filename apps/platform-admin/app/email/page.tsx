'use client';

import { useState } from 'react';
import { ContentPanel, TableViewport, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';
import {
  emailEvents,
  emailEventDefinition,
  emailLocales,
  emailMessageStatuses,
  emailSuppressionReasons,
  type EmailEvent,
  type EmailLocale,
  type EmailMessage,
  type EmailMessageListResponse,
  type EmailSettings,
  type EmailSuppression,
  type EmailTemplate,
  type EmailTemplateListResponse,
  type EmailTestResult,
} from '@erp/contracts';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { SourceTag, Tabs } from '../../components/ui';
import { ApiError, apiData, apiFetch } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * البريد — service console (P-C6، `docs/roadmap/PLATFORM_CONSOLE_PLAN.md` §7).
 *
 * أربعة تبويبات على أربع أسئلة يسألها المشغّل:
 *
 *   1. **القوالب** — «ماذا نقول للعميل؟»: نصّ فعّال لكل حدثٍ ولغة، و`null` في التحرير يعني
 *      «أعِد نصّ المنصة»، واختبارٌ يرسل الرسالة نفسها إلى عنوانٍ يختاره المشغّل.
 *   2. **السجلّ** — «هل وصل؟ ولمن؟ وبأي مزوّد؟»: مرشّحات بالمستأجر والحدث والحالة، وإعادة
 *      محاولة بسببٍ مكتوب.
 *   3. **الإعدادات** — «باسم من نُرسل، وبأي مزوّد، وبأي سقف؟» + فحص اتصال + إرشاد SPF/DKIM.
 *   4. **الحجر** — «لمن نتوقّف عن الإرسال؟»: ارتداد أو شكوى أو إلغاء اشتراك، بنطاقٍ عام أو
 *      خاص بعميل.
 *
 * وثلاثة مبادئ ظاهرة في الشاشة: **لا بريد حقيقي من هذه الشاشة إلا اختباراً** (وكل اختبار
 * يُوسَم `isTest` ولا يُحتسب على العميل)، و**القراءة والكتابة رمزان مختلفان** (دعمٌ يقرأ
 * السجلّ ولا يكتب نصّاً يُرسَل للعملاء)، و**المزوّد يُبدَّل من هنا بلا إعادة نشر** لأن
 * `email_settings` تُقرأ لحظة الإرسال.
 */

const STATUS_LABEL: Record<(typeof emailMessageStatuses)[number], string> = {
  queued: 'في الطابور',
  sent: 'أُرسلت',
  failed: 'فشلت',
  suppressed: 'محجوبة',
  bounced: 'ارتدّت',
};

const REASON_LABEL: Record<(typeof emailSuppressionReasons)[number], string> = {
  bounce: 'ارتداد',
  complaint: 'شكوى',
  unsubscribe: 'إلغاء اشتراك',
  manual: 'يدويّ',
};

const LOCALE_LABEL: Record<EmailLocale, string> = { ar: 'العربية', en: 'الإنجليزية' };
const PROVIDER_LABEL: Record<EmailSettings['provider'], string> = {
  console: 'سجل النظام فقط', smtp: 'خادم البريد', resend: 'خدمة Resend', http: 'بوابة إرسال مخصّصة',
};

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

type TabId = 'templates' | 'messages' | 'settings' | 'suppressions';

export default function EmailPage() {
  const [tab, setTab] = useState<TabId>('templates');

  return (
    <Screen
      title="البريد"
      subtitle="راجع محتوى الرسائل ومسار تسليمها، ثم حرّر إعدادات المُرسِل أو قائمة الحجر بقرار واضح. أزرار الاختبار قد ترسل بريداً فعلياً إلى العنوان المحدد."
      crumbs={['المنصة', 'التشغيل']}
    >
      <WorkflowGuide title="مسار مراجعة البريد" steps={[
        { title: 'راجع المحتوى', detail: 'اختر الحدث واللغة والنطاق، وتحقق من النص قبل حفظه.' },
        { title: 'افحص التسليم', detail: 'اقرأ سجل الرسائل وحالة العنوان قبل أي إعادة محاولة.' },
        { title: 'قرّر الإرسال', detail: 'احفظ إعدادات المُرسِل أو راجع أثر الحجر؛ الاختبار يرسل إلى عنوان حقيقي.' },
      ]} />
      <Tabs<TabId>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'templates', label: 'القوالب' },
          { id: 'messages', label: 'السجلّ' },
          { id: 'settings', label: 'الإعدادات' },
          { id: 'suppressions', label: 'الحجر' },
        ]}
      />
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'suppressions' && <SuppressionsTab />}
    </Screen>
  );
}

// ───────────────────────────────────────────────────── القوالب

function TemplatesTab() {
  const [event, setEvent] = useState<EmailEvent | ''>('');
  const [locale, setLocale] = useState<EmailLocale>('ar');
  const [tenantId, setTenantId] = useState('');
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [probeTo, setProbeTo] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const templateChanged = Boolean(editing && (subject !== editing.subject || body !== editing.body));

  const tenants = useQuery<Array<{ id: string; code: string; name: string }>>(
    () => apiData<Array<{ id: string; code: string; name: string }>>('/platform/tenants?limit=100'),
    [],
  );
  const templates = useQuery<EmailTemplateListResponse>(() => {
    const params = new URLSearchParams({ locale });
    if (event) params.set('event', event);
    if (tenantId) params.set('tenantId', tenantId);
    return apiData<EmailTemplateListResponse>(`/platform/email/templates?${params.toString()}`);
  }, [event, locale, tenantId]);

  function openEditor(template: EmailTemplate) {
    setEditing(template);
    setSubject(template.subject);
    setBody(template.body);
    setReason('');
    setProbeTo('');
    setNotice(undefined);
  }

  async function save() {
    if (!editing || busy || !templateChanged || reason.trim().length < 3 ||
      !window.confirm(`حفظ نص «${editing.labelAr}» (${LOCALE_LABEL[editing.locale]}) ${tenantId ? 'للعميل المختار' : 'على مستوى المنصة'}؟ قد يُستخدم في رسائل لاحقة. السبب: ${reason.trim()}.`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const saved = await apiData<EmailTemplate>(
        editing.id ? `/platform/email/templates/${editing.id}` : '/platform/email/templates',
        {
          method: editing.id ? 'PUT' : 'POST',
          body: JSON.stringify(
            editing.id
              ? { subject, body, reason }
              : {
                  event: editing.event,
                  locale: editing.locale,
                  subject,
                  body,
                  reason,
                  tenantId: tenantId || undefined,
                },
          ),
        },
      );
      setNotice({
        kind: 'ok',
        text: `حُفظ النصّ — النسخة ${saved.version} بمصدر «${saved.source === 'tenant' ? 'تجاوز العميل' : 'قالب المنصة'}».`,
      });
      setEditing(saved);
      templates.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!editing?.id || busy || templateChanged || !probeTo.includes('@') ||
      !window.confirm(`إرسال رسالة اختبار فعلية إلى «${probeTo.trim()}» باستخدام النص المحفوظ لحدث «${editing.labelAr}»؟`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await apiData<EmailTestResult>(`/platform/email/templates/${editing.id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          to: probeTo,
          locale: editing.locale,
          variables: sampleVariables(editing.event),
        }),
      });
      setNotice({
        kind: result.status === 'sent' ? 'ok' : 'warn',
        text:
          result.status === 'sent'
            ? `خرجت رسالة الاختبار عبر «${result.provider}» إلى ${result.to} (${dateTime(result.deliveredAt)}).`
            : `لم تخرج: الحالة «${STATUS_LABEL[result.status]}»${result.suppressionReason ? ` — السبب: ${REASON_LABEL[result.suppressionReason]}` : ''}.`,
      });
      templates.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride(template: EmailTemplate) {
    if (!template.id || busy || !window.confirm(`حذف تجاوز نص «${template.labelAr}» للعميل المختار؟ سيعود النص المعتمد إلى قالب المنصة.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/platform/email/templates/${template.id}`, { method: 'DELETE' });
      setNotice({ kind: 'ok', text: 'حُذف التجاوز — عاد العميل إلى نصّ المنصة.' });
      setEditing(null);
      templates.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <ContentPanel className="card" title="تحديد نص الرسالة" description="المرشحات تغيّر عرض القوالب فقط؛ التحرير والحفظ عمليتان منفصلتان.">
        <div className="row">
          <label>
            الحدث
            <select value={event} onChange={(change) => { setEvent(change.target.value as EmailEvent | ''); setEditing(null); }}>
              <option value="">كل الأحداث ({emailEvents.length})</option>
              {emailEvents.map((key) => (
                <option key={key} value={key}>
                  {emailEventDefinition(key).labelAr}
                </option>
              ))}
            </select>
          </label>
          <label>
            اللغة
            <select value={locale} onChange={(change) => { setLocale(change.target.value as EmailLocale); setEditing(null); }}>
              {emailLocales.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            العميل (لتجاوزٍ بعينه)
            <select value={tenantId} onChange={(change) => { setTenantId(change.target.value); setEditing(null); }}>
              <option value="">قالب المنصة</option>
              {(tenants.data ?? []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" onClick={templates.reload}>
            تحديث
          </button>
        </div>
        <p className="muted">القالب الخاص بالعميل يحل محل نص المنصة لهذا الحدث واللغة فقط. «متغيرات ناقصة» تنبيه إلى حقول متاحة لم تُستخدم في النص.</p>
      </ContentPanel>

      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      {templates.status === 'forbidden' ? (
        <Forbidden />
      ) : templates.status === 'loading' ? (
        <Loading />
      ) : templates.status === 'error' ? (
        <ErrorBox message={templates.error} onRetry={templates.reload} />
      ) : (
        <ContentPanel title="القوالب المتاحة" description="افتح نصاً للمراجعة؛ لا تُرسل أي رسالة بمجرد فتحه.">
          <TableViewport label="جدول قوالب البريد">
          <table className="table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>الحدث</th>
                <th>اللغة</th>
                <th>الموضوع</th>
                <th>المصدر</th>
                <th>النسخة</th>
                <th>متغيّرات ناقصة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(templates.data?.data ?? []).map((template) => (
                <tr key={`${template.event}-${template.locale}-${template.id ?? 'seed'}`}>
                  <td>{template.labelAr}</td>
                  <td>{LOCALE_LABEL[template.locale]}</td>
                  <td className="muted">{template.subject}</td>
                  <td>
                    <SourceTag source={template.source === 'seed' ? 'default' : template.source} />
                  </td>
                  <td>{template.version}</td>
                  <td>
                    {template.missingVariables.length === 0 ? (
                      '—'
                    ) : (
                      <span className="tag warn">{template.missingVariables.join(' · ')}</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn sm" type="button" onClick={() => openEditor(template)}>
                        تحرير
                      </button>
                      {template.id && template.source === 'tenant' && (
                        <button
                          className="btn sm danger"
                          type="button"
                          disabled={busy}
                          onClick={() => clearOverride(template)}
                        >
                          مسح التجاوز
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableViewport>
          {(templates.data?.data ?? []).length === 0 && <Empty title="لا قوالب بهذا المرشّح" />}
        </ContentPanel>
      )}

      {editing && (
        <ContentPanel className="card" title={`${editing.labelAr} — ${LOCALE_LABEL[editing.locale]}`} description={editing.id ? 'حرّر النص ثم احفظه قبل فحصه بإرسال رسالة.' : 'هذا نص أولي؛ أنشئه أولاً قبل إرسال اختبار.'}>
          <p className="muted">
            المتغيّرات المعلَنة: {editing.variables.map((name) => `{{${name}}}`).join(' · ') || 'لا شيء'}
          </p>
          <label>
            الموضوع
            <input value={subject} onChange={(change) => setSubject(change.target.value)} />
          </label>
          <label>
            النصّ
            <textarea rows={10} value={body} onChange={(change) => setBody(change.target.value)} />
          </label>
          <label>
            سبب التعديل (يُسجَّل في التدقيق)
            <input value={reason} onChange={(change) => setReason(change.target.value)} />
          </label>
          <div className="row">
            <button className="btn" type="button" disabled={busy || !templateChanged || reason.trim().length < 3} onClick={save}>
              {editing.id ? 'حفظ النصّ' : 'إنشاء تجاوزٍ بهذا النصّ'}
            </button>
            <label>
              فحص إلى عنوان
              <input
                value={probeTo}
                placeholder="ops@example.com"
                onChange={(change) => setProbeTo(change.target.value)}
              />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || !editing.id || templateChanged || !probeTo.includes('@')}
              onClick={sendTest}
            >
              إرسال اختبار
            </button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>
              إغلاق
            </button>
          </div>
          <p className="muted">الإرسال التجريبي يستخدم النسخة المحفوظة فقط وبريداً فعلياً للعنوان المحدد؛ إن كان النص معدلاً وغير محفوظ فلن يتاح الإرسال. تحقّق من المتغيرات قبل الحفظ.</p>
        </ContentPanel>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────── السجلّ

function MessagesTab() {
  const [tenantId, setTenantId] = useState('');
  const [event, setEvent] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const tenants = useQuery<Array<{ id: string; code: string; name: string }>>(
    () => apiData<Array<{ id: string; code: string; name: string }>>('/platform/tenants?limit=100'),
    [],
  );
  const messages = useQuery<EmailMessageListResponse>(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (tenantId) params.set('tenantId', tenantId);
    if (event) params.set('event', event);
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    return apiData<EmailMessageListResponse>(`/platform/email/messages?${params.toString()}`);
  }, [tenantId, event, status, search]);
  const suppressions = useQuery<{ data: EmailSuppression[] }>(
    () => apiData<{ data: EmailSuppression[] }>('/platform/email/suppressions'),
    [],
  );

  async function retry(row: EmailMessage) {
    const reason = window.prompt('سبب إعادة المحاولة؟', 'بطلبٍ من الدعم');
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setNotice({ kind: 'danger', text: 'إعادة المحاولة تحتاج سبباً مكتوباً (٣ أحرف على الأقل).' });
      return;
    }
    if (busy || !window.confirm(`إعادة محاولة إرسال الرسالة إلى «${row.toEmail}»؟ قد تصل الرسالة إلى هذا العنوان. السبب: ${reason.trim()}.`)) return;
    setBusy(true);
    try {
      const updated = await apiData<EmailMessage>(`/platform/email/messages/${row.id}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setNotice({
        kind: 'ok',
        text: `الرسالة الآن «${STATUS_LABEL[updated.status]}» — المحاولات ${updated.attempts}.`,
      });
      messages.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const rows = messages.data?.data ?? [];
  const counts = messages.data?.counts ?? {};

  return (
    <div className="grid">
      <ContentPanel className="card" title="تصفية سجل التسليم" description="اختر العميل أو الحدث أو الحالة، ثم راجع النتيجة قبل إعادة أي محاولة.">
        <div className="row">
          <label>
            العميل
            <select value={tenantId} onChange={(change) => setTenantId(change.target.value)}>
              <option value="">كل العملاء</option>
              {(tenants.data ?? []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            الحدث
            <select value={event} onChange={(change) => setEvent(change.target.value)}>
              <option value="">كل الأحداث</option>
              {emailEvents.map((key) => (
                <option key={key} value={key}>
                  {emailEventDefinition(key).labelAr}
                </option>
              ))}
            </select>
          </label>
          <label>
            الحالة
            <select value={status} onChange={(change) => setStatus(change.target.value)}>
              <option value="">كل الحالات</option>
              {emailMessageStatuses.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            بحث (إلى أو الموضوع)
            <input value={search} onChange={(change) => setSearch(change.target.value)} />
          </label>
          <button className="btn" type="button" onClick={messages.reload}>
            تحديث
          </button>
        </div>
        <p className="muted">
          الحالات:{' '}
          {emailMessageStatuses.map((value) => `${STATUS_LABEL[value]} ${counts[value] ?? 0}`).join(' · ')}
        </p>
      </ContentPanel>

      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      {messages.status === 'forbidden' ? (
        <Forbidden />
      ) : messages.status === 'loading' ? (
        <Loading />
      ) : messages.status === 'error' ? (
        <ErrorBox message={messages.error} onRetry={messages.reload} />
      ) : (
        <ContentPanel title="الرسائل المسجّلة" description="قد تعيد المحاولة إرسال البريد إلى العنوان الظاهر؛ راجع حالة الحجر أولاً.">
          <TableViewport label="جدول سجل البريد">
          <table className="table" style={{ minWidth: 940 }}>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>إلى</th>
                <th>الحدث</th>
                <th>الحالة</th>
                <th>المزوّد</th>
                <th>المحاولات</th>
                <th>العميل</th>
                <th>آخر خطأ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const blocked = (suppressions.data?.data ?? []).some(
                  (entry) =>
                    entry.email === row.toEmail &&
                    (entry.tenantId === null || entry.tenantId === row.tenantId),
                );
                return (
                  <tr key={row.id}>
                    <td>{dateTime(row.sentAt ?? row.queuedAt)}</td>
                    <td>
                      {row.toEmail}
                      {row.isTest && <span className="tag">اختبار</span>}
                    </td>
                    <td>{row.eventLabelAr}</td>
                    <td>
                      <span
                        className={`chip ${row.status === 'sent' ? 'on' : row.status === 'failed' ? 'off' : ''}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td>{row.provider}</td>
                    <td>
                      {row.attempts}
                      {row.status === 'queued' && <span className="muted"> (ستُعاد)</span>}
                    </td>
                    <td>{row.tenantCode ?? 'المنصة'}</td>
                    <td className="muted">
                      {row.lastError ?? '—'}
                      {blocked && <span className="tag warn">محجوب الآن</span>}
                    </td>
                    <td>
                      {row.status !== 'sent' && row.status !== 'suppressed' && (
                        <button className="btn sm" type="button" disabled={busy} onClick={() => retry(row)}>
                          إعادة محاولة
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </TableViewport>
          {rows.length === 0 && (
            <Empty title="لا رسائل بهذه المرشّحات" detail="جرّب إزالة مرشّح الحالة أو الحدث أو البحث." />
          )}
        </ContentPanel>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────── الإعدادات

function SettingsTab() {
  const settings = useQuery<EmailSettings>(() => apiData<EmailSettings>('/platform/email/settings'), []);
  const [draft, setDraft] = useState<Partial<EmailSettings>>({});
  const [apiKeyDraft, setApiKeyDraft] = useState<string | undefined>(undefined);
  const [smtpPasswordDraft, setSmtpPasswordDraft] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [probeTo, setProbeTo] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const current = settings.data;
  const value = <K extends keyof EmailSettings>(key: K): EmailSettings[K] | undefined =>
    Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : current?.[key];

  const selectedProvider = value('provider') ?? 'console';
  const hasChanges = Object.keys(draft).length > 0 || apiKeyDraft !== undefined || smtpPasswordDraft !== undefined;
  const reasonValid = !reason.trim() || reason.trim().length >= 3;

  async function save() {
    if (busy || !hasChanges || !reasonValid || !window.confirm(`حفظ إعدادات إرسال البريد للمُنصّة بالمزوّد «${PROVIDER_LABEL[selectedProvider]}»؟ قد تؤثر التغييرات في الرسائل التالية.`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const payload: Record<string, unknown> = {
        provider: selectedProvider,
        fromName: value('fromName'),
        fromEmail: value('fromEmail'),
        replyTo: value('replyTo') || null,
        sendingDomain: value('sendingDomain') || null,
        dailyLimit: value('dailyLimit') ?? null,
        monthlyLimit: value('monthlyLimit') ?? null,
        ...(reason.trim().length >= 3 ? { reason } : {}),
      };
      if (apiKeyDraft !== undefined) payload.apiKey = apiKeyDraft.trim() || null;
      if (draft.apiEndpoint !== undefined) payload.apiEndpoint = draft.apiEndpoint?.trim() || null;
      if (draft.smtpHost !== undefined) payload.smtpHost = draft.smtpHost?.trim() || null;
      if (draft.smtpPort !== undefined) payload.smtpPort = draft.smtpPort || null;
      if (draft.smtpUser !== undefined) payload.smtpUser = draft.smtpUser?.trim() || null;
      if (smtpPasswordDraft !== undefined) payload.smtpPassword = smtpPasswordDraft || null;
      if (draft.smtpSecure !== undefined) payload.smtpSecure = draft.smtpSecure;

      const updated = await apiData<EmailSettings>('/platform/email/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setDraft({});
      setApiKeyDraft(undefined);
      setSmtpPasswordDraft(undefined);
      setReason('');
      setNotice({
        kind: 'ok',
        text: `حُفظت الإعدادات — المزوّد الفعّال «${PROVIDER_LABEL[updated.provider]}»، والمُرسِل ${updated.fromName} <${updated.fromEmail}>.`,
      });
      settings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (busy || hasChanges || !probeTo.includes('@') || !window.confirm(`إرسال فحص بريد فعلي إلى «${probeTo.trim()}» باستخدام الإعدادات المحفوظة، وليس أي مسودة مفتوحة؟`)) return;
    setBusy(true);
    try {
      const result = await apiData<EmailTestResult>('/platform/email/settings/test', {
        method: 'POST',
        body: JSON.stringify({ to: probeTo, locale: 'ar' }),
      });
      setNotice({
        kind: result.status === 'sent' ? 'ok' : 'warn',
        text:
          result.status === 'sent'
            ? `خرجت رسالة الفحص عبر «${result.provider}» إلى ${result.to}.`
            : `لم تخرج رسالة الفحص: ${STATUS_LABEL[result.status]}.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (settings.status === 'forbidden') return <Forbidden />;
  if (settings.status === 'loading') return <Loading />;
  if (settings.status === 'error') return <ErrorBox message={settings.error} onRetry={settings.reload} />;

  return (
    <div className="grid">
      <ContentPanel className="card" title="المُرسِل والمزوّد" description="إعدادات الإرسال الحالية؛ أي تغيير هنا مسودة حتى الحفظ، والفحص يستخدم المحفوظ فقط.">
        <div className="row">
          <label>
            المزوّد
            <select
              value={value('provider') ?? 'console'}
              onChange={(change) =>
                setDraft({ ...draft, provider: change.target.value as EmailSettings['provider'] })
              }
            >
              <option value="resend">Resend — خدمة بريد سحابية</option>
              <option value="smtp">خادم بريد SMTP</option>
              <option value="http">بوابة إرسال مخصّصة</option>
              <option value="console">سجل النظام فقط — دون إرسال بريد</option>
            </select>
          </label>
          <label>
            اسم المُرسِل (عربي مسموح وهو الأفضل)
            <input
              value={value('fromName') ?? ''}
              onChange={(change) => setDraft({ ...draft, fromName: change.target.value })}
            />
          </label>
          <label>
            عنوان المُرسِل
            <input
              value={value('fromEmail') ?? ''}
              onChange={(change) => setDraft({ ...draft, fromEmail: change.target.value })}
            />
          </label>
          <label>
            ردّ إلى (اختياري)
            <input
              value={value('replyTo') ?? ''}
              onChange={(change) => setDraft({ ...draft, replyTo: change.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label>
            نطاق الإرسال المُتحقَّق منه
            <input
              value={value('sendingDomain') ?? ''}
              placeholder="mail.example.com"
              onChange={(change) => setDraft({ ...draft, sendingDomain: change.target.value })}
            />
          </label>
          <label>
            سقف يومي (حماية مزوّد)
            <input
              type="number"
              min={1}
              value={value('dailyLimit') ?? ''}
              onChange={(change) =>
                setDraft({
                  ...draft,
                  dailyLimit: change.target.value === '' ? null : Number(change.target.value),
                })
              }
            />
          </label>
          <label>
            سقف شهري
            <input
              type="number"
              min={1}
              value={value('monthlyLimit') ?? ''}
              onChange={(change) =>
                setDraft({
                  ...draft,
                  monthlyLimit: change.target.value === '' ? null : Number(change.target.value),
                })
              }
            />
          </label>
          <label>
            سبب التعديل (تدقيق)
            <input value={reason} onChange={(change) => setReason(change.target.value)} />
          </label>
        </div>

        {(selectedProvider === 'resend' || selectedProvider === 'http') && (
          <div className="row">
            <label style={{ flex: 2 }}>
              {selectedProvider === 'resend' ? 'مفتاح Resend API Key' : 'مفتاح المصادقة (Bearer API Key)'}
              <input
                type="password"
                dir="ltr"
                value={apiKeyDraft ?? ''}
                placeholder={
                  current?.apiKeyMasked
                    ? `محفوظ (${current.apiKeyMasked}) — اتركه فارغاً للإبقاء عليه`
                    : selectedProvider === 'resend'
                      ? 're_123456789...'
                      : 'Bearer token...'
                }
                onChange={(change) => setApiKeyDraft(change.target.value || undefined)}
              />
            </label>
            <label style={{ flex: 2 }}>
              {selectedProvider === 'resend'
                ? 'رابط Resend API (اختياري)'
                : 'رابط نقطة النهاية (HTTP Webhook URL)'}
              <input
                dir="ltr"
                value={value('apiEndpoint') ?? ''}
                placeholder={
                  selectedProvider === 'resend'
                    ? 'https://api.resend.com/emails'
                    : 'https://api.provider.com/v1/send'
                }
                onChange={(change) => setDraft({ ...draft, apiEndpoint: change.target.value })}
              />
            </label>
          </div>
        )}

        {selectedProvider === 'smtp' && (
          <div className="row">
            <label>
              مُضيف SMTP (Host)
              <input
                dir="ltr"
                value={value('smtpHost') ?? ''}
                placeholder="smtp.resend.com"
                onChange={(change) => setDraft({ ...draft, smtpHost: change.target.value })}
              />
            </label>
            <label>
              المنفذ (Port)
              <input
                type="number"
                dir="ltr"
                value={value('smtpPort') ?? 587}
                onChange={(change) =>
                  setDraft({
                    ...draft,
                    smtpPort: change.target.value ? Number(change.target.value) : null,
                  })
                }
              />
            </label>
            <label>
              اسم مستخدم SMTP
              <input
                dir="ltr"
                value={value('smtpUser') ?? ''}
                placeholder="resend"
                onChange={(change) => setDraft({ ...draft, smtpUser: change.target.value })}
              />
            </label>
            <label>
              كلمة مرور SMTP
              <input
                type="password"
                dir="ltr"
                value={smtpPasswordDraft ?? ''}
                placeholder={current?.smtpConfigured ? '•••••••• (محفوظة)' : 'كلمة المرور'}
                onChange={(change) => setSmtpPasswordDraft(change.target.value || undefined)}
              />
            </label>
          </div>
        )}

        <div className="row">
          <button className="btn" type="button" disabled={busy || !hasChanges || !reasonValid} onClick={save}>
            حفظ التغييرات
          </button>
          <label>
            فحص الاتصال إلى
            <input
              value={probeTo}
              placeholder="ops@example.com"
              onChange={(change) => setProbeTo(change.target.value)}
            />
          </label>
          <button className="btn" type="button" disabled={busy || hasChanges || !probeTo.includes('@')} onClick={sendTest}>
            إرسال فحص
          </button>
          <button className="btn" type="button" onClick={() => {
            if (hasChanges && !window.confirm('تجاهل تغييرات إعدادات البريد غير المحفوظة واستعادة القيم الحالية؟')) return;
            setDraft({});
            setApiKeyDraft(undefined);
            setSmtpPasswordDraft(undefined);
            setReason('');
            settings.reload();
          }}>
            تجاهل المسودة وتحديث القراءة
          </button>
        </div>
        {hasChanges && <p className="alert warn" role="status">تغييرات غير محفوظة: فحص الاتصال معطّل حتى تحفظ أو تتجاهل المسودة. {reasonValid ? '' : 'أكمل سبب التعديل إلى ثلاثة أحرف على الأقل أو امسحه.'}</p>}
        <p className="muted">آخر تعديل: {dateTime(current?.updatedAt ?? null)}. {current?.smtpConfigured ? 'اعتمادات خادم البريد مهيأة.' : 'اعتمادات خادم البريد غير مهيأة؛ قد يتعذر الإرسال عبره.'} لا تظهر الأسرار المحفوظة في هذه الصفحة.</p>
      </ContentPanel>

      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      <ContentPanel title="التحقق من النطاق" description="إرشادات تهيئة التسليم؛ لا تعني أن سجلات النطاق قد فُحصت.">
        <h3>سجلات SPF وDKIM وDMARC</h3>
        <ul className="muted">
          <li>
            <strong>SPF</strong> — سجلّ TXT على النطاق يسمح بخوادمنا:{' '}
            <code>v=spf1 include:{'<مزوّد البريد>'} -all</code>
          </li>
          <li>
            <strong>DKIM</strong> — مفتاح عام يُنشر في DNS ويُوقّع كل رسالة، فيصير التوقيع قابلاً للتحقّق عند
            المستلم.
          </li>
          <li>
            <strong>DMARC</strong> — سياسة على <code>_dmarc</code> تربط الاثنين:{' '}
            <code>v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com</code>
          </li>
        </ul>
        <p className="alert warn">
          لا تتحقق الصفحة من سجلات النطاق آلياً. راجع إعدادات المزود ونطاق الإرسال قبل الاعتماد على التسليم.
        </p>
      </ContentPanel>
    </div>
  );
}

// ───────────────────────────────────────────────────── الحجر

function SuppressionsTab() {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<(typeof emailSuppressionReasons)[number]>('manual');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);

  const list = useQuery<{ data: EmailSuppression[] }>(
    () => apiData<{ data: EmailSuppression[] }>('/platform/email/suppressions'),
    [],
  );

  async function add() {
    if (busy || !email.trim().includes('@') || !window.confirm(`حجر العنوان «${email.trim()}» على مستوى جميع العملاء؟ سيتوقف إرسال البريد إليه من المنصة.`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await apiData<EmailSuppression>('/platform/email/suppressions', {
        method: 'POST',
        body: JSON.stringify({ email, reason, ...(note.trim() ? { note } : {}) }),
      });
      setEmail('');
      setNote('');
      setNotice({ kind: 'ok', text: 'أُضيف العنوان إلى قائمة الحجر — لن يخرج إليه بريد.' });
      list.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: EmailSuppression) {
    if (busy || !window.confirm(`رفع الحجر عن «${row.email}» ${row.tenantId ? 'لهذا العميل' : 'لجميع العملاء'}؟ قد تُرسل إليه رسائل جديدة بعد ذلك.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/platform/email/suppressions/${row.id}`, { method: 'DELETE' });
      setNotice({ kind: 'ok', text: `رُفع الحجر عن ${row.email}.` });
      list.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <ContentPanel className="card" title="حجر عنوان" description="هذا النموذج يحظر العنوان على مستوى جميع العملاء؛ لا يوجد اختيار منشأة عند الإضافة هنا.">
        <div className="row">
          <label>
            العنوان
            <input
              value={email}
              placeholder="blocked@example.com"
              onChange={(change) => setEmail(change.target.value)}
            />
          </label>
          <label>
            السبب
            <select
              value={reason}
              onChange={(change) =>
                setReason(change.target.value as (typeof emailSuppressionReasons)[number])
              }
            >
              {emailSuppressionReasons.map((value) => (
                <option key={value} value={value}>
                  {REASON_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            ملاحظة
            <input value={note} onChange={(change) => setNote(change.target.value)} />
          </label>
          <button className="btn" type="button" disabled={busy || !email.includes('@')} onClick={add}>
            إضافة حجر
          </button>
        </div>
        <p className="muted">قد تظهر أدناه قيود خاصة بعميل أو عامة، لكن إنشاء قيد من هذا النموذج عام. راجع العنوان والسبب قبل التأكيد؛ الحجر قد يمنع إرسال رسائل مهمة.</p>
      </ContentPanel>

      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      {list.status === 'forbidden' ? (
        <Forbidden />
      ) : list.status === 'loading' ? (
        <Loading />
      ) : list.status === 'error' ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : (
        <ContentPanel title="العناوين المحجوبة" description="راجع نطاق كل صف قبل رفع الحجر؛ لا يعني رفعه إعادة إرسال الرسائل السابقة.">
          <TableViewport label="جدول عناوين الحجر">
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>العنوان</th>
                <th>النطاق</th>
                <th>السبب</th>
                <th>ملاحظة</th>
                <th>أُضيف</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data?.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.email}</td>
                  <td>{row.tenantId ?? 'كل العملاء'}</td>
                  <td>{REASON_LABEL[row.reason]}</td>
                  <td className="muted">{row.note ?? '—'}</td>
                  <td>{dateTime(row.createdAt)}</td>
                  <td>
                    <button className="btn sm" type="button" disabled={busy} onClick={() => remove(row)}>
                      رفع الحجر
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableViewport>
          {(list.data?.data ?? []).length === 0 && (
            <Empty title="لا عناوين محجوبة" detail="الحجر يمنع الإرسال قبل الطابور، فلا تُستهلك محاولة." />
          )}
        </ContentPanel>
      )}
    </div>
  );
}

/** متغيّراتٌ تجريبية لمعاينة قالب: كل متغيّرٍ معلَنٍ للحدث يأخذ قيمةً تُقرأ. */
function sampleVariables(event: EmailEvent): Record<string, string> {
  const samples: Record<string, string> = {
    name: 'عميل تجريبي',
    tenant: 'شركة الأمل',
    link: 'https://app.example.com/i/7f3c',
    expires: '٣٠ دقيقة',
    code: '482913',
    invoice_no: 'INV-2026-0007',
    amount: '1,250.00 ر.س',
    due: '2026-10-01',
    period: '2026-08',
    item: 'صنف تجريبي',
    on_hand: '2',
    min: '10',
    branch: 'الفرع الرئيسي',
    date: '2026-09-15',
    variance: '-37.50 ر.س',
    plan: 'النمو',
    period_end: '2026-12-31',
    days: '7',
    retry: '2026-09-20',
    title: 'إعلان تجريبي',
    body: 'نصّ الإعلان.',
  };
  const out: Record<string, string> = {};
  for (const name of emailEventDefinition(event).variables) out[name] = samples[name] ?? '—';
  return out;
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isForbidden) return 'تحتاج صلاحية إدارة البريد لهذا الإجراء.';
    return error.message;
  }
  return arabicErrorText(error);
}

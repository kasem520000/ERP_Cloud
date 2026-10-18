'use client';

import { useMemo, useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { apiData, apiList } from '../../lib/api';
import { eventLabel } from '../../lib/developer-language';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/**
 * الويب هوك — الأحداث والعنوان وسرّ التوقيع وسجلّ التسليم (P-C11).
 *
 * السؤال الذي تجيب عنه الشاشة: **«هل تصل أحداثُنا إلى عميلنا، وماذا قال عنوانه؟»** — لا
 * «هل أنشأنا عنواناً؟». ولذلك كلُّ عنوان يحمل حصيلة تسليماته، وكلُّ محاولة تحمل رمز
 * الاستجابة والزمن الخطأ — وهذا ما يُبنى عليه القرار: عنوانٌ يردّ 500 منذ يومين ليس
 * عنواناً «نشطاً».
 *
 * وثلاث حقائق تُقال هنا:
 *   * **السرّ يظهر مرّة واحدة** عند الإنشاء، والقاعدة تحفظه **مشفَّراً** لأن التوقيع يحتاج
 *     قراءته — بخلاف مفتاح الـAPI الذي يُقارَن ولا يُقرأ.
 *   * **الاختبار يمرّ من مسار الإرسال نفسه**: توقيع، ثم POST، ثم قياس — لا زرٌّ يوهم بالسلامة.
 *   * **الإيقاف يمنع التلقائي لا اليدوي**: الأحداث الحقيقية لا يُنشأ لها صفّ تسليمٍ أبداً
 *     للعنوان الموقوف، ويبقى زرّ «اختبار» متاحاً — فمن أصلح مستقبِلَه للتوّ يقيسه قبل أن
 *     يُعيد التشغيل. والحدث الحقيقي هو ما يُقاس عليه الإيقاف، لا زرٌّ ضغطه إنسان.
 */

type Tenant = { id: string; code: string; name: string; status: string };

type EndpointStats = {
  delivered: number;
  failed: number;
  pending: number;
  lastDeliveryAt: string | null;
  lastResponseCode: number | null;
  lastError: string | null;
};

type EndpointRow = {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  status: 'active' | 'paused';
  secretPrefix: string;
  description: string | null;
  createdAt: string;
  createdByLabel: string | null;
  stats: EndpointStats;
};

type EndpointCreated = EndpointRow & { secret: string };

type DeliveryRow = {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  maxAttempts: number;
  responseCode: number | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payloadKeys: string[];
  payloadBytes: number;
};

type Attempt = {
  deliveryId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  responseCode: number | null;
  durationMs: number | null;
  error: string | null;
  attempts: number;
};

type Catalogue = { events: string[]; testEvent: string; signature: { header: string; toleranceSeconds: number } };

export default function WebhooksPage() {
  const { canConsole } = useSession();
  const [tenantId, setTenantId] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['invoice.posted']);
  const [description, setDescription] = useState('');
  const [openId, setOpenId] = useState('');
  const [secret, setSecret] = useState<{ label: string; value: string } | undefined>(undefined);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const allowed = canConsole('console.webhooks.manage');

  const tenants = useQuery(() => apiList<Tenant>('/platform/tenants?limit=200'), []);
  const catalogue = useQuery(() => apiData<Catalogue>('/platform/developer/catalogue'), []);
  const endpoints = useQuery(
    () => tenantId
      ? apiList<EndpointRow>(`/platform/tenants/${tenantId}/webhooks`).then((rows) => ({ tenantId, rows }))
      : Promise.resolve({ tenantId, rows: [] as EndpointRow[] }),
    [tenantId],
  );
  const deliveries = useQuery(
    () => (openId ? apiList<DeliveryRow>(`/platform/webhooks/${openId}/deliveries?limit=50`) : Promise.resolve([])),
    [openId],
  );

  // Never show a previous tenant's endpoints while the new list is loading.
  const rows = useMemo(() => endpoints.data?.tenantId === tenantId ? endpoints.data.rows : [], [endpoints.data, tenantId]);

  async function create() {
    if (!tenantId || url.trim().length < 12 || events.length === 0) {
      setNotice({ kind: 'danger', text: 'عنوانٌ صالح وحدثٌ واحد على الأقل مطلوبان.' });
      return;
    }
    setBusy('create');
    setNotice(undefined);
    try {
      const created = await apiData<EndpointCreated>(`/platform/tenants/${tenantId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({
          url: url.trim(),
          events,
          ...(description.trim().length >= 3 ? { description: description.trim() } : {}),
        }),
      });
      setSecret({ label: `سرّ توقيع «${created.url}»`, value: created.secret });
      setUrl('');
      setDescription('');
      endpoints.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus(row: EndpointRow) {
    if (!window.confirm(row.status === 'active'
      ? `إيقاف إرسال الأحداث تلقائياً إلى «${row.url}»؟ تبقى اختبارات الاتصال اليدوية ممكنة.`
      : `إعادة تشغيل إرسال الأحداث إلى «${row.url}»؟ تحقق من الوجهة قبل المتابعة.`)) return;
    setBusy(row.id);
    setNotice(undefined);
    try {
      await apiData<EndpointRow>(`/platform/tenants/${tenantId}/webhooks/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: row.status === 'active' ? 'paused' : 'active' }),
      });
      endpoints.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function test(row: EndpointRow) {
    if (!window.confirm(`إرسال حدث اختبار فعلي إلى «${row.url}»؟ سيتلقى النظام المستقبِل طلباً موقعاً.`)) return;
    setBusy(row.id);
    setNotice(undefined);
    try {
      const attempt = await apiData<Attempt>(`/platform/webhooks/${row.id}/test`, { method: 'POST', body: JSON.stringify({}) });
      setNotice({
        kind: attempt.status === 'delivered' ? 'ok' : 'danger',
        text:
          attempt.status === 'delivered'
            ? `وصل حدث الاختبار: ${attempt.responseCode} خلال ${attempt.durationMs} مللي ثانية.`
            : `فشل الإرسال: ${attempt.responseCode ?? 'لا استجابة'} — ${attempt.error ? arabicErrorText(new Error(attempt.error), 'راجع سجل التسليم لمعرفة السبب.') : 'راجع سجل التسليم.'}`,
      });
      // فتح السجلّ على هذا العنوان هو ما يجلب تسليماته (اعتماد `useQuery` على `openId`).
      setOpenId(row.id);
      endpoints.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function retry(row: EndpointRow, delivery: DeliveryRow) {
    if (!window.confirm(`إعادة إرسال «${eventLabel(delivery.event)}» إلى «${row.url}»؟ قد يُعالج المستقبِل الحدث مرة أخرى.`)) return;
    setBusy(delivery.id);
    setNotice(undefined);
    try {
      const attempt = await apiData<Attempt>(
        `/platform/webhooks/${row.id}/deliveries/${delivery.id}/retry`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setNotice({
        kind: attempt.status === 'delivered' ? 'ok' : 'danger',
        text: `المحاولة ${attempt.attempts}: ${attempt.responseCode ?? 'لا استجابة'} — ${attempt.error ? arabicErrorText(new Error(attempt.error), 'راجع سجل التسليم.') : 'وصل'}`,
      });
      endpoints.reload();
      deliveries.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: EndpointRow) {
    if (!window.confirm(`حذف الوجهة «${row.url}» وسجل تسليماتها نهائياً؟ لا يمكن التراجع عن الحذف.`)) return;
    setBusy(row.id);
    setNotice(undefined);
    try {
      await apiData<{ id: string }>(`/platform/tenants/${tenantId}/webhooks/${row.id}`, { method: 'DELETE' });
      if (openId === row.id) setOpenId('');
      setNotice({ kind: 'ok', text: 'حُذف العنوان وتسليماته — الحذف قرارُ العميل لا احتفاظٌ منّا.' });
      endpoints.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) {
    return (
      <Screen title="وجهات الأحداث" subtitle="الأحداث المرسلة إلى أنظمة المنشأة">
        <Forbidden />
      </Screen>
    );
  }

  const opened = rows.find((row) => row.id === openId);

  return (
    <Screen
      title="وجهات الأحداث"
      subtitle="حدّد المنشأة، راجع الوجهات ونتائج التسليم، ثم اختبر الاتصال أو غيّر الاشتراك بعد التأكيد."
      actions={
        <button className="btn" onClick={() => endpoints.reload()} disabled={!tenantId}>
          تحديث
        </button>
      }
    >
      <WorkflowGuide title="من الاشتراك إلى متابعة التسليم" steps={[
        { title: 'اختر المنشأة والحدث', detail: 'كل عنوان يستقبل أحداث المنشأة المحددة فقط؛ تحقق من العنوان قبل إضافته.' },
        { title: 'راجع حالة الوجهة', detail: 'الاختبار يرسل طلباً حقيقياً؛ والإيقاف يعطل الأحداث التلقائية لا الاختبارات اليدوية.' },
        { title: 'افتح سجل التسليم', detail: 'راجع الاستجابة والمحاولات قبل إعادة إرسال حدث متعثر أو حذف الوجهة.' },
      ]} />
      {notice && <p className={`alert ${notice.kind}`} role={notice.kind === 'danger' ? 'alert' : 'status'}>{notice.text}</p>}

      {secret && (
        <ContentPanel title="سر التوقيع: يظهر مرة واحدة" description="لا تغادر الشاشة قبل حفظه بطريقة آمنة لدى الجهة المستقبلة.">
          <p className="muted">
            يُخزَّن مشفَّراً لأن الإرسال يحتاج قراءته لحظة التوقيع. الصيغة:{' '}
            <code>{catalogue.data?.signature.header ?? 'x-erp-signature'}</code> —
            HMAC-SHA256 على <code>&quot;&lt;الطابع&gt;.&lt;الجسم&gt;&quot;</code>، ونافذة القبول{' '}
            {catalogue.data?.signature.toleranceSeconds ?? 300} ثانية.
          </p>
          <pre className="code" dir="ltr" style={{ overflowX: 'auto' }}>{secret.value}</pre>
          <p className="muted">
            {secret.label} · البادئة <code>{secret.value.slice(0, 14)}</code>
          </p>
          <button className="btn" onClick={() => setSecret(undefined)}>
            أخفِ السرّ
          </button>
        </ContentPanel>
      )}

      <ContentPanel title="المنشأة وأمان النقل" description="تُنقل الأحداث إلى العنوان الذي تسجله هنا؛ لا يكفي توقيع الطلب دون اتصال آمن.">
        <div className="grid cols-2"><label>
          المنشأة
          <select value={tenantId} onChange={(event) => { setSecret(undefined); setNotice(undefined); setOpenId(''); setTenantId(event.target.value); }}>
            <option value="">— اختر منشأة —</option>
            {(tenants.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.code}){entry.status !== 'active' ? ' — غير نشطة' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="muted">
          العنوان يجب أن يكون <code>https</code>، ويُقبل <code>http</code> على <code>localhost</code> وحده —
          فالسرّ يمنع التزوير لا التنصّت.
        </div>
        </div>
      </ContentPanel>

      {tenantId && (
        <ContentPanel title="إضافة وجهة" description="إضافة العنوان تنشئ اشتراكاً فعلياً؛ سر التوقيع الجديد يظهر مرة واحدة بعد الحفظ.">
          <div className="form-grid">
            <label>
              العنوان
              <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hooks/erp" />
            </label>
            <label>
              وصف (اختياري)
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="بوت المحاسبة" />
            </label>
          </div>
          <div className="form-grid">
            <strong>الأحداث التي ستصل إلى هذه الوجهة</strong>
            {(catalogue.data?.events ?? []).map((event) => (
              <label key={event}>
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={(change) =>
                    setEvents((current) =>
                      change.target.checked ? [...current, event] : current.filter((entry) => entry !== event),
                    )
                  }
                />
                <span title={event}>{eventLabel(event)}</span>
              </label>
            ))}
          </div>
          <details className="muted small"><summary>الرموز الفنية للأحداث</summary><p dir="ltr">{catalogue.data?.events.join(' · ')}</p></details>
          <button className="btn primary" onClick={create} disabled={busy === 'create' || catalogue.status !== 'success'}>
            {busy === 'create' ? 'جارٍ الإضافة…' : 'أضف العنوان'}
          </button>
        </ContentPanel>
      )}

      {tenants.status === 'loading' && <Loading rows={2} />}
      {tenants.status === 'error' && <ErrorBox message={tenants.error} onRetry={tenants.reload} />}
      {tenants.status === 'forbidden' && <Forbidden />}
      {catalogue.status === 'error' && <ErrorBox message={catalogue.error} onRetry={catalogue.reload} />}
      {catalogue.status === 'forbidden' && <Forbidden />}
      {tenantId && endpoints.status === 'loading' && <Loading />}
      {tenantId && endpoints.status === 'error' && <ErrorBox message={endpoints.error} onRetry={() => endpoints.reload()} />}
      {tenantId && endpoints.status === 'forbidden' && <Forbidden />}
      {tenantId && endpoints.status === 'success' && rows.length === 0 && (
        <Empty title="لا عناوين لهذه المنشأة" detail="أضف عنواناً واشترك بحدثٍ واحد على الأقل." />
      )}

      {rows.length > 0 && (
        <ContentPanel title={`وجهات المنشأة (${rows.length})`} description="راجع نتيجة التسليم وآخر رد قبل إيقاف الاشتراك أو إعادة تشغيله. على الهاتف اسحب الجدول لعرض جميع الأعمدة.">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>العنوان</th>
                  <th>الأحداث</th>
                  <th>الحالة</th>
                  <th>التسليمات</th>
                  <th>آخر ردّ</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.url}</strong>
                      <div className="muted">
                        <code>{row.secretPrefix}</code> · {row.description ?? 'بلا وصف'}
                      </div>
                    </td>
                    <td>
                      <span className="chips">
                        {row.events.map((event) => (
                          <span key={event} className="chip" title={event}>
                            {eventLabel(event)}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      {row.status === 'active' ? 'يعمل' : 'موقوف'}
                      {row.status !== 'active' && <div className="muted">الأحداث التلقائية متوقّفة</div>}
                    </td>
                    <td>
                      {row.stats.delivered} ✔ / {row.stats.failed} ✖ / {row.stats.pending} …
                      {row.stats.lastError && <details className="muted small"><summary>تعذّر تسليم بعض الأحداث؛ تفاصيل الخطأ</summary><code dir="ltr">{row.stats.lastError}</code></details>}
                    </td>
                    <td>
                      {row.stats.lastResponseCode ?? '—'}
                      {row.stats.lastDeliveryAt && (
                        <div className="muted">{row.stats.lastDeliveryAt.slice(0, 19).replace('T', ' ')}</div>
                      )}
                    </td>
                    <td>
                      <div className="row">
                        <button className="btn sm" onClick={() => test(row)} disabled={busy === row.id}>
                          اختبار
                        </button>
                        <button className="btn sm" onClick={() => setOpenId(row.id === openId ? '' : row.id)}>
                          {row.id === openId ? 'إخفاء السجلّ' : 'السجلّ'}
                        </button>
                        <button className="btn sm" onClick={() => toggleStatus(row)} disabled={busy === row.id}>
                          {row.status === 'active' ? 'إيقاف' : 'تشغيل'}
                        </button>
                        <button className="btn sm danger" onClick={() => remove(row)} disabled={busy === row.id}>
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ContentPanel>
      )}

      {opened && (
        <ContentPanel title="سجل التسليم" description={opened.url}>
          <p className="muted">
            الحمولة تُعرض بمفاتيحها لا بقيمها: بيانات العميل تُقرأ عنده، وهذا السجلّ يجيب «هل وصل»
            لا «ماذا كان».
          </p>
          {deliveries.status === 'loading' && <Loading rows={3} />}
          {deliveries.status === 'error' && <ErrorBox message={deliveries.error} onRetry={() => deliveries.reload()} />}
          {deliveries.status === 'success' && (deliveries.data ?? []).length === 0 && (
            <Empty title="لا تسليمات بعد" detail="جرّب «اختبار» — أو انتظر حدثاً حقيقياً من المنشأة." />
          )}
          {deliveries.status === 'success' && (deliveries.data ?? []).length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الحدث</th>
                    <th>الحالة</th>
                    <th>المحاولات</th>
                    <th>رمز الاستجابة</th>
                    <th>الزمن</th>
                    <th>الحمولة</th>
                    <th>الخطأ</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {(deliveries.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{eventLabel(row.event)}</strong>
                        <div className="muted">{row.createdAt.slice(0, 19).replace('T', ' ')}</div>
                      </td>
                      <td>{row.status === 'delivered' ? 'وصل' : row.status === 'failed' ? 'فشل' : 'منتظر'}</td>
                      <td>
                        {row.attempts}/{row.maxAttempts}
                      </td>
                      <td>{row.responseCode ?? '—'}</td>
                      <td>{row.durationMs === null ? '—' : `${row.durationMs} ملي ثانية`}</td>
                      <td>
                        <details><summary>أسماء الحقول</summary><code dir="ltr">{row.payloadKeys.join(', ')}</code></details>
                        <div className="muted">{row.payloadBytes} بايت</div>
                      </td>
                      <td className="small">{row.error ? <details><summary>تعذّرت المحاولة؛ تفاصيل الخطأ</summary><code dir="ltr">{row.error}</code></details> : '—'}</td>
                      <td>
                        {row.status === 'failed' ? (
                          <button className="btn sm" onClick={() => retry(opened, row)} disabled={busy === row.id}>
                            إعادة الإرسال
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ContentPanel>
      )}
    </Screen>
  );
}

function apiMessage(error: unknown): string {
  return arabicErrorText(error, 'تعذّر تحديث وجهات الأحداث. تحقق من العنوان والاتصال ثم أعد المحاولة.');
}

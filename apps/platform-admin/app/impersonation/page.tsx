'use client';

import { useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';
import {
  IMPERSONATION_MAX_MINUTES,
  IMPERSONATION_MIN_MINUTES,
  type ImpersonationSession,
  type ImpersonationStartResult,
} from '@erp/contracts';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { ApiError, apiData, apiDelete, apiPost } from '../../lib/api';
import { supportHandoffBase } from '../../lib/support-handoff-url';
import { useQuery } from '../../lib/use-query';

/**
 * الدخول المؤقّت — `break-glass` (P-C8، `docs/roadmap/PLATFORM_CONSOLE_PLAN.md` §4).
 *
 * الشاشة تعرض ما تسمح به الشاشة، ويبقى الفرض على الـAPI: الحارس يمنع الحذف ومسّ
 * `/auth/`، ويقرأ صفّ الجلسة في كل طلب — فالإنهاء من هنا يُسقط الرمز في الطلب التالي.
 *
 * ثلاثة قرارات تظهر في الشاشة لا تُخفى:
 *
 *   * **السبب مكتوبٌ ويُقرأ للعميل**: يظهر في سجلّ المنشأة وفي التدقيق، والمدّة سقفها
 *     60 دقيقة في العقد (لا في الواجهة).
 *   * **الرمز يمرَّر في جزء العنوان** (`#support=…`): الجزء لا يُرسل إلى أي خادم ولا يُكتب
 *     في سجلّ الوسيط، ويُنظَّف من العنوان بمجرّد أن يقرأه تطبيق العميل. والبديل — النسخ
 *     واللصق في شاشة الدخول — يترك الرمز في الحافظة بلا حاجة.
 *   * **السجلّ لا يُمحى**: «الإنهاء» يكتب `ended_at`، ولا يحذف صفّاً — أثرُ من دخل باسم من
 *     يبقى.
 */

const STATUS_LABEL: Record<ImpersonationSession['status'], string> = {
  active: 'نشطة',
  ended: 'أُنهيت',
  expired: 'انتهت بوقتها',
};

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ar-SA') : '—';
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError && error.isForbidden) return 'تحتاج صلاحية إدارة الدعم لبدء الجلسة أو إنهائها.';
  return arabicErrorText(error, 'تعذّر تنفيذ إجراء الجلسة المؤقتة. راجع البيانات وأعد المحاولة.');
}

/**
 * عنوان تطبيق العميل (الـstaff). يُشتقّ من عنوان اللوحة نفسها بمبدّل المنفذ المتعارف عليه
 * في البيئة المحلية (3003 → 3001)، ويُضبط صراحةً بـ`NEXT_PUBLIC_STAFF_URL` في النشر
 * المفصول. لا `localhost` مكتوبٌ في الكود: المتصفّح ليس الخادم.
 */
function staffUrl(): string {
  const configured = process.env.NEXT_PUBLIC_STAFF_URL ?? '';
  if (typeof window === 'undefined') return configured.trim().replace(/\/+$/, '');
  return supportHandoffBase(window.location, configured);
}

export default function ImpersonationPage() {
  const sessions = useQuery<ImpersonationSession[]>(
    () => apiData<ImpersonationSession[]>('/platform/impersonate/sessions'),
    [],
  );
  const tenants = useQuery<Array<{ id: string; code: string; name: string }>>(
    () => apiData<Array<{ id: string; code: string; name: string }>>('/platform/tenants?limit=100'),
    [],
  );

  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<ImpersonationStartResult | null>(null);

  const active = (sessions.data ?? []).find((session) => session.status === 'active');

  async function start() {
    if (busy || !tenantId || reason.trim().length < 10 || minutes < IMPERSONATION_MIN_MINUTES || minutes > IMPERSONATION_MAX_MINUTES) return;
    const tenantName = (tenants.data ?? []).find((item) => item.id === tenantId)?.name ?? 'المنشأة المحددة';
    if (!window.confirm(`فتح دخول مؤقت على «${tenantName}» لمدة ${minutes} دقيقة؟ سيظهر السبب للعميل ويُسجّل هذا الدخول في التدقيق.`)) return;
    setBusy(true);
    setNotice(undefined);
    setStarted(null);
    try {
      const result = await apiPost<ImpersonationStartResult>('/platform/impersonate', {
        tenantId,
        reason,
        minutes,
      });
      setStarted(result);
      setNotice({
        kind: 'ok',
        text: `فُتحت جلسةٌ تنتهي في ${dateTime(result.session.expiresAt)} — الرمز لا يعمل بعد إنهائها أو انتهائها.`,
      });
      setReason('');
      sessions.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function end(session: ImpersonationSession) {
    if (!window.confirm(`إنهاء الجلسة على «${session.tenantName ?? session.tenantId}»؟ الرمز يسقط فوراً.`))
      return;
    setBusy(true);
    setNotice(undefined);
    try {
      await apiDelete(`/platform/impersonate/${session.id}`);
      setNotice({ kind: 'ok', text: 'أُنهيت الجلسة — الرمز لم يبقَ صالحاً.' });
      setStarted(null);
      sessions.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const ready = tenantId.length > 0 && reason.trim().length >= 10 &&
    minutes >= IMPERSONATION_MIN_MINUTES && minutes <= IMPERSONATION_MAX_MINUTES;

  return (
    <Screen
      title="الدخول المؤقّت"
      subtitle="دخول دعم محدود المدة وبسبب ظاهر للعميل؛ راجع الجلسات القائمة قبل إنشاء جلسة أخرى."
      crumbs={['المنصة', 'الدعم']}
      actions={<button className="btn" type="button" onClick={sessions.reload}>تحديث الجلسات</button>}
    >
      <WorkflowGuide title="ضوابط الدخول المؤقت" steps={[
        { title: 'تحقّق من الحاجة', detail: 'راجع المنشأة والجلسات النشطة وحدد سبباً محدداً يمكن للعميل الاطلاع عليه.' },
        { title: 'حدّد المدة وأكّد', detail: 'يُنشأ رمز دعم محدود الصلاحية بعد تأكيدك؛ لا تشارك الرمز إلا مع المخوّل.' },
        { title: 'أغلق الأثر', detail: 'انهِ الجلسة عند انتهاء الدعم؛ يبقى السجل للمراجعة بعد سقوط صلاحية الرمز.' },
      ]} />
      {active && (
        <ContentPanel title="تنبيه: جلسة نشطة" description="تحقق من أن هذه الجلسة لا تزال مطلوبة قبل إنشاء جلسة أخرى.">
          <p className="alert danger" style={{ margin: 0 }}>
            جلسةٌ نشطة الآن على «{active.tenantName ?? active.tenantId}» ({active.operatorLabel ?? '—'}) —
            تنتهي {dateTime(active.expiresAt)}. أنهِها إن لم تكن قيد العمل.
          </p>
        </ContentPanel>
      )}

      <ContentPanel title="فتح جلسة دعم" description={`المدة من ${IMPERSONATION_MIN_MINUTES} إلى ${IMPERSONATION_MAX_MINUTES} دقيقة؛ السبب يُقرأ في سجل العميل.`}>
        {tenants.status === 'loading' && <Loading rows={2} />}
        {tenants.status === 'error' && <ErrorBox message={tenants.error} onRetry={tenants.reload} />}
        {tenants.status === 'forbidden' && <Forbidden />}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label>
            المنشأة
            <select value={tenantId} onChange={(event) => { setTenantId(event.target.value); setStarted(null); setNotice(undefined); }}>
              <option value="">اختر منشأة…</option>
              {(tenants.data ?? []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            المدّة (دقائق)
            <input
              type="number"
              min={IMPERSONATION_MIN_MINUTES}
              max={IMPERSONATION_MAX_MINUTES}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
        </div>
        <label>
          السبب (يُقرأ للعميل في سجلّه، ويُقيَّد في التدقيق)
          <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="row">
          <button className="btn" type="button" disabled={!ready || busy} onClick={() => void start()}>
            {busy ? 'جارٍ…' : 'ابدأ الجلسة'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            لا يُفتح بابٌ لمنشأةٍ بلا مالكٍ نشط، والرمز يُصدر باسم عضويّة المالك.
          </p>
        </div>
        {notice && (
          <p className={`alert ${notice.kind === 'ok' ? 'ok' : 'danger'}`} role={notice.kind === 'danger' ? 'alert' : 'status'} style={{ margin: 0 }}>
            {notice.text}
          </p>
        )}
        {started && (
          <div className="card tight">
            <p style={{ margin: 0 }}>
              الرمز صالحٌ حتى {dateTime(started.session.expiresAt)} ({started.expiresIn} ثانية)، ولا يُجدَّد.
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <a
                className="btn"
                href={`${staffUrl()}/#support=${started.accessToken}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                افتح منشأة العميل
              </a>
              <button
                className="btn"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(started.accessToken)}
              >
                انسخ الرمز
              </button>
              <span className="muted">الرمز لا يُرسل ضمن مسار الطلب؛ لا تنسخ الرابط أو تشاركه خارج فريق الدعم المخوّل.</span>
            </div>
          </div>
        )}
      </ContentPanel>

      <ContentPanel title="سجل الجلسات" description="راجع مَن دخل وسبب الجلسة ووقتها. على الهاتف اسحب الجدول أفقياً لرؤية بقية الأعمدة؛ الإنهاء لا يحذف السجل.">
        {sessions.status === 'loading' && <Loading rows={3} />}
        {sessions.status === 'forbidden' && <Forbidden />}
        {sessions.status === 'error' && <ErrorBox message={sessions.error} onRetry={sessions.reload} />}
        {sessions.status === 'success' && (sessions.data?.length ?? 0) === 0 && (
          <Empty title="لا جلسات بعد" detail="كل دخولٍ مؤقّت يُكتب هنا بمن دخله وسببه ومدّته." />
        )}
        {sessions.status === 'success' && (sessions.data?.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المنشأة</th>
                  <th>المشغّل</th>
                  <th>السبب</th>
                  <th>البداية</th>
                  <th>النهاية</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(sessions.data ?? []).map((session) => (
                  <tr key={session.id}>
                    <td>
                      {session.tenantName ?? '—'}
                      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                        {session.tenantCode ?? ''} · باسم {session.asUserLabel ?? '—'}
                      </p>
                    </td>
                    <td>{session.operatorLabel ?? session.operatorUserId}</td>
                    <td>{session.reason}</td>
                    <td className="whitespace-nowrap">{dateTime(session.startedAt)}</td>
                    <td className="whitespace-nowrap">{dateTime(session.endedAt ?? session.expiresAt)}</td>
                    <td>
                      <span className={`chip${session.status === 'active' ? ' on' : ''}`}>
                        {STATUS_LABEL[session.status]}
                      </span>
                    </td>
                    <td>
                      {session.status === 'active' && (
                        <button
                          className="btn danger"
                          type="button"
                          disabled={busy}
                          onClick={() => void end(session)}
                        >
                          إنهاء
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ContentPanel>
    </Screen>
  );
}

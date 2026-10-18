'use client';

import { useState } from 'react';
import { ContentPanel, ViewNotice, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { apiData, apiPost } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

type Request = {
  id: string;
  tenant_code: string;
  tenant_name: string;
  plan_name: string | null;
  amount: string | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
  requested_by_email: string | null;
  status: string;
};

const STATUS_AR: Record<string, string> = {
  pending: 'بانتظار المراجعة',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
};

export default function ActivationRequestsPage() {
  const [status, setStatus] = useState('pending');
  const requests = useQuery<Request[]>(() => apiData<Request[]>(`/platform/activation-requests?status=${status}`), [status]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  async function review(row: Request, approve: boolean) {
    if (busy || !window.confirm(approve
      ? `اعتماد طلب «${row.tenant_name}» سيصدر ترخيصاً لمدة 12 شهراً. هل تأكدت من بيانات المنشأة والباقة؟`
      : `رفض طلب «${row.tenant_name}» سيغلقه دون تفعيل. هل تريد المتابعة؟`)) return;
    setBusy(row.id);
    setMessage(undefined);
    try {
      await apiPost(`/platform/activation-requests/${row.id}/review`, { approve });
      setMessage({ kind: 'ok', text: approve ? 'تم اعتماد الطلب وإصدار ترخيص لمدة 12 شهراً.' : 'تم رفض الطلب.' });
      requests.reload();
    } catch (error) {
      setMessage({ kind: 'danger', text: arabicErrorText(error, 'تعذّر اتخاذ القرار بشأن طلب التفعيل. أعد المحاولة.') });
    } finally {
      setBusy(undefined);
    }
  }

  const rows = requests.data ?? [];

  return (
    <Screen
      title="طلبات التفعيل"
      subtitle="راجع طلب المنشأة وباقتها قبل اتخاذ قرار الاعتماد أو الرفض."
      crumbs={['المنصة', 'العملاء والتراخيص']}
      actions={
        <label className="field">
          <span>حالة الطلبات</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">بانتظار المراجعة</option>
            <option value="approved">معتمدة</option>
            <option value="rejected">مرفوضة</option>
          </select>
        </label>
      }
    >
      <WorkflowGuide
        title="مسار مراجعة طلب التفعيل"
        steps={[
          { title: 'راجع بيانات المنشأة', detail: 'طابق مقدم الطلب والباقة والملاحظة قبل اتخاذ القرار.' },
          { title: 'اختر القرار المناسب', detail: 'اعتماد الطلب يصدر ترخيصاً؛ والرفض يغلق الطلب دون تفعيل.' },
          { title: 'تابع النتيجة', detail: 'انتقل إلى المعتمدة أو المرفوضة لمراجعة القرار بعد تحديث القائمة.' },
        ]}
      />
      {message && <p className={`alert ${message.kind}`} role={message.kind === 'danger' ? 'alert' : 'status'}>{message.text}</p>}
      <ContentPanel
        title={`${STATUS_AR[status] ?? 'الطلبات'} (${requests.status === 'success' ? rows.length : '—'})`}
        description="تعرض القائمة الحالة المختارة فقط؛ لا يؤدي تغيير المرشح إلى تعديل أي طلب."
      >
        {requests.status === 'loading' && <Loading />}
        {requests.status === 'error' && <ErrorBox message={requests.error} onRetry={requests.reload} />}
        {requests.status === 'forbidden' && <Forbidden />}
        {requests.status === 'success' && (rows.length === 0 ? (
          <ViewNotice state="empty">لا توجد طلبات في هذه الحالة. غيّر المرشح لمراجعة الطلبات الأخرى.</ViewNotice>
        ) : (
          <div className="erp-case-list">
            {rows.map((row) => (
              <article className="erp-case" key={row.id}>
                <header>
                  <div>
                    <h3>{row.tenant_name}</h3>
                    <p>رمز المنشأة: <bdi dir="ltr">{row.tenant_code}</bdi></p>
                  </div>
                  <span className={`badge ${row.status === 'approved' ? 'active' : row.status === 'rejected' ? 'failed' : 'pending'}`}>
                    {STATUS_AR[row.status] ?? 'قيد المراجعة'}
                  </span>
                </header>
                <dl>
                  <div><dt>الباقة المطلوبة</dt><dd>{row.plan_name ?? 'لم تُحدد بعد'}</dd></div>
                  <div><dt>مقدم الطلب</dt><dd dir="auto">{row.requested_by_email ?? 'غير متاح'}</dd></div>
                  <div><dt>تاريخ الطلب</dt><dd>{new Date(row.created_at).toLocaleDateString('ar-SA')}</dd></div>
                  <div><dt>القيمة المعروضة</dt><dd className="num">{row.amount ? `${Number(row.amount).toLocaleString('ar-SA', { minimumFractionDigits: 2 })} ${row.currency ?? ''}` : 'غير محددة'}</dd></div>
                </dl>
                {row.notes && <blockquote>ملاحظة مقدم الطلب: {row.notes}</blockquote>}
                {row.status === 'pending' && (
                  <footer>
                    <span className="muted small">تحقق من بيانات الطلب قبل اتخاذ قرار يؤثر في الترخيص.</span>
                    <button className="btn sm primary" type="button" disabled={Boolean(busy)} onClick={() => void review(row, true)}>
                      {busy === row.id ? 'جارٍ المعالجة…' : 'اعتماد الطلب'}
                    </button>
                    <button className="btn sm danger" type="button" disabled={Boolean(busy)} onClick={() => void review(row, false)}>
                      رفض الطلب
                    </button>
                  </footer>
                )}
              </article>
            ))}
          </div>
        ))}
      </ContentPanel>
    </Screen>
  );
}

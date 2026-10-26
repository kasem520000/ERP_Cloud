'use client';

import {
  usageMetricRegistry,
  usageModuleKeys,
  usageModuleLabelsAr,
  type UsageAvailablePlan,
  type UsageMetricKey,
  type UsageModuleKey,
  type UsageRequest,
  type UsageRequestType,
  type UsageSnapshot,
} from '@erp/contracts';
import { FormActions, FormGrid, Panel } from '@erp/ui';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Labeled } from '../../../components/ui/input';
import { Table } from '../../../components/ui/table';
import { apiData, apiErrorText, apiList, apiPost } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

const STATE_LABEL: Record<string, string> = {
  ok: 'طبيعي',
  soft: 'قريب من الحدّ',
  hard: 'بلغ الحدّ',
  unlimited: 'بلا حدّ',
};

const SOURCE_LABEL: Record<string, string> = {
  tenant: 'تجاوز معتمد لمنشأتك من إدارة المنصة',
  plan: 'حدٌّ من باقة اشتراكك',
  platform: 'حدّ عام على المنصة',
  default: 'افتراض الفهرس',
};

const SUB_STATUS_LABEL: Record<string, string> = {
  active: 'فعّال',
  trialing: 'فترة تجريبية',
  past_due: 'مستحق الدفع',
  paused: 'موقوف مؤقتاً',
  canceled: 'ملغى',
  expired: 'منتهٍ',
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'بانتظار اعتماد إدارة المنصة',
  approved: 'معتمد وتم التطبيق',
  rejected: 'مرفوض',
};

const REQUEST_TYPE_LABEL: Record<UsageRequestType, string> = {
  quota_increase: 'رفع حصة بند استخدام',
  plan_upgrade: 'ترقية الباقة',
  module_enable: 'تفعيل ميزة / وحدة إضافية',
};

function ratioOf(used: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.min(1, used / Math.max(limit, 1));
}

function toneOf(state: string): string {
  if (state === 'hard') return 'danger';
  if (state === 'soft') return 'warn';
  return 'ok';
}

function UsageSettingsContent() {
  const session = useSession();
  const searchParams = useSearchParams();
  const snapshot = useQuery<UsageSnapshot>(() => apiData<UsageSnapshot>('/usage'), []);
  const requests = useQuery<UsageRequest[]>(() => apiList<UsageRequest>('/usage/requests'), []);
  const plans = useQuery<UsageAvailablePlan[]>(() => apiList<UsageAvailablePlan>('/usage/plans'), []);

  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState<UsageRequestType>('quota_increase');
  const [metricKey, setMetricKey] = useState<UsageMetricKey>('branches');
  const [moduleKey, setModuleKey] = useState<UsageModuleKey>('feature.pos');
  const [requestedLimit, setRequestedLimit] = useState('5');
  const [requestedPlanId, setRequestedPlanId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const openParam = searchParams.get('openRequest');
    const metricParam = searchParams.get('metric');
    if (openParam === '1' || metricParam) {
      setShowForm(true);
      if (metricParam && usageMetricRegistry.some((m) => m.key === metricParam)) {
        setRequestType('quota_increase');
        setMetricKey(metricParam as UsageMetricKey);
      }
    }
  }, [searchParams]);

  const data = snapshot.data;
  const metricRows = (data?.metrics ?? []).filter((metric) =>
    usageMetricRegistry.some((definition) => definition.key === metric.key),
  );

  const allowed = session.can('tenant.view');

  function openMetricRequest(targetMetric: UsageMetricKey, currentLimit: number | null, used: number) {
    setRequestType('quota_increase');
    setMetricKey(targetMetric);
    const suggested = Math.max((currentLimit ?? used) * 2, used + 5, 5);
    setRequestedLimit(String(suggested));
    setShowForm(true);
    setFeedback(null);
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiPost<UsageRequest>('/usage/requests', {
        requestType,
        metricKey: requestType === 'quota_increase' ? metricKey : undefined,
        requestedLimit: requestType === 'quota_increase' ? Number(requestedLimit) : undefined,
        requestedPlanId: requestType === 'plan_upgrade' ? requestedPlanId : undefined,
        moduleKey: requestType === 'module_enable' ? moduleKey : undefined,
        reason,
      });
      setFeedback({
        kind: 'ok',
        text: 'تم إرسال طلبك بنجاح إلى إدارة المنصة للاعتماد. سيصلك إشعار فور مراجعته وتطبيق الحصة المعتمدة تلقائياً.',
      });
      setReason('');
      setShowForm(false);
      requests.reload();
      snapshot.reload();
    } catch (error) {
      setFeedback({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title="الاستخدام والحصص وطلبات الاعتماد"
      subtitle="مراقبة استهلاك منشأتك مقابل حدود باقة الاشتراك، وتقديم طلبات رفع الحصة أو ترقية الباقة لإدارة المنصة للاعتماد."
      crumbs={['الإعدادات', 'الاستخدام والحصص']}
      actions={
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setShowForm((prev) => !prev);
              setFeedback(null);
            }}
          >
            {showForm ? 'إخفاء نموذج الطلب' : 'تقديم طلب لإدارة المنصة للاعتماد'}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              snapshot.reload();
              requests.reload();
            }}
          >
            تحديث
          </button>
        </div>
      }
    >
      {!allowed && <Forbidden />}

      {allowed && feedback && <p className={`alert ${feedback.kind}`}>{feedback.text}</p>}

      {allowed && snapshot.status === 'loading' && <Loading rows={4} />}
      {allowed && snapshot.status === 'error' && (
        <ErrorBox message={snapshot.error} onRetry={snapshot.reload} />
      )}
      {allowed && snapshot.status === 'forbidden' && (
        <Empty
          title="لا تملك صلاحية عرض الاستخدام"
          detail="هذه الشاشة تحتاج صلاحية عرض المنشأة (tenant.view)."
        />
      )}

      {allowed && snapshot.status === 'success' && data && (
        <>
          <Panel title="ملخص الاشتراك والمنشأة">
            <dl className="kv">
              <dt>المنشأة</dt>
              <dd>
                {data.tenantName}{' '}
                <span className="muted small" dir="ltr">
                  ({data.tenantCode})
                </span>
              </dd>
              <dt>الباقة الحالية</dt>
              <dd>
                {data.subscription ? (
                  <>
                    <strong>{data.subscription.planName}</strong>{' '}
                    <span className="badge ready" style={{ marginInlineStart: 6 }}>
                      {SUB_STATUS_LABEL[data.subscription.status] ?? data.subscription.status}
                    </span>{' '}
                    <span className="muted small" dir="ltr">
                      ({data.subscription.amount} {data.subscription.currency} /{' '}
                      {data.subscription.interval === 'year' ? 'سنة' : 'شهر'})
                    </span>
                  </>
                ) : (
                  <span className="muted">غير مربوط بباقة مفعّلة (المغلّف الافتراضي)</span>
                )}
              </dd>
              <dt>الفترة الشهرية للقياس</dt>
              <dd dir="ltr">
                {data.periodStart} → {data.periodEnd}
              </dd>
              <dt>حالة الحساب</dt>
              <dd>{data.tenantStatus === 'active' ? 'نشط' : data.tenantStatus}</dd>
            </dl>
            <p className="muted small" style={{ marginBottom: 0 }}>
              تخضع المنشأة لسياسة الاستخدام والحصص المحددة في باقتها. عند بلوغ الحدّ الأقصى لأي بند، يوقف النظام
              العمليات الإضافية على ذلك البند لحين تقديم طلب لإدارة المنصة واعتماده.
            </p>
          </Panel>

          {showForm && (
            <Panel title="نموذج تقديم طلب لإدارة المنصة للاعتماد">
              <form onSubmit={submitRequest} className="grid gap-4">
                <FormGrid cols={2}>
                  <Labeled label="نوع الطلب">
                    <select
                      className="input"
                      value={requestType}
                      onChange={(e) => setRequestType(e.target.value as UsageRequestType)}
                    >
                      <option value="quota_increase">رفع حصة بند استخدام (مستخدمون / فروع / أصناف / فواتير...)</option>
                      <option value="plan_upgrade">ترقية الباقة إلى باقة أعلى</option>
                      <option value="module_enable">تفعيل ميزة / وحدة إضافية</option>
                    </select>
                  </Labeled>

                  {requestType === 'quota_increase' && (
                    <Labeled label="بند الحصة المطلوب رفعه">
                      <select
                        className="input"
                        value={metricKey}
                        onChange={(e) => setMetricKey(e.target.value as UsageMetricKey)}
                      >
                        {usageMetricRegistry.map((m) => {
                          const current = metricRows.find((r) => r.key === m.key);
                          return (
                            <option key={m.key} value={m.key}>
                              {m.labelAr} (الحالي: {current?.used ?? 0} من{' '}
                              {current?.limit === null || current?.limit === undefined ? 'بلا حد' : current.limit}{' '}
                              {m.unitAr})
                            </option>
                          );
                        })}
                      </select>
                    </Labeled>
                  )}

                  {requestType === 'quota_increase' && (
                    <Labeled label="السقف الجديد المطلوب" hint="أدخل العدد الإجمالي المطلوب اعتماده لهذا البند.">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        required
                        dir="ltr"
                        value={requestedLimit}
                        onChange={(e) => setRequestedLimit(e.target.value)}
                      />
                    </Labeled>
                  )}

                  {requestType === 'plan_upgrade' && (
                    <Labeled label="الباقة المطلوبة للترقية">
                      <select
                        className="input"
                        required
                        value={requestedPlanId}
                        onChange={(e) => setRequestedPlanId(e.target.value)}
                      >
                        <option value="">— اختر الباقة —</option>
                        {(plans.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.amount} {p.currency} / {p.interval === 'year' ? 'سنوياً' : 'شهرياً'}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                  )}

                  {requestType === 'module_enable' && (
                    <Labeled label="الميزة / الوحدة المطلوب تفعيلها">
                      <select
                        className="input"
                        value={moduleKey}
                        onChange={(e) => setModuleKey(e.target.value as UsageModuleKey)}
                      >
                        {usageModuleKeys.map((k) => (
                          <option key={k} value={k}>
                            {usageModuleLabelsAr[k]}
                          </option>
                        ))}
                      </select>
                    </Labeled>
                  )}
                </FormGrid>

                <Labeled
                  label="مبررات الطلب وملاحظات لإدارة المنصة"
                  hint="اذكر سبب الحاجة لرفع الحصة أو ترقية الباقة ليتم اعتماده سريعاً من إدارة المنصة."
                >
                  <textarea
                    className="input"
                    rows={3}
                    required
                    minLength={3}
                    placeholder="مثال: نحتاج إضافة فروع جديدة ومندوبين لتغطية التوسع التشغيلي هذا الشهر..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Labeled>

                <FormActions>
                  <button className="btn primary" type="submit" disabled={submitting}>
                    {submitting ? 'جارٍ إرسال الطلب…' : 'إرسال الطلب لإدارة المنصة للاعتماد'}
                  </button>
                  <button className="btn" type="button" onClick={() => setShowForm(false)}>
                    إلغاء
                  </button>
                </FormActions>
              </form>
            </Panel>
          )}

          {data.metrics
            .filter((metric) => metric.state === 'hard' && metric.enforced)
            .map((metric) => (
              <div
                key={`hard-${metric.key}`}
                className="alert danger"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
              >
                <span>
                  اشتراكك وحصتك الحالية لا تسمح بالزيادة على بند «{metric.labelAr}» ({metric.used} من{' '}
                  {metric.limit}) — يُرفض التنفيذ عند: {metric.enforcedAtAr}. قدّم طلباً لإدارة المنصة للاعتماد.
                </span>
                <button
                  className="btn sm primary"
                  type="button"
                  onClick={() => openMetricRequest(metric.key, metric.limit, metric.used)}
                >
                  تقديم طلب رفع حصة «{metric.labelAr}»
                </button>
              </div>
            ))}
          {data.metrics
            .filter((metric) => metric.state === 'soft')
            .map((metric) => (
              <p key={`soft-${metric.key}`} className="alert warn">
                {metric.noticeAr ?? `اقتربتَ من حدّ «${metric.labelAr}» (${metric.percentUsed}٪).`}
              </p>
            ))}

          <Panel title="بنود سياسة الاستخدام والحصص الثمانية" flush>
            <Table
              bare
              empty={<>لا توجد مقاييس مسجّلة لهذه المنشأة.</>}
              columns={[
                {
                  key: 'metric',
                  header: 'البند',
                  cell: (metric) => (
                    <>
                      <strong>{metric.labelAr}</strong>
                      <div className="muted small">
                        {metric.period === 'month'
                          ? 'يُصفَّر كل شهر'
                          : metric.period === 'day'
                            ? 'يُصفَّر كل يوم'
                            : 'تراكمي'}
                      </div>
                    </>
                  ),
                },
                {
                  key: 'used',
                  header: 'المستهلك',
                  numeric: true,
                  cell: (metric) => (
                    <>
                      {metric.used.toLocaleString('en-US')}{' '}
                      <span className="muted small">{metric.unitAr}</span>
                    </>
                  ),
                },
                {
                  key: 'limit',
                  header: 'الحدّ المعتمد',
                  numeric: true,
                  cell: (metric) =>
                    metric.limit === null ? 'بلا حدّ' : metric.limit.toLocaleString('en-US'),
                },
                {
                  key: 'ratio',
                  header: 'النسبة',
                  cell: (metric) => (
                    <>
                      <span className="meter">
                        <span
                          className={`meter-fill ${toneOf(metric.state) === 'ok' ? '' : toneOf(metric.state)}`}
                          style={{ width: `${Math.round(ratioOf(metric.used, metric.limit) * 100)}%` }}
                        />
                      </span>
                      <span className="muted small" style={{ marginInlineStart: 6 }}>
                        {metric.percentUsed === null ? '—' : `${metric.percentUsed}%`}
                      </span>
                    </>
                  ),
                },
                {
                  key: 'state',
                  header: 'الحالة',
                  cell: (metric) => (
                    <>
                      <span className={`badge ${metric.state === 'ok' ? 'ready' : metric.state}`}>
                        {STATE_LABEL[metric.state]}
                      </span>
                      <div className="muted small">{metric.enforced ? 'مُطبَّق إلزامياً' : 'يُبلَّغ عنه فقط'}</div>
                    </>
                  ),
                },
                {
                  key: 'source',
                  header: 'مصدر الحصة',
                  cell: (metric) => <span className="muted small">{SOURCE_LABEL[metric.limitSource]}</span>,
                },
                {
                  key: 'action',
                  header: 'إجراء',
                  cell: (metric) => (
                    <button
                      className={`btn sm ${metric.state === 'hard' && metric.enforced ? 'primary' : ''}`}
                      type="button"
                      onClick={() => openMetricRequest(metric.key, metric.limit, metric.used)}
                    >
                      طلب رفع الحصة
                    </button>
                  ),
                },
              ]}
              rows={metricRows}
              rowKey={(metric) => metric.key}
            />
          </Panel>

          <Panel title="سجل طلبات الاعتماد المرسلة لإدارة المنصة" flush>
            <Table
              bare
              empty={<>لم تُقدَّم أي طلبات رفع حصة أو ترقية باقة بعد.</>}
              columns={[
                {
                  key: 'type',
                  header: 'نوع الطلب',
                  cell: (req) => <strong>{REQUEST_TYPE_LABEL[req.requestType]}</strong>,
                },
                {
                  key: 'target',
                  header: 'البند / الباقة المطلوبة',
                  cell: (req) => {
                    if (req.requestType === 'quota_increase') {
                      return (
                        <>
                          {req.metricLabelAr ?? req.metricKey} — رفع السقف إلى{' '}
                          <strong dir="ltr">{req.requestedLimit?.toLocaleString('en-US')}</strong>
                          {req.approvedLimit !== null && req.status === 'approved' ? (
                            <span className="muted small"> (اعتُمد: {req.approvedLimit})</span>
                          ) : null}
                        </>
                      );
                    }
                    if (req.requestType === 'plan_upgrade') {
                      return <span>باقة «{req.requestedPlanName ?? '—'}»</span>;
                    }
                    return <span>{req.moduleLabelAr ?? req.moduleKey}</span>;
                  },
                },
                {
                  key: 'reason',
                  header: 'سبب الطلب',
                  cell: (req) => <span>{req.reason}</span>,
                },
                {
                  key: 'status',
                  header: 'حالة الاعتماد',
                  cell: (req) => (
                    <span
                      className={`badge ${
                        req.status === 'approved'
                          ? 'ready'
                          : req.status === 'rejected'
                            ? 'hard'
                            : 'soft'
                      }`}
                    >
                      {REQUEST_STATUS_LABEL[req.status] ?? req.status}
                    </span>
                  ),
                },
                {
                  key: 'notes',
                  header: 'قرار / ملاحظات المنصة',
                  cell: (req) => <span className="muted small">{req.decisionNotes ?? '—'}</span>,
                },
                {
                  key: 'date',
                  header: 'التاريخ',
                  cell: (req) => (
                    <span className="muted small" dir="ltr">
                      {req.createdAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  ),
                },
              ]}
              rows={requests.data ?? []}
              rowKey={(req) => req.id}
            />
          </Panel>

          <Panel title="استدعاءات الـAPI — آخر ٣٠ يوماً">
            <div className="day-bars" dir="ltr">
              {data.apiCallsPerDay.map((day) => {
                const max = Math.max(1, ...data.apiCallsPerDay.map((entry) => entry.count));
                return (
                  <div
                    key={day.day}
                    className="day-bar"
                    style={{ height: `${Math.max(3, (day.count / max) * 100)}%` }}
                    title={`${day.day}: ${day.count}`}
                  />
                );
              })}
            </div>
            <p className="muted small">
              اليوم الحالي: {(data.apiCallsPerDay.at(-1)?.count ?? 0).toLocaleString('en-US')} استدعاء · أحدث
              توليد {new Date(data.generatedAt).toLocaleString('en-US')}
            </p>
          </Panel>
        </>
      )}
    </Screen>
  );
}

export default function UsageSettingsPage() {
  return (
    <Suspense fallback={<Loading rows={4} />}>
      <UsageSettingsContent />
    </Suspense>
  );
}

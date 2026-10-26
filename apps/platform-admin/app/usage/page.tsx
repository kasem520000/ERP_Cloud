'use client';

import {
  usageMetricRegistry,
  type PlatformUsageGridResponse,
  type PlatformUsageGridRow,
  type UsageMetricKey,
  type UsageMetricState,
  type UsageRequest,
  type UsageRequestStatus,
  type UsageSnapshot,
} from '@erp/contracts';
import { Panel } from '@erp/ui';
import { useState } from 'react';

import { Empty, ErrorBox, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { ApiError, apiData, apiList, apiPost, downloadFile } from '../../lib/api';
import { dateText } from '../../lib/format';
import { useQuery } from '../../lib/use-query';

const STATE_LABEL: Record<UsageMetricState, string> = {
  ok: 'طبيعي',
  soft: 'قريب من الحدّ',
  hard: 'بلغ الحدّ',
  unlimited: 'بلا حدّ',
};

const SOURCE_LABEL: Record<'tenant' | 'plan' | 'platform' | 'default', string> = {
  tenant: 'تجاوز العميل',
  plan: 'حدّ الباقة',
  platform: 'افتراض المنصة',
  default: 'مغلّف الفهرس',
};

const REQUEST_STATUS_LABEL: Record<UsageRequestStatus, string> = {
  pending: 'بانتظار الاعتماد',
  approved: 'معتمد ومطبّق',
  rejected: 'مرفوض',
};

function toneOf(state: UsageMetricState): 'ok' | 'warn' | 'danger' {
  if (state === 'hard') return 'danger';
  if (state === 'soft') return 'warn';
  return 'ok';
}

function ratioOf(used: number, limit: number | null): number {
  if (limit === null) return 0;
  return Math.min(1, used / Math.max(limit, 1));
}

export default function UsagePage() {
  const grid = useQuery<PlatformUsageGridResponse>(
    () => apiData<PlatformUsageGridResponse>('/platform/usage'),
    [],
  );
  const [reqFilter, setReqFilter] = useState<'all' | UsageRequestStatus>('pending');
  const requests = useQuery<UsageRequest[]>(
    () =>
      apiList<UsageRequest>(
        reqFilter === 'all' ? '/platform/usage/requests' : `/platform/usage/requests?status=${reqFilter}`,
      ),
    [reqFilter],
  );

  const [selected, setSelected] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exports, setExports] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [approvedLimits, setApprovedLimits] = useState<Record<string, string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const detail = useQuery<UsageSnapshot | undefined>(
    () =>
      selected ? apiData<UsageSnapshot>(`/platform/usage?tenantId=${selected}`) : Promise.resolve(undefined),
    [selected],
  );

  const data = grid.data;
  const needle = search.trim();
  const rows = (data?.tenants ?? []).filter(
    (row) =>
      needle.length === 0 ||
      row.tenantName.includes(needle) ||
      row.tenantCode.toLowerCase().includes(needle.toLowerCase()),
  );

  async function handleReview(req: UsageRequest, approve: boolean) {
    setReviewingId(req.id);
    setExports(undefined);
    try {
      const customLimitRaw = approvedLimits[req.id];
      const approvedLimit =
        approve && req.requestType === 'quota_increase'
          ? Number(customLimitRaw !== undefined ? customLimitRaw : (req.requestedLimit ?? 1))
          : undefined;
      await apiPost<UsageRequest>(`/platform/usage/requests/${req.id}/review`, {
        approve,
        approvedLimit,
        decisionNotes: decisionNotes[req.id] ?? '',
      });
      setExports({
        kind: 'ok',
        text: approve
          ? `تم اعتماد طلب المنشأة «${req.tenantName ?? req.tenantCode}» وتطبيق الحصة/الباقة الجديدة تلقائياً وإشعار المنشأة.`
          : `تم رفض طلب المنشأة «${req.tenantName ?? req.tenantCode}» وإرسال إشعار بالقرار.`,
      });
      requests.reload();
      grid.reload();
      if (selected) detail.reload();
    } catch (error) {
      setExports({
        kind: 'danger',
        text:
          error instanceof ApiError && error.isForbidden
            ? 'اعتماد الطلبات يحتاج صلاحية «إدارة الفوترة» (console.billing.manage).'
            : error instanceof Error
              ? error.message
              : String(error),
      });
    } finally {
      setReviewingId(null);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setExports(undefined);
    try {
      await downloadFile('/platform/usage/export.csv', 'platform-usage.csv');
      setExports({
        kind: 'ok',
        text: 'نُزِّل البيان — الأرقام هي نفسها المعروضة أعلاه، بترميز BOM وفواصل RFC 4180.',
      });
    } catch (error) {
      setExports({
        kind: 'danger',
        text:
          error instanceof ApiError && error.isForbidden
            ? 'التصدير يحتاج صلاحية «إدارة الفوترة» (console.billing.manage).'
            : error instanceof Error
              ? error.message
              : String(error),
      });
    } finally {
      setExporting(false);
    }
  }

  const gridColumns: Array<Column<PlatformUsageGridRow>> = [
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
    ...usageMetricRegistry.map((metric): Column<PlatformUsageGridRow> => ({
      key: metric.key,
      header: metric.labelAr,
      numeric: true,
      cell: (row) => <MetricCell row={row} metric={metric.key} />,
    })),
    {
      key: 'state',
      header: 'الحالة',
      cell: (row) => (
        <>
          <span className={`badge ${row.worst === 'ok' ? 'ready' : row.worst}`}>
            {STATE_LABEL[row.worst]}
          </span>
          {row.softCount + row.hardCount > 0 && (
            <div className="muted small">
              {row.hardCount} صلب · {row.softCount} ناعم
            </div>
          )}
        </>
      ),
    },
    {
      key: 'detail',
      header: '',
      cell: (row) => (
        <button
          className="btn sm"
          type="button"
          onClick={() => setSelected(selected === row.tenantId ? undefined : row.tenantId)}
        >
          {selected === row.tenantId ? 'إخفاء' : 'التفصيل'}
        </button>
      ),
    },
  ];

  const requestRows = requests.data ?? [];

  return (
    <Screen
      title="الاستخدام والحصص وطلبات الاعتماد"
      subtitle="مراقبة التزام المنشآت بسياسات الاستخدام والحصص للباقات، واعتماد طلبات رفع الحصص أو ترقية الباقات."
      crumbs={['المنصة', 'العملاء']}
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={() => {
              grid.reload();
              requests.reload();
            }}
          >
            تحديث
          </button>
          <button className="btn primary" type="button" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? 'جارٍ التصدير…' : 'تصدير CSV'}
          </button>
        </>
      }
    >
      {exports && <p className={`alert ${exports.kind}`}>{exports.text}</p>}

      <Panel>
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>
            طلبات المنشآت لاعتماد رفع الحصص وترقية الباقات ({requestRows.length})
          </h2>
          <div className="row" style={{ gap: 6 }}>
            {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={`btn sm ${reqFilter === st ? 'primary' : ''}`}
                onClick={() => setReqFilter(st)}
              >
                {st === 'pending'
                  ? 'بانتظار الاعتماد'
                  : st === 'approved'
                    ? 'المعتمدة'
                    : st === 'rejected'
                      ? 'المرفوضة'
                      : 'الكل'}
              </button>
            ))}
          </div>
        </div>

        {requests.status === 'loading' && <Loading rows={2} />}
        {requests.status === 'success' && requestRows.length === 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            لا توجد طلبات ضمن التصفية الحالية.
          </p>
        )}
        {requests.status === 'success' && requestRows.length > 0 && (
          <Table
            bare
            columns={[
              {
                key: 'tenant',
                header: 'المنشأة والباقة',
                cell: (req) => (
                  <>
                    <strong>{req.tenantName ?? '—'}</strong>
                    <div className="muted small" dir="ltr">
                      {req.tenantCode}
                    </div>
                    {req.currentPlanName ? (
                      <div className="muted small">الباقة: {req.currentPlanName}</div>
                    ) : null}
                  </>
                ),
              },
              {
                key: 'target',
                header: 'تفاصيل الطلب',
                cell: (req) => {
                  if (req.requestType === 'quota_increase') {
                    return (
                      <>
                        <strong>رفع حصة: {req.metricLabelAr ?? req.metricKey}</strong>
                        <div className="muted small">
                          المستهلك: {req.currentUsed ?? 0} · الحد الحالي:{' '}
                          {req.currentLimit === null ? 'بلا حد' : req.currentLimit} ← المطلوب:{' '}
                          <strong>{req.requestedLimit}</strong>
                        </div>
                      </>
                    );
                  }
                  if (req.requestType === 'plan_upgrade') {
                    return (
                      <>
                        <strong>ترقية باقة</strong>
                        <div className="muted small">إلى: «{req.requestedPlanName ?? '—'}»</div>
                      </>
                    );
                  }
                  return (
                    <>
                      <strong>تفعيل ميزة</strong>
                      <div className="muted small">{req.moduleLabelAr ?? req.moduleKey}</div>
                    </>
                  );
                },
              },
              {
                key: 'reason',
                header: 'مبررات المنشأة',
                grow: true,
                cell: (req) => (
                  <>
                    <div>{req.reason}</div>
                    <div className="muted small" dir="ltr">
                      {req.requestedByEmail ?? ''} · {dateText(req.createdAt)}
                    </div>
                  </>
                ),
              },
              {
                key: 'status',
                header: 'الحالة',
                cell: (req) => (
                  <span
                    className={`badge ${
                      req.status === 'approved' ? 'ready' : req.status === 'rejected' ? 'hard' : 'soft'
                    }`}
                  >
                    {REQUEST_STATUS_LABEL[req.status]}
                  </span>
                ),
              },
              {
                key: 'review',
                header: 'قرار إدارة المنصة',
                cell: (req) => {
                  if (req.status !== 'pending') {
                    return (
                      <div className="muted small">
                        {req.approvedLimit !== null ? <div>السقف المعتمد: {req.approvedLimit}</div> : null}
                        <div>{req.decisionNotes ?? '—'}</div>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                      {req.requestType === 'quota_increase' && (
                        <input
                          className="input"
                          type="number"
                          min={1}
                          dir="ltr"
                          placeholder="السقف المعتمد"
                          value={approvedLimits[req.id] ?? String(req.requestedLimit ?? '')}
                          onChange={(e) =>
                            setApprovedLimits((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                        />
                      )}
                      <input
                        className="input"
                        placeholder="ملاحظات الاعتماد / سبب الرفض..."
                        value={decisionNotes[req.id] ?? ''}
                        onChange={(e) =>
                          setDecisionNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                        }
                      />
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn sm primary"
                          type="button"
                          disabled={reviewingId === req.id}
                          onClick={() => void handleReview(req, true)}
                        >
                          اعتماد وتطبيق
                        </button>
                        <button
                          className="btn sm"
                          type="button"
                          disabled={reviewingId === req.id}
                          onClick={() => void handleReview(req, false)}
                        >
                          رفض
                        </button>
                      </div>
                    </div>
                  );
                },
              },
            ]}
            rows={requestRows}
            rowKey={(req) => req.id}
          />
        )}
      </Panel>

      {grid.status === 'loading' && <Loading rows={5} />}
      {grid.status === 'error' && <ErrorBox message={grid.error} onRetry={grid.reload} />}
      {grid.status === 'forbidden' && (
        <Empty title="لا تملك صلاحية الوصول" detail="هذه الشاشة تحتاج console.tenants.view." />
      )}

      {grid.status === 'success' && data && (
        <>
          <Panel>
            <dl className="kv">
              <dt>الفترة</dt>
              <dd dir="ltr">
                {dateText(data.periodStart)} {dateText(data.periodEnd)}
              </dd>
              <dt>العملاء</dt>
              <dd>{data.totals.tenants}</dd>
              <dt>عند الحدّ الناعم (٨٠٪ فأكثر)</dt>
              <dd>{data.totals.soft}</dd>
              <dt>بلغوا الحدّ (١٠٠٪)</dt>
              <dd>{data.totals.hard}</dd>
              <dt>استدعاءات اليوم (كل العملاء)</dt>
              <dd>{data.totals.apiCallsToday.toLocaleString('ar-SA-u-ca-gregory-nu-latn')}</dd>
              <dt>فواتير الشهر</dt>
              <dd>{data.totals.invoicesThisMonth.toLocaleString('ar-SA-u-ca-gregory-nu-latn')}</dd>
            </dl>
            <p className="muted small" style={{ marginBottom: 0 }}>
              تُطبَّق حدود الباقة النشطة أو التجريبية إلزامياً على المنشأة، ويعلو فوقها التجاوز المعتمد لمنشأة بعينها.
            </p>
          </Panel>

          <Panel>
            <div className="section-title">
              <h2>الشبكة — عميلٌ في كل صفّ</h2>
              <input
                className="input"
                style={{ maxWidth: 240 }}
                placeholder="ابحث باسم العميل أو رمزه"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {rows.length === 0 ? (
              <Empty title="لا عميل مطابق" detail="جرّب جزءاً من الاسم أو الرمز." />
            ) : (
              <Table bare columns={gridColumns} rows={rows} rowKey={(row) => row.tenantId} />
            )}
          </Panel>

          {selected && (
            <Panel>
              {detail.status === 'loading' && <Loading rows={3} />}
              {detail.status === 'error' && <ErrorBox message={detail.error} onRetry={detail.reload} />}
              {detail.data && (
                <>
                  <h2>
                    تفصيل الاستهلاك — {detail.data.tenantName}{' '}
                    <span className="muted small" dir="ltr">
                      {detail.data.tenantCode}
                    </span>
                  </h2>{' '}
                  {(() => {
                    const metricColumns: Array<Column<(typeof detail.data.metrics)[number]>> = [
                      { key: 'label', header: 'البند', grow: true, cell: (metric) => metric.labelAr },
                      {
                        key: 'used',
                        header: 'المستهلك',
                        numeric: true,
                        cell: (metric) => metric.used.toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
                      },
                      {
                        key: 'limit',
                        header: 'الحدّ',
                        numeric: true,
                        cell: (metric) =>
                          metric.limit === null
                            ? 'بلا حدّ'
                            : metric.limit.toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
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
                          <span className={`badge ${metric.state === 'ok' ? 'ready' : metric.state}`}>
                            {STATE_LABEL[metric.state]}
                          </span>
                        ),
                      },
                      {
                        key: 'source',
                        header: 'من أين جاء الحدّ؟',
                        cell: (metric) => (
                          <>
                            <span className={`tag ${metric.limitSource}`}>
                              {SOURCE_LABEL[metric.limitSource]}
                            </span>
                            <div className="muted small">
                              {metric.enforced ? 'يُطبَّق' : 'يُبلَّغ عنه فقط'}
                            </div>
                          </>
                        ),
                      },
                      {
                        key: 'enforcedAt',
                        header: 'أين يقع الرفض؟',
                        cell: (metric) => <span className="muted small">{metric.enforcedAtAr}</span>,
                      },
                    ];
                    return (
                      <Table
                        bare
                        columns={metricColumns}
                        rows={detail.data.metrics}
                        rowKey={(metric) => metric.key}
                      />
                    );
                  })()}
                  {detail.data.metrics
                    .filter((metric) => metric.noticeAr !== null && metric.state !== 'ok')
                    .map((metric) => (
                      <p
                        key={metric.key}
                        className={`alert ${metric.state === 'hard' ? 'danger' : 'warn'}`}
                        style={{ marginTop: 8 }}
                      >
                        {metric.noticeAr}
                      </p>
                    ))}
                  <h3 style={{ marginTop: 16 }}>استدعاءات الـAPI — آخر ٣٠ يوماً</h3>
                  <div className="day-bars" dir="ltr">
                    {detail.data.apiCallsPerDay.map((day) => {
                      const max = Math.max(1, ...detail.data!.apiCallsPerDay.map((entry) => entry.count));
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
                    اليوم الحالي: {detail.data.apiCallsPerDay.at(-1)?.count ?? 0} استدعاء · المقياس يُصفَّر كل
                    يوم · أحدث توليد {dateText(detail.data.generatedAt)}
                  </p>
                </>
              )}
            </Panel>
          )}
        </>
      )}
    </Screen>
  );
}

function MetricCell({ row, metric }: { row: PlatformUsageGridRow; metric: UsageMetricKey }) {
  const entry = row.metrics.find((item) => item.key === metric);
  if (!entry) return <span className="muted">—</span>;
  return (
    <>
      <div>
        {entry.used.toLocaleString('ar-SA-u-ca-gregory-nu-latn')}
        <span className="muted small">
          {' '}
          / {entry.limit === null ? '∞' : entry.limit.toLocaleString('ar-SA-u-ca-gregory-nu-latn')}
        </span>
      </div>
      <span className="meter" style={{ marginTop: 4 }}>
        <span
          className={`meter-fill ${toneOf(entry.state) === 'ok' ? '' : toneOf(entry.state)}`}
          style={{ width: `${Math.round(ratioOf(entry.used, entry.limit) * 100)}%` }}
        />
      </span>
    </>
  );
}
